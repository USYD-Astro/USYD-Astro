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
recorded alongside the submitter's name in .contacts/contacts.yml, which is
committed to the repository for the committee to use and is not served with the
site because GitHub Pages does not publish dot-directories. See the header in
that file before moving anything.

Removal requests are drained here too, from the `moderate/` directory the relay
queues them in, and applied with tools/gallery.py. Nothing is removed by the
relay itself: it holds a contents:write token, so an endpoint that deleted files
would turn a guessed password into a write primitive on the repository. It
authenticates and writes a request; this does the work, with the repository's
own tooling, and `gallery.py check` gates the result.
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


def read_removals(folder: pathlib.Path) -> list[dict]:
    """The removal requests the relay has queued, if any.

    Separate from the uploads on purpose: a takedown must never be blocked by,
    or bundled with, a half-finished publish of a new submission.
    """
    if not folder.is_dir():
        return []
    requests = []
    for path in sorted(folder.glob("*.json")):
        try:
            data = json.loads(path.read_text())
        except (ValueError, OSError):
            continue
        if isinstance(data, dict) and data.get("filename"):
            requests.append(data)
    return requests


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--incoming", default="/tmp/incoming/submissions")
    parser.add_argument(
        "--removals",
        default="/tmp/incoming/moderate",
        help="directory of queued removal requests, from the relay",
    )
    parser.add_argument("--alt", default="Photo sent in by a SUAS member")
    parser.add_argument(
        "--removals-only",
        action="store_true",
        help="apply queued removals and ignore pending uploads",
    )
    args = parser.parse_args()

    removed = 0
    for request in read_removals(pathlib.Path(args.removals)):
        filename = str(request.get("filename") or "")
        reason = str(request.get("reason") or "").strip()
        # The name is re-validated here rather than trusted from the queue. The
        # relay already refuses anything but a plain gallery filename, but this
        # is the step that actually touches the working tree, and a queue branch
        # is a branch that a token can write to. Not pinned to .jpg: the
        # curated gallery contains 03.png, which has to be removable too.
        if not re.fullmatch(r"\d{2,}\.[A-Za-z0-9]+", filename):
            print(f"  ignoring removal request with an unusable name: {filename!r}")
            continue
        if not reason:
            reason = "removed from the gallery by an administrator"
        try:
            result = gallery.remove_photos(filename, reason=reason)
        except SystemExit:
            result = None
        if not result:
            # Already gone, most likely because it was removed by hand or by an
            # earlier run. Not an error: the request has been satisfied.
            print(f"  removal of {filename}: not in any manifest, nothing to do")
            continue
        removed += 1
        print(
            f"  removed {result['file']} from {result['manifest']}"
            f" ({len(result['files'])} file(s) deleted)"
        )

    if removed:
        gallery.cmd_sync(argparse.Namespace(force=False))

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
        print(f"  recorded {contacts} contact(s) in .contacts/contacts.yml (not published)")
    if removed:
        print(f"  removed {removed} photo(s) from the gallery")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
