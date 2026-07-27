#!/usr/bin/env bash
# Asserts every tracked *.xcstrings file ends with a newline (#970).
#
# Xcode's SWIFT_EMIT_LOC_STRINGS build phase rewrites String Catalogs on every IDE build
# and drops the final newline; scripts/git-hooks/pre-commit restores it on the way into a
# commit. But that hook is local and advisory — it is silently absent in any clone (or
# agent worktree) that skipped scripts/setup-dev-env.sh, and it has already been bypassed
# more than once (bdd306ae, 6b16b6ca, b800ced2). The result is a ~2,700-line JSON file
# whose last byte alternates between `}` and `}\n` depending on whose clone touched it
# last, so any two branches that both touch a catalog differ at EOF on top of whatever
# real key changes they carry — extra conflict surface on a file that is already
# conflict-prone (keys are inserted alphabetically into one shared list).
#
# This is the non-advisory half: the hook auto-fixes, CI enforces. Scoped deliberately to
# the final byte — nothing here reads or validates catalog contents (that's
# scripts/check-localization-catalog.sh).
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

files=()
while IFS= read -r f; do
  files+=("$f")
done < <(git ls-files '*.xcstrings')

if [[ ${#files[@]} -eq 0 ]]; then
  echo "error: no tracked *.xcstrings files found — has the catalog moved?" >&2
  exit 1
fi

missing=()
for f in "${files[@]}"; do
  # An empty catalog has no final byte to check; a tracked empty .xcstrings would be a
  # separate (content) problem, so skip rather than flag it here.
  [[ -s "$f" ]] || continue
  # `tail -c1` prints the file's last byte; command substitution strips a trailing
  # newline from *that* output. So a non-empty result means the last byte wasn't \n.
  if [[ -n "$(tail -c 1 "$f")" ]]; then
    missing+=("$f")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "error: ${#missing[@]} String Catalog(s) missing a trailing newline:" >&2
  for f in "${missing[@]}"; do
    echo "  $f" >&2
  done
  echo >&2
  echo "Xcode strips it on every IDE build. Restore it with:" >&2
  for f in "${missing[@]}"; do
    # %s carries the literal `'\n'` argument through unexpanded; %q shell-quotes the path.
    printf '  printf %s >>%q\n' "'\\n'" "$f" >&2
  done
  echo >&2
  echo "Then install the hook that does it for you: scripts/setup-dev-env.sh" >&2
  exit 1
fi

echo "✓ all ${#files[@]} tracked .xcstrings file(s) end with a newline."
