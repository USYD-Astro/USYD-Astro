#!/usr/bin/env python3
"""Dump the document-order structure of each rescued page.

Images are labelled with their 1-based document index, which lines up
with the `idx` column of page-order.tsv, so an image's position in the
outline can be resolved to an actual rescued file.
"""
import html as htmllib
import pathlib
import re

REF = pathlib.Path(__file__).resolve().parent
LIVE = REF / "live"
PAGES = ["index", "about", "events", "signup"]

TOKEN = re.compile(
    r"(?P<h><h(?P<lvl>[1-6])[^>]*>(?P<hbody>.*?)</h(?P=lvl)>)"
    r"|(?P<p><p[^>]*>(?P<pbody>.*?)</p>)"
    r"|(?P<img><img[^>]*>)"
    r"|(?P<bg>background-image:\s*url\(\s*(?P<bgurl>[^)]+)\))",
    re.S,
)
CENY = re.compile(r'class="[^"]*CENy8b')
TAG = re.compile(r"<[^>]+>")
SKIP = re.compile(r"^(&nbsp;|\s)*$")


def clean(s: str) -> str:
    s = TAG.sub("", s)
    s = htmllib.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


out_lines = []
for page in PAGES:
    html = (LIVE / f"{page}.html").read_text(encoding="utf-8", errors="replace")
    lines = [f"\n{'=' * 78}\n{page.upper()}\n{'=' * 78}"]
    img_n = 0
    for m in TOKEN.finditer(html):
        if m.group("h"):
            txt = clean(m.group("hbody"))
            if txt:
                lines.append(f"\n{'#' * int(m.group('lvl'))} H{m.group('lvl')}: {txt}")
        elif m.group("p"):
            txt = clean(m.group("pbody"))
            if txt and not SKIP.match(txt):
                lines.append(f"    p: {txt}")
        elif m.group("img"):
            tag = m.group("img")
            src = re.search(r'src="([^"]+)"', tag)
            if not src:
                continue
            img_n += 1
            role = "carousel" if "nQBJnb" in html[max(0, m.start() - 260) : m.start()] else "img"
            lines.append(f"  [IMG id={img_n:2} {role}]")
        elif m.group("bg"):
            url = m.group("bgurl")
            if "googleusercontent" not in url and "atari" not in url:
                continue
            img_n += 1
            before = html[max(0, m.start() - 300) : m.start()]
            kind = "banner" if "IFuOkc" in before else "cssbg"
            lines.append(f"  [{kind.upper()} id={img_n:2}]")
    out_lines += lines
    (REF / f"structure-{page}.txt").write_text("\n".join(lines) + "\n")

all_text = "\n".join(out_lines)
(REF / "structure-all.txt").write_text(all_text + "\n")
print(all_text[:5000])
print(f"\n... full outline -> reference/structure-all.txt ({len(all_text):,} chars)")
