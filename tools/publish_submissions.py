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
branch as the record of who sent what. What travels onward into the published
gallery is the credit, the caption and the receipt date, which is what the
expanded view on submit.html shows. The submitter's *name* is used only as a
fallback credit when they left the credit field empty.

The email address is not published, but it is not thrown away either: it is
recorded alongside the submitter's name in .contacts/contacts.yml, a local
working copy that the publishing Action commits to the `contacts` branch. That
branch is the point: everything on main is served by GitHub Pages, and Pages
does serve dot-directories, so a log kept on main would be public. Nothing
deploys a branch other than main. See the header in that file before moving
anything.

"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
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

    folders = [] if args.removals_only else pending(pathlib.Path(args.incoming))
    if not folders:
        print(
            "  no submissions waiting"
            + (f" ({removed} removal(s) applied)" if removed else "")
        )
        return 0

    published = 0
    contacts = 0
    for folder in folders:
        meta = read_meta(folder)
        credit = str(meta.get("credit") or meta.get("name") or "").strip()
        caption = str(meta.get("caption") or "").strip()
        date = str(meta.get("received") or "")[:10]
        images = images_in(folder)
        print(f"  submission {folder.name}: {len(images)} photo(s), credit {credit!r}")
        gallery.add_photos(
            [str(p) for p in images],
            alt=args.alt,
            credit=credit,
            caption=caption,
            date=date,
            collection="submissions",
        )
        published += 1

        # The photos are live now, so the reply address is worth keeping. It is
        # filed against the submission id rather than the published filenames,
        # because add_photos renumbers those and a later run would not line up.
        gallery.remember_contact(
            str(meta.get("name") or "").strip(),
            str(meta.get("email") or "").strip(),
            [f"{folder.name}/{p.name}" for p in images],
            date=date,
            credit=credit,
        )
        if str(meta.get("email") or "").strip():
            contacts += 1

    print(f"\n  published {published} submission(s) into the submit page gallery")
    if contacts:
        print(f"  recorded {contacts} contact(s) in .contacts/contacts.yml (goes to the contacts branch)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
