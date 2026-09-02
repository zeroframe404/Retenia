#!/usr/bin/env bash
# Stop hook. Runs typecheck + tests for the affected packages.
# Exit 2 is the only blocking code; every other exit lets the agent stop.
set -uo pipefail

input="$(cat 2>/dev/null || true)"

# Never block twice in a row: when Claude Code re-runs this hook after it
# already blocked once, stop_hook_active is true and we must let the turn end.
stop_hook_active="false"
if [ -n "$input" ]; then
  if command -v jq >/dev/null 2>&1; then
    stop_hook_active="$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)"
  elif command -v node >/dev/null 2>&1; then
    stop_hook_active="$(printf '%s' "$input" | node -e '
      let d = "";
      process.stdin.on("data", (c) => (d += c));
      process.stdin.on("end", () => {
        try {
          process.stdout.write(String(JSON.parse(d).stop_hook_active === true));
        } catch {
          process.stdout.write("false");
        }
      });
    ' 2>/dev/null)"
  fi
fi

if [ "$stop_hook_active" = "true" ]; then
  echo "verify.sh: stop_hook_active is set, not blocking again" >&2
  exit 0
fi

project_dir="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$project_dir" || exit 0

has_packages=false
for dir in apps packages tooling; do
  [ -d "$dir" ] || continue
  for pkg in "$dir"/*/package.json; do
    if [ -e "$pkg" ]; then
      has_packages=true
      break 2
    fi
  done
done

if [ "$has_packages" = false ]; then
  echo "verify.sh: no workspace packages yet, skipping typecheck/test" >&2
  exit 0
fi

if ! pnpm typecheck; then
  echo "verify.sh: typecheck failed, see output above" >&2
  exit 2
fi

# `--affected` is a turbo flag, not a passthrough argument, so it has to reach
# turbo directly: `pnpm test --affected` would forward it to the package script.
# Fall back to the full run when turbo cannot resolve a git base to diff against.
if ! pnpm exec turbo run test --affected; then
  if ! pnpm exec turbo run test; then
    echo "verify.sh: tests failed, see output above" >&2
    exit 2
  fi
fi

exit 0
