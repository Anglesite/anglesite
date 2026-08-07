#!/usr/bin/env bash
#
# Surface real Swift compiler errors from a captured `swift build`/`swift test`
# log as GitHub error annotations plus a $GITHUB_STEP_SUMMARY digest.
#
# Why (#1335): when a file in a large target fails to compile, llbuild keeps
# compiling the target's remaining files for a minute-plus, so the real
# diagnostics scroll far above the job tail — buried in thousands of `this is
# an error in the Swift 6 language mode` *warnings* — and the log ends with
# SwiftPM's bare `error: fatalError` sentinel ("diagnostics already emitted"),
# which reads like a compiler crash. #1335 was misdiagnosed four times exactly
# that way.
#
# Two diagnostic shapes are handled (both verified against #1335's job log):
#
#   plain             /path/File.swift:12:34: error: <message>
#   macro expansion   the `error:` line carries no usable path
#                     ("macro expansion #expect:1:22: error: …", plus a
#                     duplicate snippet-box "`- error: …" rendering); the real
#                     location is on the nearest
#                     "`- /path/File.swift:58:107: note: expanded code originates here"
#                     line, so it's resolved from that and the duplicates
#                     collapse via the file:line:message dedupe.
#
# A problem matcher can't do this: matchers only join *consecutive* lines in a
# fixed order, and the location note's distance/direction from the `error:`
# line differs between the two shapes.
#
# Usage: annotate-swift-log.sh <log-file> [label]
#
# Always exits 0 — this script only reports; the step that produced the log
# already failed the job. Must run on the runner's /bin/bash 3.2 (no bash-4
# features: no mapfile, no associative arrays).
set -euo pipefail

LOG="${1:?usage: annotate-swift-log.sh <log-file> [label]}"
LABEL="${2:-swift build/test}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
WORKSPACE="${GITHUB_WORKSPACE:-$PWD}"
MAX_ANNOTATIONS=10 # GitHub discards error annotations beyond 10 per step
MAX_BLOCKS=10      # context excerpts included in the step-summary digest

if [ ! -s "$LOG" ]; then
  echo "No log captured at ${LOG} — nothing to annotate."
  exit 0
fi

# Workflow-command escaping: messages escape %/CR/LF; properties additionally
# escape : and , (https://docs.github.com/actions → workflow commands).
esc_msg() {
  local s="$1"
  s="${s//'%'/%25}"
  s="${s//$'\r'/%0D}"
  s="${s//$'\n'/%0A}"
  printf '%s' "$s"
}
esc_prop() {
  local s
  s="$(esc_msg "$1")"
  s="${s//:/%3A}"
  s="${s//,/%2C}"
  printf '%s' "$s"
}

# Candidate `error:` diagnostics. The Swift-6-language-mode flood never
# matches: those are `warning:` lines whose text ends "this is an error in the
# Swift 6 language mode" — no colon after that "error". SwiftPM's trailing
# `error: fatalError` sentinel is excluded here and explained in the digest
# instead. Capped: past a couple hundred candidates nothing new is learned.
candidates="$(grep -nE '(^|[[:space:]])error: ' "$LOG" | grep -vE 'error: fatalError$' | head -200 || true)"

sentinel=false
grep -qE '(^|[[:space:]])error: fatalError$' "$LOG" && sentinel=true

# Pre-index macro-expansion origin notes as "<logline> <file> <line> <col>".
# The note renders as "`- /path/File.swift:58:107: note: expanded code
# originates here" (a prefix before the path) — hence the optional "(.* )?".
origins="$(grep -nE '\.swift:[0-9]+:[0-9]+: note: expanded code originates here' "$LOG" |
  sed -nE 's|^([0-9]+):(.* )?(/[^: ]+\.swift):([0-9]+):([0-9]+): note: expanded code originates here.*$|\1 \3 \4 \5|p' || true)"

# nearest_origin <logline> — print "file line col" for the origin note closest
# to that log line (within 30 lines), preferring the smallest distance so
# adjacent expansion blocks don't steal each other's location.
nearest_origin() {
  local target="$1" best_d=31 best="" l f ln c d
  while read -r l f ln c; do
    [ -n "$l" ] || continue
    d=$((l - target))
    [ "$d" -lt 0 ] && d=$((-d))
    if [ "$d" -lt "$best_d" ]; then
      best_d="$d"
      best="$f $ln $c"
    fi
  done <<EOF
$origins
EOF
  printf '%s' "$best"
}

plain_re='(/[^: ]+\.swift):([0-9]+):([0-9]+): error: (.*)$'

errors=0
annotated=0
blocks=""
seen=$'\n'

while IFS= read -r cand; do
  [ -n "$cand" ] || continue
  logline="${cand%%:*}"
  content="${cand#*:}"
  file="" fline="" fcol="" msg=""
  if [[ "$content" =~ $plain_re ]]; then
    file="${BASH_REMATCH[1]}"
    fline="${BASH_REMATCH[2]}"
    fcol="${BASH_REMATCH[3]}"
    msg="${BASH_REMATCH[4]}"
  else
    msg="${content#*error: }"
    origin="$(nearest_origin "$logline")"
    if [ -n "$origin" ]; then
      file="${origin%% *}"
      rest="${origin#* }"
      fline="${rest%% *}"
      fcol="${rest##* }"
    fi
  fi

  key="${file}:${fline}:${msg}"
  case "$seen" in *$'\n'"$key"$'\n'*) continue ;; esac
  if [ -z "$file" ]; then
    # A location-less snippet-box "`- error:" line usually re-renders an
    # already-located error with the identical message — skip those.
    case "$seen" in *":${msg}"$'\n'*) continue ;; esac
  fi
  seen="${seen}${key}"$'\n'
  errors=$((errors + 1))

  if [ "$annotated" -lt "$MAX_ANNOTATIONS" ]; then
    annotated=$((annotated + 1))
    if [ -n "$file" ]; then
      rel="${file#"$WORKSPACE"/}"
      echo "::error file=$(esc_prop "$rel"),line=${fline},col=${fcol},title=Swift error::$(esc_msg "$msg")"
    else
      echo "::error title=Swift error (log line ${logline})::$(esc_msg "$msg")"
    fi
  fi

  if [ "$errors" -le "$MAX_BLOCKS" ]; then
    start=$((logline > 3 ? logline - 3 : 1))
    blocks="${blocks}
--- log line ${logline} ---
$(sed -n "${start},$((logline + 8))p" "$LOG")
"
  fi
done <<EOF
$candidates
EOF

{
  echo "## Swift \`error:\` digest — ${LABEL}"
  echo
  if [ "$errors" -gt 0 ]; then
    echo "**${errors} distinct compiler error(s)** in the captured log (warnings omitted)."
    if [ "$sentinel" = true ]; then
      echo
      echo "> The log's trailing \`error: fatalError\` is SwiftPM's *diagnostics-already-emitted* sentinel, **not a compiler crash** — the errors below are the real failure (#1335)."
    fi
    echo
    echo '```text'
    printf '%s\n' "$blocks"
    echo '```'
    if [ "$errors" -gt "$MAX_BLOCKS" ]; then
      echo
      echo "…only the first ${MAX_BLOCKS} excerpted; search the raw log for \`error: \` for the rest."
    fi
  else
    echo "No \`error:\` compiler diagnostics found — likely a test failure or other non-compiler error. Last 40 log lines:"
    echo
    echo '```text'
    tail -n 40 "$LOG"
    echo '```'
  fi
} >>"$SUMMARY"

echo "Annotated ${annotated} of ${errors} distinct error(s) from ${LOG}."
