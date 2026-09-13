#!/usr/bin/env python3
"""Render a page at true desktop width inside the narrow preview viewport.

Media queries respond to the viewport, and the preview viewport is only
~582px wide — so a page opened directly always renders its mobile layout.
Embedding the bundle in an iframe via `srcdoc` gives that document its own
1280px viewport, and a CSS transform scales the result down to fit.
"""
import html
import pathlib
import sys

REF = pathlib.Path(__file__).resolve().parent
IFRAME_W = 1280
SCALE = 0.45
IFRAME_H = 3400

for page in sys.argv[1:] or ["index"]:
    bundle = (REF / f"preview-{page}.html").read_text()
    wrapper = f"""<!doctype html><meta charset="utf-8">
<title>desktop check — {page}</title>
<style>
  body {{ margin:0; background:#333; }}
  .stage {{ width:{IFRAME_W * SCALE}px; height:{IFRAME_H * SCALE}px; overflow:hidden; }}
  iframe {{ width:{IFRAME_W}px; height:{IFRAME_H}px; border:0;
            transform:scale({SCALE}); transform-origin:top left; background:#fff; }}
</style>
<div class="stage">
  <iframe srcdoc="{html.escape(bundle, quote=True)}"></iframe>
</div>
"""
    out = REF / f"desktop-{page}.html"
    out.write_text(wrapper)
    print(f"  {out.relative_to(REF.parent)}  {out.stat().st_size / 1024 / 1024:.2f} MB")
