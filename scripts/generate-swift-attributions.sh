#!/usr/bin/env bash
# Generates the app-binary OSS attribution manifest from Package.resolved + the license files
# already checked out under .build/checkouts/ (populated by `swift package resolve` / `swift build`).
#
# Usage: scripts/generate-swift-attributions.sh <repo-root> <output.json> <overrides.json>
#
# See docs/superpowers/specs/2026-07-31-oss-attributions-design.md for the overrides format and
# the "fail loudly on an undisclosed license" rule this enforces.
set -euo pipefail

if [[ $# -ne 3 ]]; then
    echo "usage: $0 <repo-root> <output.json> <overrides.json>" >&2
    exit 2
fi

REPO_ROOT="$1"
OUTPUT="$2"
OVERRIDES="$3"

if [[ ! -d "$REPO_ROOT/.build/checkouts" ]]; then
    echo "error: $REPO_ROOT/.build/checkouts not found — run 'swift package resolve' first." >&2
    exit 1
fi

python3 - "$REPO_ROOT" "$OUTPUT" "$OVERRIDES" <<'PY'
import json
import os
import sys

repo_root, output_path, overrides_path = sys.argv[1], sys.argv[2], sys.argv[3]

# Both spellings: one current dependency (HighlighterSwift) ships LICENCE.md, not LICENSE.md.
#
# NOTE: this list's matching capability has diverged from generate-npm-attributions.mjs's
# equivalent (LICENSE_NAME_RE there) — the Node side also matches decorated filenames (e.g.
# LICENSE-MIT.txt) and one-level-nested LICENSE/ directories, this side only checks these exact
# filenames. If a SwiftPM dependency ever fails here with a decorated license filename, consider
# porting the same handling from the Node side.
LICENSE_NAMES = [
    "LICENSE", "LICENSE.md", "LICENSE.txt",
    "LICENCE", "LICENCE.md", "LICENCE.txt",
    "COPYING", "COPYING.md", "COPYING.txt",
]


def detect_license_spdx_id(text):
    """Best-effort SPDX id detection from the license TEXT itself — not a name/version lookup
    table, and never a substitute for the real bundled text (which is always what's disclosed).
    Only recognizes a handful of well-known license headers/grant phrases; returns None rather
    than guessing when nothing matches, so an override always still wins and an unrecognized
    license is left honestly unlabeled."""
    head = text[:200]
    if "Apache License" in head and "Version 2.0" in head:
        return "Apache-2.0"
    if "MIT License" in text or "Permission is hereby granted, free of charge" in text:
        return "MIT"
    if "Redistribution and use in source and binary forms" in text:
        return "BSD-3-Clause" if "promote products derived" in text else "BSD-2-Clause"
    if "Permission to use, copy, modify, and/or distribute this software" in text:
        return "ISC"
    return None


def find_license_text(directory):
    try:
        entries = {name.lower(): name for name in os.listdir(directory)}
    except FileNotFoundError:
        return None
    for candidate in LICENSE_NAMES:
        real_name = entries.get(candidate.lower())
        if real_name:
            with open(os.path.join(directory, real_name), encoding="utf-8", errors="replace") as f:
                return f.read()
    return None


def checkout_dir_name(location):
    # SwiftPM names .build/checkouts/<dir> after the repo name in the URL, not the (often
    # lowercased/hyphenated) `identity` field — verified against all pins in this repo.
    name = location.rstrip("/").split("/")[-1]
    return name[:-4] if name.endswith(".git") else name


with open(os.path.join(repo_root, "Package.resolved"), encoding="utf-8") as f:
    resolved = json.load(f)

with open(overrides_path, encoding="utf-8") as f:
    overrides = json.load(f)

checkouts_root = os.path.join(repo_root, ".build", "checkouts")
entries = []
failures = []

for pin in resolved["pins"]:
    name = checkout_dir_name(pin["location"])
    state = pin.get("state", {})
    version = state.get("version") or state.get("branch") or state.get("revision", "unknown")[:12]
    override = overrides.get(f"{name}@{version}") or overrides.get(name) or {}

    license_text = override.get("licenseText") or find_license_text(os.path.join(checkouts_root, name))
    if not license_text:
        failures.append(name)
        continue

    location = pin["location"]
    homepage = override.get("homepage") or (location[:-4] if location.endswith(".git") else location)

    entries.append({
        "name": name,
        "version": version,
        "licenseSPDXId": override.get("licenseSPDXId") or detect_license_spdx_id(license_text),
        "licenseText": license_text,
        "homepage": homepage,
    })

if failures:
    sys.stderr.write(
        "error: no license file found and no override for: " + ", ".join(sorted(failures)) + "\n"
        "       Add an entry to " + overrides_path + " once a human confirms the license.\n"
    )
    sys.exit(1)

entries.sort(key=lambda e: e["name"].lower())
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(entries, f, indent=2)
    f.write("\n")

print(f"Wrote {len(entries)} app-binary attribution(s) to {output_path}")
PY
