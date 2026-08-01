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
LICENSE_NAMES = [
    "LICENSE", "LICENSE.md", "LICENSE.txt",
    "LICENCE", "LICENCE.md", "LICENCE.txt",
    "COPYING", "COPYING.md", "COPYING.txt",
]


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

    entries.append({
        "name": name,
        "version": version,
        "licenseSPDXId": override.get("licenseSPDXId"),
        "licenseText": license_text,
        "homepage": override.get("homepage") or pin["location"],
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
