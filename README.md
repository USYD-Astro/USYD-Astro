# Sydney University Astronomy Society website

<https://usydastro.org>. Plain PHP on the society's Namecheap hosting, with no
build step. `public_html` on the server is a checkout of this repository, so what
is live is exactly what is committed.

## Editing the site

The site is made of files, and changing it means editing one. There is no CMS
and nothing to compile.

| To change | Edit |
| --- | --- |
| Competition blurb, trips, on-campus events, calendar and join text | `index.php` |
| Contact details and the committee | `about.php` |
| Header, navigation and hero band, on every page | `includes/layout/header.php` |
| Footer, its sign-up link and social icons | `includes/layout/footer.php` |
| Colours, type, spacing and layout | `assets/css/style.css` |
| Nav menu, hero slideshow, photo viewer, gallery rail | `assets/js/main.js` |
| Calendar | `assets/js/calendar.js` |
| Upload form | `assets/js/submit.js` |
| Logo, hero images, committee photos | `assets/img/` |

A page sets `$page_title`, `$hero_title`, `$hero_image` and a few others, then
includes the shared header and footer. They are listed at the top of
`includes/layout/header.php`, and `about.php` is short enough to copy as the
starting point for a new page.

The rest of the files: `upload.php` takes the form, `admin.php` is the sign-in
for promoting, sending back and deleting photos, and `moderate.php` backs the
remove control in the photo viewer. `home.php` is a redirect kept for old links.
`reference/` is the old Google Sites capture and the scripts that rebuilt it;
the `.htaccess` rules answer it with a 404, along with `includes/`.

The pages are ordinary PHP, so with PHP installed you can preview a checkout
locally before pushing:

```
php -S localhost:8000
```

## Photos

A photo is a file, and the directory it sits in decides where it appears:

- `photos/`: the home page gallery, which also feeds the hero slideshow
- `photos/queue/`: photos sent in through the form, shown in the rail

Copying a file into `photos/` publishes it, and deleting one takes it down.
`photos/thumbs/` and `photos/slides/` hold generated copies, so leave them alone.

The credit line and caption are not in the file. They live in `photos.json`, in
the data directory beside `public_html` rather than inside it, along with the
contact log (`submissions.log`) and the removals log (`removals.log`). Promoting,
sending back, deleting and crediting a photo are done on `/admin.php`, which
rewrites that file. A photo's number is never reused, because its URL may already
have been shared pointing at that photograph.

## Calendar

The calendar reads astronomy events from a cache published by the Sydney Uni
Canoe Club, through `includes/events.php`. Events are not entered here: post to
Instagram and it picks the event up. If the cache cannot be reached the last good
response is reused, so the calendar goes stale rather than empty.

## Deploying

The server pulls from `main`, so a deploy is a push and a pull:

```
git push origin main
ssh -p <port> <user>@<host> 'cd public_html && git pull --ff-only'
```

The host, port and account are in `DEPLOY.md`, which is not committed because it
holds credentials. `deploy.sh` is the older rsync path and is no longer used.
`server-state.txt` records the revision last verified live.

## Configuration

`~/suas-config.php`, one level above the web root and never committed, holds the
admin password hash, the data directory and the upload limits. Copy the template
and generate a hash for it:

```
php -r 'echo password_hash("pick-a-password", PASSWORD_DEFAULT), PHP_EOL;'
cp includes/config.example.php ~/suas-config.php
```

Without that file the pages still render, but the admin page will not log anyone
in and uploads have nowhere to record themselves.
