#!/usr/bin/env python3
"""Publish queued photo submissions into the submit page's gallery.

The upload relay commits each submission to a `submissions` branch, which
GitHub Pages does not serve. This turns whatever is waiting there into real
gallery entries on the published branch, reusing exactly the same processing a
hand-added photo gets (tools/gallery.py), then reports what is left.

    python3 tools/publish_submissions.py --incoming /tmp/incoming/submissions

Entries go into assets/data/submissions.yml, which feeds the rail on
submit.html -- NOT the home page gallery, which stays curated.

Only images are picked up; `submission.json` stays behind on the submissions
branch as the record of who sent what, so contact details never reach the
published site. What does travel onward is the credit, the caption and the
receipt date, which is what the expanded view on submit.html shows. The
submitter's *name* is used only as a fallback credit when they left the credit
field empty, and their email address is never copied anywhere published.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import gallery  # noqa: E402  (needs the path above)

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}


def read_meta(folder: pathlib.Path) -> dict:
    path = folder / "submission.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except (ValueError, OSError):
        return {}


def images_in(folder: pathlib.Path) -> list[pathlib.Path]:
    return sorted(
        p for p in folder.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES
    )


def pending(incoming: pathlib.Path) -> list[pathlib.Path]:
    if not incoming.is_dir():
        return []
    return sorted(f for f in incoming.iterdir() if f.is_dir() and images_in(f))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--incoming", default="/tmp/incoming/submissions")
    parser.add_argument("--alt", default="Photo sent in by a SUAS member")
    args = parser.parse_args()

    folders = pending(pathlib.Path(args.incoming))
    if not folders:
        print("  no submissions waiting")
        return 0

    published = 0
    for folder in folders:
        meta = read_meta(folder)
        credit = str(meta.get("credit") or meta.get("name") or "").strip()
        caption = str(meta.get("caption") or "").strip()
        date = str(meta.get("received") or "")[:10]
        print(f"  submission {folder.name}: {len(images_in(folder))} photo(s), credit {credit!r}")
        gallery.add_photos(
            [str(p) for p in images_in(folder)],
            alt=args.alt,
            credit=credit,
            caption=caption,
            date=date,
            collection="submissions",
        )
        published += 1

    print(f"\n  published {published} submission(s) into the submit page gallery")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
