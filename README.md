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
index.html      Home          about.html    About
home.html       legacy /home alias
assets/css/     stylesheet    assets/js/    nav + lightbox
assets/img/     rescued images
reference/      provenance: original HTML, archive HTML, rescue scripts
```

`reference/` is kept deliberately: it holds the untouched source material
and the scripts that recovered it, so the recreation can be audited or
repeated.

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
