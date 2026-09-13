# USYD-Astro — Sydney University Astronomy Society website

A static recreation of the society's website, `usydastro.au`, which went
offline and survives only as an Internet Archive capture.

- **Reference capture:** <https://web.archive.org/web/20250316113431/https://www.usydastro.au/>
- **Live source of truth:** the original Google Site was never deleted — it is still up at <https://sites.google.com/view/usydastro>

## Why this is plain HTML

The original was **not** PHP. It was a Google Sites site: the footer said
"Google Sites" and the markup was Google's JS-hydrated app with hashed
class names. Rendering it produced ordinary static HTML, so a static
recreation loses nothing — and it deploys free on GitHub Pages, which
cannot execute PHP anyway.

## Rescuing the images

The images are the part that was genuinely at risk:

- The Wayback Machine captured the site's HTML but **never captured its
  images**. Those files lived on `lh3..lh6.googleusercontent.com`, not on
  `usydastro.au`, so the archived pages reference URLs that now return
  **403** with zero captures in the archive.
- The original CDN URLs are also version-scoped: Google rotates the token
  in each `sitesv` URL on every page load, so HTML saved a few minutes ago
  can no longer be used to download its own images.

Everything under `assets/img/` was therefore rescued by **fetching a page
and downloading its images in the same breath**, retrying until complete.
See `reference/rescue_images.py`. All 41 original images were recovered,
including the 19 event photos and the 11 committee portraits.

## Layout

```
index.html      Home           about.html    About
submit.html     Submit Photos  home.html     legacy /home alias
assets/css/     stylesheet     assets/js/    nav, lightbox, submission form
assets/data/    gallery.yml — the photo manifest
assets/img/     rescued images, gallery originals and generated thumbnails
tools/          gallery.py — builds thumbnails and the gallery markup
.github/        CI check that the gallery stays in sync
reference/      provenance: original HTML, archive HTML, rescue scripts
```

`reference/` is kept deliberately: it holds the untouched source material
and the scripts that recovered it, so the recreation can be audited or
repeated.

## Photo gallery and submissions

The home page gallery is **generated, not hand-written**. Four things
describe it, and `tools/gallery.py` keeps them in agreement:

| Path | Role |
| --- | --- |
| `assets/data/gallery.yml` | the manifest — which photos, their alt text and credit |
| `assets/img/events/` | the full-size originals the lightbox shows |
| `assets/img/events/thumbs/` | 480 px thumbnails the grid loads |
| `index.html` | the markup between the `gallery:start` and `gallery:end` markers |

```bash
python3 tools/gallery.py sync     # rebuild thumbnails and markup from the manifest
python3 tools/gallery.py check    # fail if the four have drifted apart
```

Requires `pillow` and `pyyaml`. CI runs `check` on every change to the
gallery, so a photo dropped into `assets/img/events/` by hand without a
manifest entry is caught (`.github/workflows/gallery.yml`).

This replaced nineteen hand-written `<button>` elements that pointed at
full-resolution originals, which meant the grid downloaded 7.65 MB of images
to display thumbnails. It now loads about 0.5 MB, and the originals are still
what the lightbox opens.

### Adding a submitted photo

```bash
python3 tools/gallery.py add ~/Downloads/trip-photo.jpg \
    --credit "Jane Citizen" --email jane@example.com --name "Jane Citizen"
```

That derives a ≤1600 px original and a 480 px thumbnail, **drops all EXIF
metadata** so the coordinates phones attach never reach the site, appends a
manifest entry and regenerates the markup. Commit and push, and the photo is
live. The tool only ever *appends* to the manifest, so hand-written comments
in it survive.

### How visitors send photos

`submit.html` is the public door. It is a hand-off rather than an upload: the
visitor's browser shrinks each photo and strips its metadata, then passes the
prepared files to their own email app — through the OS share sheet
(`navigator.share` with files, the normal path on a phone) or a pre-filled
`mailto:`.

It has to work that way. A static site has nowhere to put uploaded bytes, and
a public page cannot hold a credential that would let it commit to this
repository: anything in the page is readable by anyone, and a committed
`github_pat_` is revoked by GitHub's secret scanning regardless. Getting a
GitHub token into a browser needs a server-side relay, because GitHub's OAuth
endpoints reject cross-origin requests. A serverless function holding a
fine-grained token in a secret would allow genuine anonymous upload with a
server-verified captcha — that is the upgrade path, and it would replace only
the hand-off, leaving the manifest and tooling untouched.

