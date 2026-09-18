#!/usr/bin/env python3
"""Patches the updater's linux-x86_64* signature entries in latest.json
after strip-bundled-libs.sh has changed the AppImage's bytes (and it's been
re-signed) — the embedded signature has to match the file's new bytes or
every install's self-updater rejects it.

Usage: patch-latest-json.py <path-to-latest.json> <new-signature-base64>
"""

import json
import sys

LINUX_APPIMAGE_KEYS = ("linux-x86_64", "linux-x86_64-appimage")


def main() -> None:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    path, signature = sys.argv[1], sys.argv[2]

    with open(path) as f:
        data = json.load(f)

    patched = [key for key in LINUX_APPIMAGE_KEYS if key in data.get("platforms", {})]
    for key in patched:
        data["platforms"][key]["signature"] = signature

    if not patched:
        print(f"No linux-x86_64* platform entries found in {path} — nothing patched.", file=sys.stderr)
        sys.exit(1)

    with open(path, "w") as f:
        json.dump(data, f, indent=2)

    print(f"Patched signature for: {', '.join(patched)}")


if __name__ == "__main__":
    main()
