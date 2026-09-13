# Photo upload relay

The site is served by GitHub Pages, which cannot accept an upload. Neither can
the page hold a credential that writes to the repository: anything in the page
is readable by anyone, and a token committed to a public repository is revoked
by GitHub's secret scanning. So the credential lives here, on a small Worker
that the browser talks to, and the browser never sees it.

What it does, in order: checks the origin, checks the captcha, refuses
oversized or non-image uploads, and commits what is left to a `submissions`
branch. It deliberately does **not** touch image bytes — the browser has
already re-encoded each photo, and the publishing Action re-encodes again, so
metadata is stripped at both ends.

```
browser  --POST multipart-->  relay (Cloudflare Worker)
                                 |  verifies Turnstile
                                 |  validates size, type and count
                                 v
                              GitHub API  -->  submissions branch
                                                 |
                                    .github/workflows/publish-submission.yml
                                                 v
                                     assets/img/events + gallery.yml + index.html
```

## Deploying it

About five minutes, once. There is no way to avoid this step: the token has to
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

### 3. Make a Turnstile widget

<https://dash.cloudflare.com/?to=/:account/turnstile>

Add a widget, and under its settings add the site
`usyd-astro.github.io`. You get two values:

- the **site key** — public, goes in `submit.html`
- the **secret key** — private, goes on the Worker:

```bash
wrangler secret put TURNSTILE_SECRET
```

### 4. Point the site at the relay

In `submit.html`, fill in the two data attributes on the form:

```html
<form class="submit-form" id="photo-form" novalidate
      data-relay="https://suas-photo-relay.<your-subdomain>.workers.dev/upload"
      data-turnstile="<your site key>">
```

Both values are public by design. While `data-relay` is empty the form says
uploads are not switched on yet, rather than letting someone fill the whole
thing in and then fail.

## Testing it

```bash
cd relay
npm test          # node --test test/
```

The handler takes `fetch` as an injection point, so the suite runs with no
Cloudflare, no network and no real token. It covers the validation rules, the
captcha gate, branch creation, the commit calls, and the failure paths.

To try it end to end without burning a real submission, run `wrangler dev`,
point `data-relay` at the local URL, and upload something small. Check that:

- the photo appears on the `submissions` branch, not on `main`
- running the publishing workflow turns it into a gallery entry
- `submission.json` stays on the submissions branch and never reaches `main`

## Changing the origin

`ALLOWED_ORIGIN` in `wrangler.toml` is what stops another site using your relay
as a free upload service. Update it if the site ever moves off
`usyd-astro.github.io`, and remember a custom domain counts as a different
origin.
