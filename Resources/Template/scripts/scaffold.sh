#!/usr/bin/env zsh
#
# Scaffold a new Anglesite site by copying the template into the target directory.
#
# Usage: scaffold.sh [--yes] <target-dir>
#
# --yes  Skip interactive confirmation (used by the app's SiteScaffolder).

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${(%):-%x}")" && pwd)
TEMPLATE_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

YES=false
TARGET=""

for arg in "$@"; do
    case "$arg" in
        --yes) YES=true ;;
        *) TARGET="$arg" ;;
    esac
done

if [[ -z "$TARGET" ]]; then
    echo "Usage: scaffold.sh [--yes] <target-dir>" >&2
    exit 1
fi

if [[ "$YES" != true ]]; then
    echo "Will scaffold a new Anglesite site in: $TARGET"
    echo -n "Continue? [y/N] "
    read -r reply
    [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

mkdir -p "$TARGET"

# Copy the template tree, excluding scaffold infrastructure and dev-only files.
rsync -a \
    --exclude='scripts/scaffold.sh' \
    --exclude='scripts/themes.ts' \
    --exclude='scripts/themes.json' \
    --exclude='packs/' \
    --exclude='scripts/check-pack.ts' \
    --exclude='scripts/build-packs.sh' \
    --exclude='scripts/*.test.ts' \
    --exclude='integrations/' \
    --exclude='node_modules/' \
    --exclude='.DS_Store' \
    "$TEMPLATE_ROOT/" "$TARGET/"

# Stamp the scaffolded site with the Anglesite version and document config keys.
#
# Written with printf (not a heredoc): zsh implements heredocs via a scratch
# file in the process's Darwin temp dir, which can fail to create in some
# sandboxed/subprocess-spawned environments (#501). printf redirection writes
# straight to $TARGET/.site-config with no intermediate temp file.
VERSION="1.0.0"
printf '%s\n' \
    "ANGLESITE_VERSION=$VERSION" \
    "# SITE_URL=https://example.com        — site domain (used in feeds, sitemap, security.txt)" \
    "# SECURITY_CONTACT=security@example.com — RFC 9116 security.txt contact (email or URI)" \
    "# SECURITY_TXT_MODE=generated          — generated|manual|disabled (default: inferred from SECURITY_CONTACT)" \
    "# MTA_STS_MODE=testing                 — disabled|testing|enforce (start with testing)" \
    "# MTA_STS_DOMAIN=example.com           — recipient domain (not necessarily the website host)" \
    "# MTA_STS_MX=mx1.example.com,mx2.example.com — allowed receiving MX hosts (RFC 8461)" \
    "# TLS_RPT_RUA=tls-reports@example.com  — optional RFC 8460 report mailbox" \
    "# HSTS_PRELOAD=true                    — opt-in HSTS preload submission (hard to reverse)" \
    "# SCRIPT_ALLOW=example.com             — additional CSP script-src domains (comma-separated)" \
    > "$TARGET/.site-config"

echo "==> Scaffolded Anglesite site in $TARGET"
