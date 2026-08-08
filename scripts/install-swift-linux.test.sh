#!/bin/bash
#
# Exercises the retry/backoff loop in install-swift-linux.sh against a
# stubbed `swiftly` and `sleep`. The script's own fast path (swift_version_ok)
# short-circuits before that loop ever runs, so a normal `swift test` pass
# never touches it — this is the only thing that does. Verifies attempt
# count, backoff durations, and exit code for both the eventual-success and
# always-fails cases.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/install-swift-linux.sh"

overall_status=0

run_case() {
  local name="$1" fail_count="$2" want_exit="$3" want_calls="$4" want_sleeps="$5"
  local tmp
  tmp=$(mktemp -d)

  # Forces swift_version_ok() to fail so the script falls through to the
  # retry loop instead of taking the already-installed fast path.
  cat >"$tmp/swift" <<'STUB'
#!/bin/bash
exit 1
STUB

  # Fails the first $fail_count invocations, then succeeds. A call counter
  # persisted to a file since each invocation is a fresh process.
  cat >"$tmp/swiftly" <<STUB
#!/bin/bash
count_file="$tmp/swiftly_calls"
n=0
[ -f "\$count_file" ] && n=\$(cat "\$count_file")
n=\$((n + 1))
echo "\$n" >"\$count_file"
[ "\$n" -le $fail_count ] && exit 1
exit 0
STUB

  # Records requested durations instead of actually waiting, so this test
  # runs in well under a second rather than the real 15s worst case.
  cat >"$tmp/sleep" <<STUB
#!/bin/bash
echo "\$1" >>"$tmp/sleep_calls"
STUB

  chmod +x "$tmp/swift" "$tmp/swiftly" "$tmp/sleep"

  local exit_code=0
  HOME="$tmp" PATH="$tmp:$PATH" bash "$TARGET" >"$tmp/out.log" 2>&1 || exit_code=$?

  local calls sleeps
  calls=$(cat "$tmp/swiftly_calls" 2>/dev/null || echo 0)
  sleeps=$(paste -sd, "$tmp/sleep_calls" 2>/dev/null || echo "")

  local case_status="ok"
  if [ "$exit_code" != "$want_exit" ]; then
    echo "FAIL [$name]: exit code $exit_code, want $want_exit"
    case_status="fail"
  fi
  if [ "$calls" != "$want_calls" ]; then
    echo "FAIL [$name]: swiftly invoked $calls time(s), want $want_calls"
    case_status="fail"
  fi
  if [ "$sleeps" != "$want_sleeps" ]; then
    echo "FAIL [$name]: sleep calls [$sleeps], want [$want_sleeps]"
    case_status="fail"
  fi

  if [ "$case_status" = "ok" ]; then
    echo "PASS [$name]: exit=$exit_code calls=$calls sleeps=[$sleeps]"
  else
    echo "--- $name: script output ---"
    cat "$tmp/out.log"
    echo "---"
    overall_status=1
  fi

  rm -rf "$tmp"
}

run_case "succeeds on 3rd attempt (1st and 2nd fail)" 2 0 3 "5,10"
run_case "always fails (exhausts all 3 attempts)" 99 1 3 "5,10"
run_case "succeeds on 1st attempt" 0 0 1 ""

if [ "$overall_status" -ne 0 ]; then
  echo "install-swift-linux.test.sh: FAILED"
  exit 1
fi
echo "install-swift-linux.test.sh: all cases passed"
