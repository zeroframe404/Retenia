#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash). Denies destructive command patterns outright.
set -uo pipefail

input="$(cat)"

if command -v jq >/dev/null 2>&1; then
  command_str="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
else
  command_str="$(printf '%s' "$input" | node -e '
    let d = "";
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => {
      try {
        const j = JSON.parse(d);
        process.stdout.write((j.tool_input && j.tool_input.command) || "");
      } catch {
        process.stdout.write("");
      }
    });
  ' 2>/dev/null)"
fi

reason=""
case "$command_str" in
  *"rm -rf"*) reason="rm -rf is blocked by repo policy. Ask the user to run it manually if truly needed." ;;
  *"--force"*) reason="--force flags are blocked by repo policy (e.g. force-push). Ask the user to run it manually if truly needed." ;;
  *"reset --hard"*) reason="git reset --hard is blocked by repo policy (discards uncommitted work). Ask the user to run it manually if truly needed." ;;
esac

if [ -n "$reason" ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
fi

exit 0
