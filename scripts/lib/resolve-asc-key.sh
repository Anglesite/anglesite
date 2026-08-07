#!/usr/bin/env bash
#
# Shared App Store Connect API key resolution, used by scripts/release.sh and
# scripts/testflight-notes.sh. Source this file, then call:
#   resolve_asc_key_path <key_id>
# It echoes the absolute path to AuthKey_<key_id>.p8, honoring an explicit
# ASC_API_KEY_PATH override or searching the standard private_keys
# directories. Requires the sourcing script to define bail().

resolve_asc_key_path() {
    local key_id="$1" key_path=""
    if [[ -n "${ASC_API_KEY_PATH:-}" ]]; then
        [[ -f "$ASC_API_KEY_PATH" ]] || bail "ASC_API_KEY_PATH is set but no file exists at $ASC_API_KEY_PATH."
        key_path="$ASC_API_KEY_PATH"
    else
        local dir
        for dir in "$HOME/.appstoreconnect/private_keys" "$HOME/.private_keys" "$HOME/private_keys" "./private_keys"; do
            if [[ -f "$dir/AuthKey_${key_id}.p8" ]]; then
                key_path="$dir/AuthKey_${key_id}.p8"
                break
            fi
        done
        [[ -n "$key_path" ]] \
            || bail "AuthKey_${key_id}.p8 not found in ~/.appstoreconnect/private_keys/ or ~/.private_keys/. Install the .p8 there or set ASC_API_KEY_PATH."
    fi
    # Callers (openssl, xcodebuild) need an absolute path; normalize.
    echo "$(cd "$(dirname "$key_path")" && pwd)/$(basename "$key_path")"
}
