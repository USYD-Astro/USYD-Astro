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
                          assets/img/events + submissions.yml + index.html
```

The dispatch is what makes a photo appear in about a minute. That workflow
also runs on a five-minute schedule, and the schedule is the part that has to
be there: it is what picks a submission up if the dispatch is refused or never
arrives. A dispatch that fails is deliberately swallowed, because by the time
it is sent the photos are committed and safe — reporting a stored submission
as failed would only tell the submitter to send the same photos again.

It needs no new permission. The dispatch endpoint is covered by
`Contents: Read and write`, the same one the commits above already use.

Published photos land in the competition rail on `index.html`, alongside the
credit, caption and date the submitter gave. The curated grid on the same page
stays hand-picked, so a submission never appears there; moving one across is a
matter of moving its entry from `assets/data/submissions.yml` to
`assets/data/gallery.yml` and running `tools/gallery.py sync`.

**There is no captcha, on purpose.** The submitter's name, email and consent
checkbox — plus strict origin, size, type and count limits — are the barriers;
adding a widget costs a dashboard visit and a second club of ceremony for a
hobby-site threat model. If spam ever arrives, a Turnstile widget verified in
`handler.js` (or a WAF rate-limit rule on the route) slots in without changing
anything downstream.

## Removing a photo

A photo is taken out with one command, from a clone of the repository:

```bash
python3 tools/gallery.py remove 22.jpg --reason "withdrawn at the member's request"
git commit -am "Remove a submitted photo" && git push
```

That unlists it (drops the manifest entry and regenerates the markup) and
purges the served bytes (the original, its thumbnail, and any hero slide) in
one commit, records it in `.contacts/removals.yml`, and re-derives both pages.
It also refuses to leave half a job done, which is the only real danger here:
a takedown that removed the markup but left the file would keep serving the
photo from its old URL, so `check` fails on any such drift.

**The relay handles removals too, over the same credential.** `POST /moderate`
takes a photo out the way `/upload` puts one in: it writes a takedown request
to the `submissions` branch and dispatches the publishing workflow, which then
runs `tools/publish_submissions.py` to apply it with the repository's own
`gallery.py`. The Worker still deletes nothing itself, which keeps one
implementation of "remove a photo" rather than two. The photo is off the site
on the next Pages build, usually within a minute.

The endpoint's only real check is the shape of the filename, and that is path
safety rather than authentication. The name is interpolated into a path on the
queue branch, so it must be a bare gallery filename: no slashes, no
dot-segments, nothing that could climb out of the directory it is written to.

**The admin password box is decoration, and please do not describe it as
protection.** It gates the click and nothing else. It is not sent, and there is
no secret here to check it against, because this is a static page -- a password
read in the browser would be a string in every visitor's devtools. What it does
do is stop a photo being deleted because someone clicked twice in a public
gallery, which is the job it is doing.

Say what that leaves: `/moderate` has the same posture as `/upload`, which is
also open to anyone who finds it. A deletion demanding a credential while an
upload does not would be inconsistent, and holding a real one would mean a real
secret to hand out, store and rotate for a task this size. The relay's only
defence on both routes is an `Origin` header, which any non-browser client can
set to anything -- that is a limit worth knowing, not a boundary to rely on.

Removals also stay available by hand with the command above, which is the
fallback if the Worker is unreachable, and `gallery.py check` catches it if the
two ever disagree.

### What a removal does and does not do

It **unlists** the photo and **purges the served bytes**. After that the page
no longer shows it and its URL stops serving it.

It does **not** make the photo unrecoverable. The bytes remain in git history,
fetchable at a pinned commit SHA, and web archives keep their own copies. For
a genuine consent withdrawal, someone still has to rewrite history
(`git filter-repo`) with a coordinated force-push, and request removal from
archives. Do not describe a removal to a member as erasure.

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
wrangler deploy
```

`wrangler deploy` prints the Worker's URL. Check it came up:

```bash
curl https://suas-photo-relay.<your-subdomain>.workers.dev/health
# {"ok":true,"configured":true}
```

It answers `configured:false` until the token secret exists, and the form will
refuse to submit in that state rather than failing halfway through an upload.

### 2. Point the site at the relay

In `index.html`, fill in the data attribute on the form:

```html
<form class="submit-form" id="photo-form" novalidate
      data-relay="https://suas-photo-relay.<your-subdomain>.workers.dev/upload">
```

The URL is public by design. While `data-relay` is empty the form says uploads
are not switched on yet, rather than letting someone fill the whole thing in
and then fail.

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
- the photos appear in the competition rail on `index.html` for you, marked as
  going live, with the name and other details you typed shown in the expanded
  view, and nothing added to the curated gallery grid
- `submission.json` stays on the submissions branch and never reaches `main`,
  so the email address never does either

## Changing the origin

`ALLOWED_ORIGIN` in `wrangler.toml` is what stops another site using your relay
as a free upload service. Update it if the site ever moves off
`usyd-astro.github.io`, and remember a custom domain counts as a different
origin.
