#!/usr/bin/env bash
# Vendor the Linux kernel binary and vminit initfs OCI layout required by Apple Containerization 0.34.
#
# Kernel: downloads the Kata Containers arm64 static bundle and extracts the container-optimised
#   vmlinux (VIRTIO built in) from opt/kata/share/kata-containers/vmlinux.container. This is the
#   same kernel apple/containerization's `make fetch-default-kernel` uses.
# initfs: pulls ghcr.io/apple/containerization/vminit (linux/arm64) with the Apple `container`
#   CLI and re-exports it as an OCI layout via `container image save`.
#
# Versions and digests are pinned in scripts/container-artifact-versions.lock.json (#616) — this
# script verifies what it fetches against that lock and fails loudly on a mismatch, rather than
# trusting whatever a floating tag/release resolves to at run time. Pass --update-lock to
# (re)compute the lock from the versions currently set below and write it back — that's how a
# maintainer deliberately bumps a version, not something that happens implicitly on every run.
#
# Mirrors scripts/vendor-container-image.sh: produces gitignored, bundled app resources.
# Requires the Apple `container` CLI (≥ 1.1, https://github.com/apple/container) on an
# Apple-Silicon Mac. (The kernel half needs only curl/tar/jq; verifying — but not resolving — the
# initfs digest needs only curl/jq, no `container` CLI, since it goes straight at the registry API.)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/lib/container-cli.sh"
source "$ROOT/scripts/lib/artifact-lock.sh"
KERNEL_OUT="$ROOT/Resources/container-kernel"
INITFS_OUT="$ROOT/Resources/container-initfs"

UPDATE_LOCK=0
if [[ "${1:-}" == "--update-lock" ]]; then
    UPDATE_LOCK=1
fi

# The version/tag to fetch. Bumping these two lines is the only step to pick up a new upstream
# release — then re-run with --update-lock to pin the new digests.
KATA_VERSION="3.17.0"
VMINIT_TAG="0.34.0"

KATA_ASSET="kata-static-${KATA_VERSION}-arm64.tar.xz"
KATA_URL="https://github.com/kata-containers/kata-containers/releases/download/${KATA_VERSION}/${KATA_ASSET}"
VMINIT_REPO="ghcr.io/apple/containerization/vminit"

ensure_jq
# Fail fast, before the ~290 MB kernel download: the initfs half needs the CLI regardless.
ensure_container_cli

# Verifies $2 (actual value, e.g. a computed sha256 or resolved digest) against the lock entry at
# jq path $1. In --update-lock mode, writes $2 into the lock (with today's date recorded via the
# sibling *_pinned_at path, when given as $3) and returns success. Otherwise: passes silently if
# equal, warns and passes if the lock entry is unset ("null" — not yet pinned from a session that
# could reach the source), and hard-fails on a real mismatch — the one case that matters, since it
# means what we just fetched differs from what was previously recorded as good.
check_or_update_lock() {
    local path="$1" actual="$2" pinned_at_path="${3:-}" label="$4"
    local expected
    expected="$(lock_get "$path")"

    if [[ "$UPDATE_LOCK" == "1" ]]; then
        lock_set "$path" "$actual"
        [[ -n "$pinned_at_path" ]] && lock_set "$pinned_at_path" "$(date -u +%Y-%m-%d)"
        echo "$label: pinned $actual"
        return 0
    fi

    if [[ "$expected" == "null" || -z "$expected" ]]; then
        echo "warning: $label has no pin in $ARTIFACT_LOCK_FILE yet (got $actual) — re-run with --update-lock to record it." >&2
        return 0
    fi

    if [[ "$actual" != "$expected" ]]; then
        echo "ERROR: $label mismatch — expected $expected (pinned), got $actual. If this bump is intentional, re-run with --update-lock." >&2
        exit 1
    fi
    echo "$label: verified against lock ($actual)"
}

# ---------------------------------------------------------------------------
# Kernel
# ---------------------------------------------------------------------------
echo "=== Vendoring Linux kernel (Kata Containers ${KATA_VERSION}) ==="

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

KATA_ARCHIVE="$TMP/kata-static.tar.xz"
echo "Downloading ${KATA_URL} (~290 MB)…"
curl -fL --progress-bar -o "$KATA_ARCHIVE" "$KATA_URL"

check_or_update_lock '.kata.tarball_sha256' "$(sha256_of "$KATA_ARCHIVE")" '.kata.pinned_at' "kata release tarball"

echo "Inspecting tar layout (looking for vmlinux.container)…"
# The kata bundle is rooted at ./; list to find the kernel symlink path.
SYMLINK_TAR_PATH="$(tar -tf "$KATA_ARCHIVE" | grep 'vmlinux\.container$' | head -1)"
if [[ -z "$SYMLINK_TAR_PATH" ]]; then
    echo "ERROR: vmlinux.container not found in archive" >&2
    exit 1
fi
echo "Found kernel symlink at: ${SYMLINK_TAR_PATH}"

