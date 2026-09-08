#!/usr/bin/env bash
# PostToolUse hook (matcher: Edit|Write).
# Formats the file that was just edited with Biome. Never blocks the agent.
set -uo pipefail

input="$(cat)"

if command -v jq >/dev/null 2>&1; then
  file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"
else
  file_path="$(printf '%s' "$input" | node -e '
    let d = "";
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => {
      try {
        const j = JSON.parse(d);
        process.stdout.write((j.tool_input && j.tool_input.file_path) || "");
      } catch {
        process.stdout.write("");
      }
    });
  ' 2>/dev/null)"
fi

[ -z "${file_path:-}" ] && exit 0
[ -f "$file_path" ] || exit 0

case "$file_path" in
  *.js | *.jsx | *.mjs | *.cjs | *.ts | *.tsx | *.mts | *.cts | *.json | *.jsonc | *.css)
    project_dir="${CLAUDE_PROJECT_DIR:-.}"
    (cd "$project_dir" && pnpm exec biome check --write "$file_path") >/dev/null 2>&1 || true
    ;;
esac

exit 0
