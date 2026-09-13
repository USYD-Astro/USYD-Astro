#!/usr/bin/env python3
"""Copy the rescued originals into assets/img under meaningful names.

The mapping below was established from page-order.tsv (document order)
plus visual identification of a downscaled contact sheet.

Note: `carousel-08.jpg` is both the 8th gallery photo *and* the Events
page banner. It is therefore copied to two destinations, so the explicit
mappings are merged over the generated gallery names rather than the
other way round (an earlier version silently lost the banner this way).
"""
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "reference" / "originals"
IMG = ROOT / "assets" / "img"
IMG.mkdir(parents=True, exist_ok=True)
(IMG / "committee").mkdir(exist_ok=True)
(IMG / "events").mkdir(exist_ok=True)

# rescued file -> [destinations]
MAP: dict[str, list[str]] = {}

# event gallery, in carousel order
for i in range(1, 20):
    stem = f"carousel-{i:02d}"
    for ext in ("jpg", "png"):
        if (SRC / f"{stem}.{ext}").exists():
            MAP.setdefault(f"{stem}.{ext}", []).append(f"events/{i:02d}.{ext}")

# explicit, meaningful names (merged over the generated ones)
EXPLICIT = {
    # branding
    "logo.png": "logo.png",
    "social-01.png": "og-image.png",
    "content-07.png": "usu-supported-by.png",
    # page banners
    "hero-01.jpg": "hero-home.jpg",        # home + signup banner
    "hero-02.jpg": "hero-about.jpg",
    "carousel-08.jpg": "hero-events.jpg",  # events banner (Royce Chiu)
    # home section icons
    "content-01.png": "icon-single-night.png",
    "content-02.png": "icon-camping.png",
    "content-03.png": "icon-solar.png",
    "content-04.png": "icon-stargazing.png",
    "content-05.png": "icon-trivia.png",
    "content-06.jpg": "events-banner.jpg",
    # committee headshots, in roster order
    "content-08.jpg": "committee/01-benjamin-omara.jpg",
    "content-09.png": "committee/02-krish-singh.png",
    "content-10.jpg": "committee/03-becky-yao.jpg",
    "content-11.jpg": "committee/04-eugene-chon.jpg",
    "content-12.jpg": "committee/05-yanco-cheng.jpg",
    "content-13.png": "committee/06-farra-nadeem.png",
    "content-14.jpg": "committee/07-jackson-mitchell-bolton.jpg",
    "content-15.jpg": "committee/08-ritambhara-ganesh.jpg",
    "content-16.jpg": "committee/09-dimitri-williams.jpg",
    "content-17.jpg": "committee/10-tobias-mcerlane.jpg",
    "content-18.jpg": "committee/11-christopher-eng.jpg",
}
for src_name, dest in EXPLICIT.items():
    MAP.setdefault(src_name, []).append(dest)

copied = missing = 0
for src_name, dests in sorted(MAP.items()):
    s = SRC / src_name
    if not s.exists():
        print(f"  MISSING source {src_name}")
        missing += 1
        continue
    for dest in dests:
        shutil.copy2(s, IMG / dest)
        copied += 1

print(f"copied {copied} files into assets/img ({missing} missing sources)")

placed = set(MAP)
leftover = [p.name for p in SRC.iterdir() if p.name not in placed]
print("unplaced originals:", ", ".join(leftover) if leftover else "(none)")

# sanity check: every destination referenced by the site must exist
expected = [
    "logo.png", "og-image.png", "usu-supported-by.png",
    "hero-home.jpg", "hero-about.jpg", "hero-events.jpg",
    "icon-single-night.png", "icon-camping.png", "icon-solar.png",
    "icon-stargazing.png", "icon-trivia.png", "events-banner.jpg",
] + [f"events/{i:02d}.{'png' if i == 3 else 'jpg'}" for i in range(1, 20)] \
  + [d for d in EXPLICIT.values() if d.startswith("committee/")]

absent = [e for e in expected if not (IMG / e).exists()]
print("missing expected assets:", absent if absent else "(none)")
