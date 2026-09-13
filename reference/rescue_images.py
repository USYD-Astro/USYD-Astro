#!/usr/bin/env python3
"""Rescue every image from the still-live Google Site.

Google Sites `sitesv` CDN tokens are scoped to a single page load and go
stale within minutes, so a saved page's HTML is useless for downloading.
This script therefore fetches a page and immediately downloads all of its
images, retrying until every image on every page has been captured.

Images are de-duplicated by content hash, so the same photo appearing on
several pages (and under different tokens each fetch) is stored once.
"""
import hashlib
import pathlib
import re
import time
import urllib.request

REF = pathlib.Path(__file__).resolve().parent
OUT = REF / "originals"
OUT.mkdir(parents=True, exist_ok=True)

BASE = "https://sites.google.com/view/usydastro"
PAGES = ["index", "about", "events", "signup", "home"]
ATTEMPTS = 8

# Stop at quotes, whitespace, backslashes, angle brackets and CSS parens.
IMG_RE = re.compile(r"https://lh[0-9]\.googleusercontent\.com/sitesv/[^\"'\s\\<>()]+")
SIZE_RE = re.compile(r"=s\d+(-c)?$|=w\d+(-h\d+)?(-[a-z]+)*$|=w\d+$")

UA = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Referer": "https://sites.google.com/",
}


def fetch(url: str, binary: bool = False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read(), r.headers.get("Content-Type", "")


def classify(html: str, pos: int) -> str:
    before = html[max(0, pos - 260) : pos]
    if 'rel="icon"' in before:
        return "favicon"
    if 'itemprop="thumbnailUrl"' in before or 'property="og:image"' in before:
        return "social"
    if "IFuOkc" in before and "background-image" in before:
        return "hero"
    if "nQBJnb" in before or 'aria-label="Carousel image"' in before:
        return "carousel"
    return "content"


def parse(html: str):
    """Return [(index, role, url)] in document order, first occurrence only."""
    out, seen = [], set()
    for m in IMG_RE.finditer(html):
        url = SIZE_RE.sub("", m.group(0))
        if url in seen:
            continue
        seen.add(url)
        out.append((len(out) + 1, classify(html, m.start()), url))
    return out


by_hash: dict[str, str] = {}      # sha -> filename
counters: dict[str, int] = {}
resolved: dict[tuple[str, int], str] = {}
manifest: list[tuple[str, int, str, str, str]] = []

for page in PAGES:
    slug = "" if page == "index" else page
    for attempt in range(1, ATTEMPTS + 1):
        try:
            raw, _ = fetch(f"{BASE}/{slug}")
        except Exception as e:  # noqa: BLE001
            print(f"  {page}: page fetch failed ({e}), retrying")
            time.sleep(2)
            continue
        html = raw.decode("utf-8", "replace")
        items = parse(html)

        if len(items) < 2:  # bare shell variant, not the rendered page
            print(f"  {page}: shell variant ({len(items)} imgs), retrying")
            time.sleep(1)
            continue

        # Save the richest HTML we have seen for this page.
        best = REF / "live" / f"{page}.html"
        if not best.exists() or len(html) > len(best.read_text(errors="replace")):
            best.write_text(html, encoding="utf-8")

        got = missed = 0
        for idx, role, url in items:
            if (page, idx) in resolved:
                continue
            try:  # download immediately — token is only valid right now
                data, ctype = fetch(url + "=w1280", binary=True)
            except Exception:  # noqa: BLE001
                missed += 1
                continue
            if not data or len(data) < 100:
                missed += 1
                continue
            sha = hashlib.sha256(data).hexdigest()
            if sha not in by_hash:
                ext = "png" if "png" in ctype else "webp" if "webp" in ctype else "jpg"
                counters[role] = counters.get(role, 0) + 1
                name = f"{role}-{counters[role]:02d}.{ext}"
                (OUT / name).write_bytes(data)
                by_hash[sha] = name
            resolved[(page, idx)] = by_hash[sha]
            got += 1

        print(f"  {page:7} attempt {attempt}: {got:2} saved, {missed:2} missed "
              f"({len(items)} on page)")

        if all((page, i) in resolved for i, _, _ in items):
            break
        time.sleep(1)

# ---- manifest ----------------------------------------------------------
with (REF / "manifest.tsv").open("w") as fh:
    fh.write("page\tidx\trole\tfile\tsha\n")
    for page in PAGES:
        slug = "" if page == "index" else page
        html = (REF / "live" / f"{page}.html").read_text(errors="replace")
        for idx, role, url in parse(html):
            fh.write(f"{page}\t{idx}\t{role}\t{resolved.get((page, idx), 'MISSING')}\t{url}\n")

total = len(resolved)
print(f"\nSaved {len(by_hash)} unique files, {total} page/image slots resolved")
print("Manifest -> reference/manifest.tsv")
