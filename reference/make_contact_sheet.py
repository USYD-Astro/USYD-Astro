#!/usr/bin/env python3
"""Build a self-contained contact sheet of the rescued originals.

The desktop preview only serves a single HTML file (sibling assets 404),
so every thumbnail is downscaled and inlined as a data URI.
"""
import base64
import io
import pathlib

from PIL import Image

REF = pathlib.Path(__file__).resolve().parent
SRC = REF / "originals"
THUMB = (300, 210)


def thumb_b64(path: pathlib.Path) -> str:
    im = Image.open(path)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (20, 20, 20, 255))
        im = Image.alpha_composite(bg, im).convert("RGB")
    else:
        im = im.convert("RGB")
    im.thumbnail(THUMB)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=72)
    return base64.b64encode(buf.getvalue()).decode()


cells = []
for p in sorted(SRC.iterdir()):
    if p.name == "logo.png":
        continue  # shown separately below, it is square and large
    cells.append(
        f'<figure><img src="data:image/jpeg;base64,{thumb_b64(p)}" alt="">'
        f"<figcaption>{p.name}</figcaption></figure>"
    )

logo = thumb_b64(SRC / "logo.png")

html = f"""<!doctype html><meta charset="utf-8">
<title>SUAS rescued originals</title>
<style>
 body {{ background:#111; color:#eee; font:12px/1.35 system-ui,sans-serif; margin:14px; }}
 .grid {{ display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }}
 figure {{ margin:0; background:#1e1e1e; border-radius:5px; overflow:hidden; }}
 img {{ width:100%; height:170px; object-fit:contain; display:block; background:#000; }}
 figcaption {{ padding:4px 6px; color:#7fd8c0; font-size:12px; font-weight:600; }}
 .logo {{ margin-bottom:16px; display:flex; gap:14px; align-items:center; }}
 .logo img {{ width:180px; height:180px; }}
 h2 {{ margin:6px 0 12px; font-size:15px; color:#9ab; }}
</style>
<h2>SUAS rescued originals — {len(cells) + 1} files</h2>
<div class="logo"><img src="data:image/jpeg;base64,{logo}" alt="">
 <div><b style="font-size:14px;color:#7fd8c0">logo.png</b><br>1650&times;1650 site logo / favicon</div></div>
<div class="grid">{''.join(cells)}</div>
"""

out = REF / "contact-sheet.html"
out.write_text(html)
print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB, {len(cells) + 1} images)")
