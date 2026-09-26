# Photo upload relay

The site is served by GitHub Pages, which cannot accept an upload. Neither can
the page hold a credential that writes to the repository: anything in the page
is readable by anyone, and a token committed to a public repository is revoked
by GitHub's secret scanning. So the credential lives here, on a small Worker
that the browser talks to, and the browser never sees it.

What it does, in order: checks the origin, refuses oversized or non-image
uploads, and commits what is left to a `submissions` branch. It deliberately
does **not** touch image bytes — the page sends the file the visitor chose,
and the publishing Action re-encodes it when it derives the web-sized copy.
That re-encode is what leaves EXIF and GPS behind, so the copies the site
serves carry none, but the originals sitting on the `submissions` branch do.

```
browser  --POST multipart-->  relay (Cloudflare Worker)
                                 |  checks the origin
                                 |  validates size, type and count
                                 v
                              GitHub API  -->  submissions branch
                                                 |
                              GitHub API           |  repository_dispatch
                              (dispatches)          v
                                    .github/workflows/publish-submission.yml
                                                 v
                          assets/img/events + submissions.yml + submit.html
```

The dispatch is what makes a photo appear in about a minute. That workflow
also runs on a five-minute schedule, and the schedule is the part that has to
be there: it is what picks a submission up if the dispatch is refused or never
arrives. A dispatch that fails is deliberately swallowed, because by the time
it is sent the photos are committed and safe — reporting a stored submission
as failed would only tell the submitter to send the same photos again.

It needs no new permission. The dispatch endpoint is covered by
`Contents: Read and write`, the same one the commits above already use.

Published photos land in the gallery on `submit.html`, alongside the credit,
caption and date the submitter gave. The home page gallery stays curated, so a
submission never appears there; moving one across is a matter of moving its
entry from `assets/data/submissions.yml` to `assets/data/gallery.yml` and
running `tools/gallery.py sync`.

**There is no captcha, on purpose.** The submitter's name, email and consent
checkbox — plus strict origin, size, type and count limits — are the barriers;
adding a widget costs a dashboard visit and a second club of ceremony for a
hobby-site threat model. If spam ever arrives, a Turnstile widget verified in
`handler.js` (or a WAF rate-limit rule on the route) slots in without changing
anything downstream.

## Removing a photo

`POST /moderate` is how a photo is taken out of the gallery. It exists because
the site is static and has no server of its own, so this is the only place a
takedown can be authorised.

**The password is `ADMIN_SECRET`, and it is compared here, in the Worker.** Set
it once:

```bash
wrangler secret put ADMIN_SECRET      # a long random string
```

It is never sent to the browser and never appears in the page. The remove
button in the lightbox is hidden until an admin has typed it in that tab, but
that hiding is cosmetic and is not what protects anything — treat the button as
a convenience and this secret as the boundary. A wrong password and a missing
one are answered identically, and the comparison is constant-time, so the
endpoint does not leak how close a guess was.

**The relay does not delete anything.** It authenticates, checks the filename
against the published manifests, and writes a request to `moderate/` on the
submissions branch. `tools/publish_submissions.py` does the removal with the
repository's own tooling and `gallery.py check` gates the result. That
indirection is the point: this Worker holds a `contents: write` token, so an
endpoint that deleted files would turn a guessed password into a write
primitive on the repository. As written, the worst a leaked `ADMIN_SECRET` buys
someone is removing a photo — which is what the button is for anyway.

The cost is that a removal is a workflow run rather than instant. The dispatch
makes it about a minute; the five-minute schedule is the floor if the dispatch
is refused.

### What a removal does and does not do

It **unlists** the photo (manifest entry and markup) and **purges the served
bytes** (the original, its thumbnail, and any hero slide). After that the page
no longer shows it and its URL stops serving it.

It does **not** make the photo unrecoverable. The bytes remain in git history,
fetchable at a pinned commit SHA, and web archives keep their own copies. For
a genuine consent withdrawal, someone still has to rewrite history
(`git filter-repo`) with a coordinated force-push, and request removal from
archives. The button says "remove from gallery" rather than "delete
permanently" for this reason — do not describe it to a member as erasure.

Every removal appends to `.contacts/removals.yml` with the reason, who asked
and when. That file is committed and never served, so it doubles as the paper
trail and as the evidence that a takedown asked for on request was carried out.

If you need a photo gone *without* going through the site, the same thing is
one command:

```bash
python3 tools/gallery.py remove 22.jpg --reason "withdrawn at the member's request"
```

## Deploying it

About three minutes, once. There is no way to avoid this step: the token has to
live somewhere the public cannot read it, and that somewhere is this deployment.

### 1. Make a token scoped to this repository only

<https://github.com/settings/personal-access-tokens/new>

- **Repository access:** only `USYD-Astro/USYD-Astro`
- **Permissions:** `Contents: Read and write`
- **Expiration:** set one you will remember to rotate

Nothing else. Do not reuse a personal token that can reach other repositories.

### 2. Deploy the Worker

```bash
cd relay
npm install -g wrangler     # or: npx wrangler
wrangler login
wrangler secret put GITHUB_TOKEN      # paste the token from step 1
wrangler secret put ADMIN_SECRET      # enables the remove button
wrangler deploy
```

`wrangler deploy` prints the Worker's URL. Check it came up:

```bash
curl https://suas-photo-relay.<your-subdomain>.workers.dev/health
# {"ok":true,"configured":true}
```

It answers `configured:false` until the token secret exists, and the form will
refuse to submit in that state rather than failing halfway through an upload.

`/moderate` is disabled until `ADMIN_SECRET` is set, and says so, rather than
existing with no password. Rotate it with `wrangler secret put ADMIN_SECRET` —
it is the only thing authorising a takedown, so treat it like the token.

### 2. Point the site at the relay

In `submit.html`, fill in the data attribute on the form:

```html
<form class="submit-form" id="photo-form" novalidate
      data-relay="https://suas-photo-relay.<your-subdomain>.workers.dev/upload">
```

The URL is public by design. While `data-relay` is empty the form says uploads
are not switched on yet, rather than letting someone fill the whole thing in
and then fail.

The remove button is configured separately, on `<body>` of every page, because
it also appears in the lightbox on the home page gallery — which has no upload
form to read a relay URL from:

```html
<body data-moderate-endpoint="https://suas-photo-relay.<your-subdomain>.workers.dev/moderate">
```

## Testing it

```bash
cd relay
npm test          # node --test test/
```

The handler takes `fetch` as an injection point, so the suite runs with no
Cloudflare, no network and no real token. It covers the validation rules,
branch creation, the commit calls, the publish dispatch, and the failure paths.

To try it end to end without burning a real submission, run `wrangler dev`,
point `data-relay` at the local URL, and upload something small. Check that:

- the photo appears on the `submissions` branch, not on `main`
- the relay commits, and a run of the publishing workflow starts on its own
  rather than waiting for the next tick of the schedule
- the photos appear in the rail on `submit.html` for you, marked as going
  live, with the name and other details you typed shown in the expanded view,
  and nothing added to the home page gallery
- `submission.json` stays on the submissions branch and never reaches `main`,
  so the email address never does either

## Changing the origin

`ALLOWED_ORIGIN` in `wrangler.toml` is what stops another site using your relay
as a free upload service. Update it if the site ever moves off
`usyd-astro.github.io`, and remember a custom domain counts as a different
origin.
