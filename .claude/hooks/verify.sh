#!/usr/bin/env bash
# Stop hook. Runs typecheck + tests for changed files.
# Exit 2 is the only blocking code; every other exit lets the agent stop.
set -uo pipefail

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

if ! pnpm test --changed; then
  echo "verify.sh: tests failed, see output above" >&2
  exit 2
fi

exit 0