# Extract just the symlink entry first to discover what it points to.
tar -xf "$KATA_ARCHIVE" -C "$TMP" "$SYMLINK_TAR_PATH"
SYMLINK_PATH="$TMP/$SYMLINK_TAR_PATH"
SYMLINK_TARGET="$(readlink "$SYMLINK_PATH")"
if [[ -z "$SYMLINK_TARGET" ]]; then
    # Not a symlink — extract was the real file.
    ACTUAL_TAR_PATH="$SYMLINK_TAR_PATH"
else
    echo "Symlink target: ${SYMLINK_TARGET}"
    KERNEL_DIR="$(dirname "$SYMLINK_TAR_PATH")"
    ACTUAL_TAR_PATH="${KERNEL_DIR}/${SYMLINK_TARGET}"
    echo "Extracting actual kernel: ${ACTUAL_TAR_PATH}"
    tar -xf "$KATA_ARCHIVE" -C "$TMP" "$ACTUAL_TAR_PATH"
fi

# Preserve the committed .gitkeep; wipe any stale kernel.
find "$KERNEL_OUT" -mindepth 1 -not -name '.gitkeep' -delete 2>/dev/null || true

# Copy the real (dereferenced) kernel file. We may have either the symlink
# pointing at the versioned file, or the versioned file directly extracted above.
ACTUAL_PATH="$TMP/$ACTUAL_TAR_PATH"
if [[ -L "$ACTUAL_PATH" ]]; then
    cp -L "$ACTUAL_PATH" "$KERNEL_OUT/vmlinux"
else
    cp "$ACTUAL_PATH" "$KERNEL_OUT/vmlinux"
fi
echo "Kernel copied → $KERNEL_OUT/vmlinux"

# Basic sanity: must be non-trivially large (the Kata arm64 VM-optimized kernel is ~14 MB —
# smaller than a general-purpose kernel; the 1 MiB floor below just catches truncation/zero-byte).
KERNEL_SIZE=$(stat -f%z "$KERNEL_OUT/vmlinux" 2>/dev/null || stat -c%s "$KERNEL_OUT/vmlinux" || echo 0)
if [[ "$KERNEL_SIZE" -lt 1048576 ]]; then
    echo "ERROR: vmlinux is suspiciously small (${KERNEL_SIZE} bytes) — extraction may have failed" >&2
    exit 1
fi
echo "Kernel size: ${KERNEL_SIZE} bytes ($(( KERNEL_SIZE / 1048576 )) MiB)"
file "$KERNEL_OUT/vmlinux" || true

check_or_update_lock '.kata.vmlinux_sha256' "$(sha256_of "$KERNEL_OUT/vmlinux")" '' "extracted vmlinux"

# ---------------------------------------------------------------------------
# initfs OCI layout
# ---------------------------------------------------------------------------
echo ""
echo "=== Vendoring vminit initfs (${VMINIT_REPO}:${VMINIT_TAG}) ==="

# Resolve the tag to a manifest-list digest via the registry API directly (no `container` CLI
# needed for this step) so the digest can be verified *before* pulling, and so the eventual pull
# is by digest — what lands on disk is provably what was just checked, not whatever the tag
# happens to resolve to a moment later.
echo "Resolving ${VMINIT_REPO}:${VMINIT_TAG} via the registry API…"
VMINIT_AUTH_TOKEN="$(curl -fsSL "https://ghcr.io/token?service=ghcr.io&scope=repository:${VMINIT_REPO#ghcr.io/}:pull" | jq -r '.token')"
VMINIT_INDEX_DIGEST="$(curl -fsSL -D - -o "$TMP/vminit-index.json" \
    -H "Authorization: Bearer $VMINIT_AUTH_TOKEN" \
    -H "Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json" \
    "https://ghcr.io/v2/${VMINIT_REPO#ghcr.io/}/manifests/${VMINIT_TAG}" \
    | grep -i '^docker-content-digest:' | awk '{print $2}' | tr -d '\r')"
if [[ -z "$VMINIT_INDEX_DIGEST" ]]; then
    echo "ERROR: could not resolve a Docker-Content-Digest for ${VMINIT_REPO}:${VMINIT_TAG}" >&2
    exit 1
fi
VMINIT_ARM64_DIGEST="$(jq -r '.manifests[] | select(.platform.architecture=="arm64" and .platform.os=="linux") | .digest' "$TMP/vminit-index.json")"
if [[ -z "$VMINIT_ARM64_DIGEST" ]]; then
    echo "ERROR: no linux/arm64 entry in the ${VMINIT_REPO}:${VMINIT_TAG} manifest index" >&2
    exit 1
fi

check_or_update_lock '.vminit.index_digest' "$VMINIT_INDEX_DIGEST" '.vminit.pinned_at' "vminit index digest"
check_or_update_lock '.vminit.arm64_manifest_digest' "$VMINIT_ARM64_DIGEST" '' "vminit arm64 manifest digest"

