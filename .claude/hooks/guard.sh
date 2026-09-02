#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash|Edit|Write|NotebookEdit).
# Denies destructive command patterns and edits to already-applied migrations.
set -uo pipefail

input="$(cat)"

read_field() {
  # $1 = jq path, e.g. '.tool_input.command'
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null
  elif command -v node >/dev/null 2>&1; then
    printf '%s' "$input" | FIELD="$1" node -e '
      let d = "";
      process.stdin.on("data", (c) => (d += c));
      process.stdin.on("end", () => {
        try {
          const path = process.env.FIELD.replace(/^\./, "").split(".");
          let v = JSON.parse(d);
          for (const k of path) v = v == null ? undefined : v[k];
          process.stdout.write(v == null ? "" : String(v));
        } catch {
          process.stdout.write("");
        }
      });
    ' 2>/dev/null
  else
    printf ''
  fi
}

tool_name="$(read_field '.tool_name')"
command_str="$(read_field '.tool_input.command')"
file_path="$(read_field '.tool_input.file_path')"

migrations_re='(^|/)migrations/'

# Returns 0 when any `rm` invocation in the command combines a recursive flag
# with a force flag, in any order and in short or long form.
rm_recursive_force() {
  local cmd="$1" rest word recursive force
  while [[ "$cmd" =~ (^|[^[:alnum:]_./-])rm[[:space:]]+(.*) ]]; do
    rest="${BASH_REMATCH[2]}"
    recursive=false
    force=false
    for word in $rest; do
      case "$word" in
        --recursive) recursive=true ;;
        --force) force=true ;;
        --*) : ;;
        -*)
          [[ "$word" == *[rR]* ]] && recursive=true
          [[ "$word" == *f* ]] && force=true
          ;;
        *) break ;;
      esac
    done
    if [ "$recursive" = true ] && [ "$force" = true ]; then
      return 0
    fi
    cmd="$rest"
  done
  return 1
}

reason=""

case "$tool_name" in
  Edit | Write | NotebookEdit | MultiEdit)
    if [[ "$file_path" =~ $migrations_re ]]; then
      reason="Editing files under migrations/ is blocked by repo policy: an applied migration is never modified, write a new one instead (docs/spec/00-conventions.md)."
    fi
    ;;
  *)
    if [ -n "$command_str" ]; then
      if rm_recursive_force "$command_str"; then
        reason="Recursive force-delete is blocked by repo policy. Ask the user to run it manually if truly needed."
      elif [[ "$command_str" =~ (^|[^[:alnum:]_./-])find[[:space:]].*(-delete|-exec[[:space:]]+rm) ]]; then
        reason="find with -delete or -exec rm is blocked by repo policy. Ask the user to run it manually if truly needed."
      elif [[ "$command_str" =~ (curl|wget)[^|]*\|[[:space:]]*(sudo[[:space:]]+)?(sh|bash|zsh) ]]; then
        reason="Piping a downloaded script straight into a shell is blocked by repo policy. Download, review, then run it."
      elif [[ "$command_str" =~ git[[:space:]]+push([[:space:]]+[^\;\&\|]*)?[[:space:]](--force([^-]|$)|-[a-zA-Z]*f[a-zA-Z]*([[:space:]]|$)) ]]; then
        reason="git push --force is blocked by repo policy (docs/spec/00-conventions.md). Use --force-with-lease, or ask the user to run it manually."
      elif [[ "$command_str" =~ git[[:space:]]+reset[[:space:]]+([^\;\&\|]*[[:space:]])?--hard ]]; then
        reason="git reset --hard is blocked by repo policy (discards uncommitted work). Ask the user to run it manually if truly needed."
      elif [[ "$command_str" =~ (^|[^[:alnum:]_./-])(sed[[:space:]]+-i|tee|(\>\>?))[^\;\&\|]*migrations/ ]]; then
        reason="Writing into migrations/ from the shell is blocked by repo policy: an applied migration is never modified, write a new one instead."
      fi
    fi
    ;;
esac

if [ -n "$reason" ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
fi

exit 0
