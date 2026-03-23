#!/bin/zsh
# Anglesite — Scaffold a new project from the plugin template
# Usage: zsh scaffold.sh [destination] [--yes] [--dry-run] [--force]
# Copies template/ to the destination directory (default: current directory).
# Safe to rerun: uses --ignore-existing by default to avoid overwriting.

if [ -z "${ZSH_VERSION-}" ]; then exec /bin/zsh "$0" "$@"; fi

set -euo pipefail

DEST="."
YES=false
DRY_RUN=false
FORCE=false

usage() {
  cat <<EOF
Usage: $0 [destination]
Options:
  -y, --yes       Do not prompt before scaffolding
  -n, --dry-run   Show what would be copied (rsync --dry-run)
  -f, --force     Overwrite existing files
  -h, --help      Show this help
EOF
}

# Simple args: last non-flag arg is destination
while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes) YES=true; shift ;;
    -n|--dry-run|--dryrun) DRY_RUN=true; shift ;;
    -f|--force) FORCE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    *)
      if [[ "$DEST" == "." ]]; then
        DEST="$1"
        shift
      else
        echo "Unknown argument: $1" >&2
        usage
        exit 1
      fi
      ;;
  esac
done

PLUGIN_ROOT="${0:A:h:h}"
TEMPLATE="${PLUGIN_ROOT}/template"

if [[ ! -d "$TEMPLATE" ]]; then
  echo "Error: template directory not found at $TEMPLATE" >&2
  exit 1
fi

mkdir -p "$DEST"

# Default rsync options: archive but do not overwrite existing files unless --force
RSYNC_OPTS=( -a )
if ! $FORCE; then
  RSYNC_OPTS+=( --ignore-existing )
fi

# Excludes
RSYNC_OPTS+=( --exclude='node_modules' )
RSYNC_OPTS+=( --exclude='dist' )
RSYNC_OPTS+=( --exclude='.astro' )
RSYNC_OPTS+=( --exclude='.wrangler' )
RSYNC_OPTS+=( --exclude='.certs' )
RSYNC_OPTS+=( --exclude='.DS_Store' --exclude='.site-config' )

if $DRY_RUN; then
  RSYNC_OPTS+=( --dry-run )
  echo "DRY RUN: rsync ${RSYNC_OPTS[*]} \"$TEMPLATE/\" \"$DEST/\""
fi

if ! $YES && ! $DRY_RUN; then
  echo "About to scaffold Anglesite into: $DEST"
  read -q "REPLY?Proceed? (y/N): " && echo
  if [[ "$REPLY" != [yY] && "$REPLY" != [yY][eE][sS] ]]; then
    echo "Aborted by user." >&2
    exit 1
  fi
fi

# Clear stale build caches from any previous Astro project
for cache in "$DEST/node_modules/.astro" "$DEST/node_modules/.vite" "$DEST/.astro"; do
  if [[ -d "$cache" ]]; then
    rm -rf "$cache"
    echo "Cleared stale cache: $cache"
  fi
done

# Execute rsync
rsync "${RSYNC_OPTS[@]}" "$TEMPLATE/" "$DEST/"

## Ensure required .gitignore entries exist
# When scaffolding into an existing project (e.g. SSG conversion), rsync
# --ignore-existing preserves the old .gitignore. Append any Astro build
# artifact entries that are missing so they don't get committed.
if ! $DRY_RUN; then
  GITIGNORE="$DEST/.gitignore"
  if [[ -f "$GITIGNORE" ]]; then
    REQUIRED_ENTRIES=(dist .astro .wrangler .certs)
    for entry in "${REQUIRED_ENTRIES[@]}"; do
      if ! grep -qE "^${entry}/?$" "$GITIGNORE"; then
        printf '\n%s' "$entry" >> "$GITIGNORE"
      fi
    done
  fi
fi

if $DRY_RUN; then
  echo "Dry-run complete. No files were changed."
else
  echo "Scaffolded Anglesite project to $DEST"
  echo "Next steps:"
  echo "  cd $DEST"
  echo "  (review .site-config, then) npm install"
fi
