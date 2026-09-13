#!/usr/bin/env python3
"""Recover the per-page document order of images.

De-duplication by content hash in rescue_images.py lost the information
about *where* on each page an image sits. Because CDN tokens are
per-page-load, the only reliable way to recover ordering is to fetch a
page and hash each of its images in the same breath.

Downloads run concurrently, so downloading images smaller than a
threshold is quick; a content-length probe would be slower than just
fetching them.
"""
import concurrent.futures as cf
import hashlib
import pathlib
import re
import urllib.request

REF = pathlib.Path(__file__).resolve().parent
OUT = REF / "originals"
BASE = "https://sites.google.com/view/usydastro"
PAGES = ["index", "about", "events", "signup"]

IMG_RE = re.compile(r"https://lh[0-9]\.googleusercontent\.com/sitesv/[^\"'\s\\<>()]+")
SIZE_RE = re.compile(r"=s\d+(-c)?$|=w\d+(-h\d+)?(-[a-z]+)*$")
UA = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Referer": "https://sites.google.com/",
}

known: dict[str, str] = {}
for f in OUT.iterdir():
    known[hashlib.sha256(f.read_bytes()).hexdigest()] = f.name
print(f"known rescued files: {len(known)}\n")


def classify(html: str, pos: int) -> str:
    before = html[max(0, pos - 260) : pos]
    if 'rel="icon"' in before:
        return "logo"
    if 'itemprop="thumbnailUrl"' in before or 'property="og:image"' in before:
        return "social"
    if "IFuOkc" in before and "background-image" in before:
        return "hero"
    if "nQBJnb" in before or 'aria-label="Carousel image"' in before:
        return "carousel"
    return "content"


def get(url: str, timeout: int = 60) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def hash_one(url: str) -> str:
    try:
        return hashlib.sha256(get(url + "=w1280")).hexdigest()
    except Exception:  # noqa: BLE001
        return "?"


all_rows = []
for page in PAGES:
    slug = "" if page == "index" else page
    try:
        html = get(f"{BASE}/{slug}").decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        print(f"  {page}: FETCH FAILED {e}")
        continue

    seen, entries = set(), []
    for m in IMG_RE.finditer(html):
        url = SIZE_RE.sub("", m.group(0))
        if url in seen:
            continue
        seen.add(url)
        entries.append((len(entries) + 1, classify(html, m.start()), url))

    with cf.ThreadPoolExecutor(max_workers=10) as ex:
        shas = list(ex.map(hash_one, [u for _, _, u in entries]))

    order = [
        (idx, role, known.get(sha, "?"))
        for (idx, role, _), sha in zip(entries, shas)
    ]
    ok = sum(1 for _, _, f in order if f != "?")
    print(f"=== {page.upper()} — {ok}/{len(order)} identified ===")
    for idx, role, f in order:
        print(f"  idx{idx:3}  {role:9} {f}")
    print()
    all_rows += [(page, idx, role, f) for idx, role, f in order]

with (REF / "page-order.tsv").open("w") as fh:
    fh.write("page\tidx\trole\tfile\n")
    for r in all_rows:
        fh.write("\t".join(map(str, r)) + "\n")
print("-> reference/page-order.tsv")
