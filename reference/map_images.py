#!/usr/bin/env python3
"""Map every Google Sites CDN image on each rescued page to its surrounding
markup context, so each image can be identified and named meaningfully."""
import re
import pathlib

REF = pathlib.Path(__file__).resolve().parent
LIVE = REF / "live"

IMG_RE = re.compile(r"https://lh3\.googleusercontent\.com/sitesv/[A-Za-z0-9_-]+")
ALT_RE = re.compile(r'alt="([^"]{0,80})"')
ALA_RE = re.compile(r'aria-label="([^"]{0,80})"')

for page in ["index", "about", "events", "signup"]:
    f = LIVE / f"{page}.html"
    if not f.exists():
        continue
    html = f.read_text(encoding="utf-8", errors="replace")
    print(f"\n{'=' * 72}\n{page.upper()}  ({len(html):,} chars)\n{'=' * 72}")

    seen: dict[str, int] = {}
    for m in IMG_RE.finditer(html):
        url = m.group(0)
        if url in seen:
            continue
        seen[url] = m.start()
        before = html[max(0, m.start() - 300) : m.start()]
        after = html[m.end() : m.end() + 140]

        # Is this url inside a <style> block (a CSS background / hero image)?
        style_open = html.rfind("<style", 0, m.start())
        style_close = html.rfind("</style>", 0, m.start())
        where = "CSS-BG" if style_open > style_close else "IMG"

        alts = ALT_RE.findall(before + after)
        alas = ALA_RE.findall(before + after)
        hint = (alts or alas or [""])[0]

        # trim the long css noise from the context
        ctx = re.sub(r"\s+", " ", before[-120:])

        print(f"\n[{len(seen):2}] {where}  id=...{url[-20:]}  hint={hint!r}")
        print(f"     before: ...{ctx}")
        print(f"     after : {re.sub(r'\s+', ' ', after[:90])}")

    print(f"\n-- {page}: {len(seen)} unique images")
