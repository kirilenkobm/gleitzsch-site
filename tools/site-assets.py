#!/usr/bin/env python3
"""Prepare or verify content-addressed website styles for both static hosts."""

import argparse
import hashlib
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
STYLESHEET = ROOT / "assets/site.css"
REFERENCE = re.compile(r'(?<=href=")assets/site(?:\.[0-9a-f]{12})?\.css(?:\?[^"<>]*)?(?=")')


def prepare(check=False):
    content = STYLESHEET.read_bytes()
    fingerprint = hashlib.sha256(content).hexdigest()[:12]
    name = f"assets/site.{fingerprint}.css"
    destination = ROOT / name
    pages = sorted(ROOT.glob("*.html"))
    updates = []
    for page in pages:
        text = page.read_text()
        references = REFERENCE.findall(text)
        if len(references) != 1:
            raise SystemExit(f"Expected one website stylesheet in {page.name}.")
        updates.append((page, REFERENCE.sub(name, text)))
        if check and references != [name]:
            raise SystemExit(f"Stale stylesheet in {page.name}; run python3 tools/site-assets.py.")
    if check:
        if not destination.is_file() or destination.read_bytes() != content:
            raise SystemExit(f"Missing or changed {name}; run python3 tools/site-assets.py.")
    else:
        # Keep older files so already-open or cached pages can still load them.
        destination.write_bytes(content)
        for page, updated in updates:
            if page.read_text() != updated:
                page.write_text(updated)
    print(f"{'Verified' if check else 'Prepared'} {name} for {len(pages)} pages.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail without changing files if styles are stale")
    prepare(parser.parse_args().check)
