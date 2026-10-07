# Sydney University Astronomy Society website

The club site: <https://usydastro.org>. Plain PHP on the society's Namecheap
shared hosting account, served straight out of `public_html` by cPanel's Apache.

There is nothing to build. Edit a file, run `./deploy.sh`, done. The old setup —
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
deploy.sh          rsync the site to the server
includes/          bootstrap, the photo store, the shared layout
assets/            stylesheet, scripts, logos, committee photos
photos/            the photographs (see below)
```

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

```bash
./deploy.sh              # deploy
./deploy.sh --dry-run    # show what would change
```

It mirrors the pages, `includes/` and `assets/` exactly, and only ever *adds* to
`photos/` — `--ignore-existing` — so deploying cannot delete the photographs
people have sent in since the last one. That is why the photographs are not under
`assets/`: that directory is mirrored, so a photo kept there would be deleted by
the next deploy.

The script expects an SSH key at `~/.ssh/suas_deploy`; its header explains how to
create and authorise one, and how to override the host, port and key.

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