Three things to know when maintaining it:

- **No captcha, deliberately.** Verifying one needs a server. The form carries
  a honeypot field instead, and the email hand-off is itself a spam barrier.
- **Contact details are never committed.** `add --email` writes them to
  `submissions/contacts.yml`, which is gitignored, because the whole
  repository is published by GitHub Pages.
- **Consent is a required checkbox.** Nothing joins the gallery until a
  committee member runs `add`, so submissions are curated by default.

## Running locally

Any static file server works:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

## Deployment

Static files, no build step. On GitHub Pages:

**Settings → Pages → Deploy from a branch → `main` / (root)**

The site publishes at `https://usyd-astro.github.io/USYD-Astro/` — a
project site, not the org root, because the repo is not named
`USYD-Astro.github.io`.

To restore the original domain, add a `CNAME` file containing
`usydastro.au` and point DNS at GitHub Pages (if the domain is still held).

## Faithfulness and deliberate deviations

Recreated from the 2025-03-16 capture. Copy, structure, navigation,
brand colour (`#1a5dad`) and typography all follow the original.

Two deliberate departures:

1. **Sign Up** — the original embedded a Mailchimp form on its own page.
   That form is gone, so the sign-up information now lives on the home
   page as static content, and the nav item points at the USU club page.
2. **Google Sites chrome** — the "Google Sites / Report abuse" footer is
   replaced with society attribution.

## Later changes

Applied after the recreation, at the society's request. These move the
site away from the 2025-03-16 capture rather than toward it:

- **Dark theme** — the page background is black instead of white. This
  forced the text and link colours to be lightened too, because the
  original's dark-on-light palette would otherwise be unreadable.
- **Full-page backdrop** — the light-painting photo that the original used
  as the gallery band is now the backdrop for the whole site. It sits on a
  fixed layer under the content (see `body::before`), so it stays still
  while the page scrolls over it, and the section bands and panels are
  translucent so it reads through. A gradient scrim keeps body copy
  legible: the photo's mean luminance is only ~18%, so the darkening is
  deliberately light enough that the image is still visible.
- **About is unlinked** — `about.html` still exists and is served, but
  nothing in the navigation points at it any more.
- **Navigation** — "Member Sign Up" was renamed to "Sign Up", and that
  nav item now links to the USU club page instead of a page on this site.
- **Sign Up merged into Home** — the standalone `signup.html` was removed
  and its content moved to the home page, between the events and gallery
  sections.
- **Blog removed** — the original nav linked to `blog.usydastro.au`, a
  separate subdomain that is dead and was never archived. The nav item and
  its placeholder page have been removed.
- **Events removed** — the standalone `events.html` was deleted. It held the
  only embed of the society's original public Google Calendar
  (`j5u3mqfmna54rntsb8rmqvhcp8@group.calendar.google.com`), whose owning
  account nobody current can access, so its newest events date from May
  2024 and it can no longer be maintained. The nav item was removed, the
  home page's "See upcoming events" link now points at the society's
  Facebook page, and `hero-events.jpg` remains in `assets/img/` as part
  of the rescued image set but is no longer referenced. A future revival
  would repoint the site at a new, committee-owned public Google Calendar.
- **Footer** — the generic link icon Google Sites supplied was replaced
  with a real Discord mark; the email address moved out of the fine print
  into the icon row, whose heading became "Contact"; and the bottom line
  now carries a copyright and a credit.
- **Footer background** — the footer is styled like the top bar (translucent
  dark surface with a hairline rule) instead of the original solid brand-blue
  bar, which glared against the dark theme.

## Link status at time of writing

| Link | Status |
| --- | --- |
| facebook.com/usydastronomy | live |
| instagram.com/usydastro | live |
| usu.edu.au/clubs/astronomy-society | 404 |
| discord.gg/nGVW4qJMSV | dead invite |

Original links are preserved as-is rather than "fixed", since the point is
to reproduce the site rather than correct it. Contributions should not
silently repoint them.

## Photo credits

Photographs are the work of society members, credited on the site as
Matthew D'Souza, William Giang and Royce Chiu. The SUAS logo and the
"Supported by USU" mark belong to the society and the University of
Sydney Union respectively.
