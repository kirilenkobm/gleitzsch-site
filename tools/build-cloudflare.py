#!/usr/bin/env python3
"""Package the tracked static site for Cloudflare Pages."""

import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist-cloudflare"
DOWNLOAD_ORIGIN = "https://kirilenkobm.github.io/gleitzsch-site/downloads/"
MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_FILES = 20_000


def build():
    manifest = json.loads((ROOT / "editor/release.json").read_text())
    for name, expected in manifest["files"].items():
        relative = PurePosixPath(name)
        if relative.is_absolute() or ".." in relative.parts:
            raise SystemExit(f"Invalid editor release path: {name}")
        actual = hashlib.sha256((ROOT / "editor" / name).read_bytes()).hexdigest()
        if actual != expected:
            raise SystemExit(f"Editor release hash mismatch: {name}")

    tracked = subprocess.check_output(
        ["git", "ls-files", "-z"], cwd=ROOT
    ).decode().split("\0")
    files = []
    for name in filter(None, tracked):
        relative = PurePosixPath(name)
        if not (
            relative.parts[0] in {"assets", "editor"}
            or (len(relative.parts) == 1 and relative.suffix == ".html")
        ):
            continue
        if relative.suffix in {".py", ".swift", ".kt", ".cpp", ".map"}:
            continue
        source = ROOT / name
        if source.is_symlink() or not source.is_file():
            raise SystemExit(f"Expected a regular tracked asset: {name}")
        if source.stat().st_size > MAX_FILE_BYTES:
            raise SystemExit(f"Asset exceeds the Cloudflare Pages 25 MiB limit: {name}")
        files.append(name)
    if len(files) + 2 > MAX_FILES:
        raise SystemExit("Site exceeds the Cloudflare Pages 20,000-file limit.")

    if OUTPUT.is_symlink():
        raise SystemExit("The build output must not be a symlink.")
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir()
    for name in files:
        destination = OUTPUT / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, destination)

    # The source 404 serves a GitHub project path; Cloudflare serves the root.
    error_page = OUTPUT / "404.html"
    original = error_page.read_text()
    updated = original.replace('href="/gleitzsch-site/"', 'href="/"')
    if updated == original:
        raise SystemExit("Expected the GitHub project path in the source 404 page.")
    error_page.write_text(updated)

    # APKs exceed the per-file limit and stay at the existing HTTPS download URL.
    (OUTPUT / "_redirects").write_text(
        f"/downloads/* {DOWNLOAD_ORIGIN}:splat 302\n"
    )

    # Cloudflare reads _headers at the site root, not inside /editor/.
    editor_headers = (ROOT / "editor/_headers").read_text()
    headers = "\n".join(
        "/editor" + line if line.startswith("/") else line
        for line in editor_headers.splitlines()
    )
    (OUTPUT / "_headers").write_text(headers + "\n")
    print(
        f"Prepared {len(files) + 2} files in {OUTPUT.name}/; "
        f'editor {manifest["version"]} / {manifest["buildId"]}. '
        "APK downloads remain on GitHub Pages."
    )


if __name__ == "__main__":
    build()