# Wipe stale layout but preserve .gitkeep.
find "$INITFS_OUT" -mindepth 1 -not -name '.gitkeep' -delete 2>/dev/null || true
mkdir -p "$INITFS_OUT"

INITFS_ARCHIVE="$TMP/initfs.tar"
VMINIT_PINNED="${VMINIT_REPO}@${VMINIT_INDEX_DIGEST}"
echo "Exporting OCI layout from ${VMINIT_PINNED} (linux/arm64)…"
# Pull by the digest just verified above (not the floating tag), then save: `container image
# save` emits an OCI-compatible tar archive directly — no FROM-only Dockerfile build needed
# (that was a buildx workaround).
container image pull --platform linux/arm64 "$VMINIT_PINNED"
container image save --platform linux/arm64 --output "$INITFS_ARCHIVE" "$VMINIT_PINNED"

echo "Untarring OCI layout → ${INITFS_OUT}"
tar -xf "$INITFS_ARCHIVE" -C "$INITFS_OUT"
rm -f "$INITFS_ARCHIVE"

REQUIRED_INITFS_ENTRIES=(oci-layout index.json blobs/sha256)
missing_initfs_entry() {
    local f
    for f in "${REQUIRED_INITFS_ENTRIES[@]}"; do
        [[ -e "$INITFS_OUT/$f" ]] || { echo "$f"; return 0; }
    done
    return 1
}

# Verify the OCI layout is structurally valid. If the container-CLI export fails to emit a
# complete layout, fall back to skopeo once, then always re-validate so failures name the
# missing entry clearly.
if missing="$(missing_initfs_entry)"; then
    echo "ERROR: OCI layout missing required entry: $missing" >&2
    # Fall back to skopeo if available. NOTE: this recovery path is only hit if the container-CLI
    # OCI export above fails to produce a valid layout. The `oci:dir:tag` form skopeo writes
    # is a tagged single-entry index; it has not been exercised against the Containerization
    # initfs loader, so if you ever land here, verify the produced layout boots before relying on it.
    if command -v skopeo >/dev/null 2>&1; then
        echo "Falling back to skopeo…"
        find "$INITFS_OUT" -mindepth 1 -not -name '.gitkeep' -delete 2>/dev/null || true
        skopeo copy \
            --override-os linux \
            --override-arch arm64 \
            "docker://${VMINIT_PINNED}" \
            "oci:${INITFS_OUT}:vminit"
        echo "skopeo copy succeeded."
    else
        echo "ERROR: skopeo not available. Install via 'brew install skopeo' and re-run." >&2
        exit 1
    fi
fi

if missing="$(missing_initfs_entry)"; then
    echo "ERROR: OCI layout still missing required entry after fallback: $missing" >&2
    exit 1
fi

# The locally saved OCI layout may reformat/repackage index.json relative to what the registry
# served, so don't hash the file directly — confirm the pinned manifest digest is reachable from
# the layout's own index instead (a plain sha256 hex string is unique enough that a
# textual search is a reliable, layout-shape-agnostic check). container CLI ≥1.1.0 writes a
# nested layout whose top-level index references the multi-arch index blob rather than the
# platform manifest directly, so also accept the lock-verified chain
# index.json → index blob (VMINIT_INDEX_DIGEST) → manifest (VMINIT_ARM64_DIGEST).
initfs_references_pinned_manifest() {
    local manifest_hex="${VMINIT_ARM64_DIGEST#sha256:}"
    local index_hex="${VMINIT_INDEX_DIGEST#sha256:}"
    local index_blob="$INITFS_OUT/blobs/sha256/$index_hex"
    grep -q "$manifest_hex" "$INITFS_OUT/index.json" && return 0
    grep -q "$index_hex" "$INITFS_OUT/index.json" \
        && [[ -f "$index_blob" ]] \
        && grep -q "$manifest_hex" "$index_blob"
}
if ! initfs_references_pinned_manifest; then
    echo "ERROR: locally saved OCI layout ($INITFS_OUT/index.json) does not reference the verified manifest digest $VMINIT_ARM64_DIGEST (directly or via the verified index blob $VMINIT_INDEX_DIGEST) — 'container image save' may have produced something unexpected." >&2
    exit 1
fi
echo "Local OCI layout references the verified manifest digest."

# Final verification.
echo ""
echo "=== Verification ==="
echo "Kernel:"
ls -la "$KERNEL_OUT/"
file "$KERNEL_OUT/vmlinux" || true

echo ""
echo "initfs OCI layout:"
ls -la "$INITFS_OUT/"
ls "$INITFS_OUT/blobs/sha256/" | head -5
echo "($(ls "$INITFS_OUT/blobs/sha256/" | wc -l | tr -d ' ') blobs total)"

echo ""
if [[ "$UPDATE_LOCK" == "1" ]]; then
    echo "Lock updated: $ARTIFACT_LOCK_FILE"
fi
echo "Done. Resources/container-kernel/ and Resources/container-initfs/ are populated."
