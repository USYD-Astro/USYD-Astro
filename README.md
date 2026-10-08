# Sydney University Astronomy Society website

The club site: <https://usydastro.org>. Plain PHP on the society's Namecheap
shared hosting account, served straight out of `public_html` by cPanel's Apache.

There is nothing to build. Edit a file, commit and push, then `git pull` on the
server, where `public_html` is a checkout of this repository; the host and account
live in `DEPLOY.md` (kept out of the repository, because it holds credentials).
`./deploy.sh`, the older rsync path, is retired. The setup before all of that —
GitHub Pages, a Cloudflare Worker upload relay, a personal access token, a
`submissions` branch and workflows that committed photos back into the repository
— is gone, because PHP can accept an upload and a photo can simply be a file.
`reference/` explains the even-older Google Sites version and is not deployed.

## What is here

```
index.php          the competition, the rail and the gallery
about.php          contact details and the committee
upload.php         where the form posts; validates and files the photos
admin.php          sign in: promote a photo, send one back, delete either
moderate.php       the remove control in the photo viewer
home.php           /home redirect, kept for old links
deploy.sh          retired rsync deploy; the server pulls from git now
includes/          bootstrap, the photo store, the events, the shared layout
assets/            stylesheet, scripts, logos, committee photos
photos/            the photographs (see below)
```

## The calendar

The home page's calendar is not scraped here. The Sydney Uni Canoe Club already
reads our Instagram the hard way — their own bridge opens the profile and each
post in a logged-out browser (it replaced the narro.info mirror, which died with
its subscription), OCRs the date, venue and time off each event poster, and
merges the result into their outdoors cache on a Git cron every fifteen minutes.
`includes/events.php` reads the astronomy events out of that published cache and
shows them; the alternative was a second copy of the same scraper, kept by us,
drifting from theirs.

The cost is a dependency worth naming: `usydcanoeclub.org` is where those events
come from. If it stops answering, the page keeps serving the last response it
got -- kept in the data directory beside `public_html`, refetched at most twice
an hour -- so a blip is invisible and a permanent outage degrades to a stale
calendar rather than an empty one. With no events at all, the section says so
and points at Instagram and Facebook instead.

That cache also carries the mirror's health — whether the last crawl succeeded
and when it last read the profile — and the calendar shows a short warning when
that read is failing or hours old, so a stale month is never passed off as the
current one.

The month grid is FullCalendar, loaded from a CDN, and is the only thing on the
site that needs a library. It is listed per page in `index.php` rather than in
the shared layout, so no other page pays for it. Without JavaScript the same
events are listed under the same heading by `calendar_list_markup()`.

## Two collections, and why

```
photos/        the home page gallery — what someone chose to show
photos/queue/  what people have sent in — shown in the rail
```

A photo **is** a file, and which directory it is in is what it means. The hero
slideshow and the photo gallery are rendered from `photos/`; the rail of
submissions is rendered from `photos/queue/`. Promoting a photo — "Add to
gallery" on the admin page — moves the file between the two and builds its
slideshow copy, which is what the old workflow did by moving an entry from
`submissions.yml` to `gallery.yml` and rebuilding the page.

That replaces two manifests, three generated markup blocks and a CI check that
existed to catch the three drifting apart. There is now one source of truth and
it cannot disagree with itself.

Photographs are re-encoded through GD as they arrive, which is where EXIF is
dropped — the page deliberately sends the original file, metadata and all, so
this is the only place it is scrubbed.

**Numbers are never reused.** A removed photo's number is spent for good: the
URL it was served from has been shared and cached against a photograph somebody
asked to have taken down, and handing that number to a later upload would serve a
different photo from the same address.

## The caretaker's jobs

- **Promote**: `/admin.php` → "Add to gallery" on anything in *Sent in*.
- **Send back**: the inverse, if the gallery gets something it should not have.
- **Delete**: from either list, or from the photo viewer itself. The viewer's
  control asks for the same password and the photo comes off the site at once.
- **Takedown record**: every removal is appended to `removals.log` in the data
  directory with the file, the time and the reason given.

The contact log (`submissions.log`) holds who sent what. Both logs live beside
`public_html`, never in it: the old design committed submitter email addresses to
a branch of a public repository, whatever it intended.

## Deploying

The server's `public_html` is a checkout of this repository on `main`, so a deploy
is a push and a pull:

```bash
git push origin main
ssh -p <port> <user>@<host> 'cd public_html && git pull'
```

The host, port and account are in `DEPLOY.md`, which is deliberately not
committed. Nothing is mirrored from a working tree, so what is live is exactly
what `main` says it is — which is also why `assets/` and `photos/` can no longer
drift from the repository the way the rsync mirror allowed.

## Configuration

`includes/config.example.php` is a template for `~/suas-config.php`, one level
above the web root. It holds the admin password hash and the data directory path:

```bash
php -r 'echo password_hash("a-password-you-pick", PASSWORD_DEFAULT), PHP_EOL;'
cp includes/config.example.php ~/suas-config.php   # then paste the hash in
```

The same hash guards the admin page and the viewer's remove control. Without a
config file the pages still render, but nothing can be administered and uploads
have nowhere to record themselves.
