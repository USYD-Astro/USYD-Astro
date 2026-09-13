#!/usr/bin/env python3
"""Bundle a site page into one self-contained HTML file for previewing.

The desktop preview serves only a single HTML file — sibling assets 404 —
so stylesheets and images are inlined here. Large images are downscaled
for the bundle only; the real site keeps the full-resolution originals.
"""
import base64
import io
import pathlib
import re
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
REF = ROOT / "reference"
MAX_W = 1100  # preview-only downscale


def data_uri(rel: str) -> str:
    p = ROOT / rel
    if not p.exists():
        return ""
    if p.suffix.lower() == ".png" and p.stat().st_size < 60_000:
        return "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode()
    im = Image.open(p)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im).convert("RGB")
    else:
        im = im.convert("RGB")
    if im.width > MAX_W:
        im.thumbnail((MAX_W, MAX_W * 4))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=76)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def build(page: str) -> pathlib.Path:
    src = (ROOT / f"{page}.html").read_text()

    # 1. inline the stylesheet alongside its url(...) references. Those are
    #    written relative to the CSS file (e.g. ../img/events-banner.jpg), so
    #    resolve them against the stylesheet's own directory.
    def css_inline(m):
        css_path = ROOT / m.group(1)
        css = css_path.read_text()
        base = css_path.parent.relative_to(ROOT)

        def resolve(url: str):
            if url.startswith(("http:", "https:", "//", "data:")):
                return None
            parts: list[str] = []
            for part in (base / url).parts:
                if part == "..":
                    if parts:
                        parts.pop()
                elif part != ".":
                    parts.append(part)
            rel = pathlib.Path(*parts)
            return str(rel) if (ROOT / rel).exists() else None

        def swap(mm):
            rel = resolve(mm.group(2))
            return f"url('{data_uri(rel)}')" if rel else mm.group(0)

        css = re.sub(r"url\((['\"]?)([^'\")]+)\1\)", swap, css)
        return f"<style>\n{css}\n</style>"

    src = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css_inline, src)

    # 2. inline hero background images written in style attributes
    src = re.sub(
        r"url\('(assets/[^']+)'\)", lambda m: f"url('{data_uri(m.group(1))}')", src
    )

    # 3. inline <img src> and <script src>. Also rewrite srcset candidates:
    #    a data-uri src is ignored whenever a width-descriptor srcset is
    #    present, so leaving relative candidates in would break every img
    #    that has one (the hero slides do).
    src = re.sub(
        r'(<img[^>]*\ssrc=")(assets/[^"]+)(")',
        lambda m: m.group(1) + data_uri(m.group(2)) + m.group(3),
        src,
    )
    def srcset_swap(m):
        parts = []
        for cand in m.group(1).split(", "):
            url, _, desc = cand.partition(" ")
            if url.startswith("assets/"):
                uri = data_uri(url)
                parts.append(f"{url} {desc}" if not uri else f"{uri} {desc}")
            else:
                parts.append(cand)
        return 'srcset="' + ", ".join(parts) + '"'

    src = re.sub(r'srcset="([^"]+)"', srcset_swap, src)
    def js_inline(m):
        return (
            "<script>\n"
            + (ROOT / m.group(1)).read_text()
            + "\n</script>"
        )

    src = re.sub(
        r'<script src="(assets/js/[^"]+)"></script>', js_inline, src
    )
    # data-full attributes are only used by the lightbox; point them at the thumb
    src = re.sub(r'data-full="assets/[^"]*"', "", src)

    # 4. stop Google Fonts from blocking a local preview
    src = re.sub(r'<link[^>]*fonts\.gstatic\.com[^>]*>', "", src)

    out = REF / f"preview-{page}.html"
    out.write_text(src)
    return out


for page in sys.argv[1:] or ["index"]:
    p = build(page)
    print(f"  {p.relative_to(ROOT)}  {p.stat().st_size / 1024 / 1024:.2f} MB")
