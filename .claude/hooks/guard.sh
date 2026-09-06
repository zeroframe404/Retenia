#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash|Edit|Write|NotebookEdit).
# Denies destructive command patterns and edits to already-applied migrations.
#
# "Already applied" is approximated by "already committed": a migration file tracked by git
# has been shipped and may be in someone's database, so docs/spec/00-conventions.md forbids
# touching it. A brand-new, untracked file is the migration being written right now — that
# one is allowed through, and `.claude/settings.json` puts it behind an `ask` so a human
# still reviews it.
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

# 0 when the path is a migration file git already tracks (committed, therefore possibly
# applied). Unknown paths and untracked files return 1, so a new migration is not blocked.
migration_is_committed() {
  local path="$1" status
  [[ "$path" =~ $migrations_re ]] || return 1
  command -v git >/dev/null 2>&1 || return 0
  git ls-files --error-unmatch -- "$path" >/dev/null 2>&1
  status=$?
  # Exit 1 is the one answer that means "git looked and the file is untracked". Anything else
  # — 128 for "not a git repository", a bad cwd, a broken index — is git failing to answer, and
  # an unanswered question about a migration blocks.
  [ "$status" -eq 1 ] && return 1
  return 0
}

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
    if migration_is_committed "$file_path"; then
      reason="Editing a committed migration is blocked by repo policy: an applied migration is never modified, write a new one instead (docs/spec/00-conventions.md)."
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
        # Blanket, unlike the Edit/Write branch above: picking the target path out of an
        # arbitrary shell command is guesswork, so the shell has no business writing there at
        # all — a new migration is written with the file tools, which are reviewed.
        reason="Writing into migrations/ from the shell is blocked by repo policy: write a new migration with the file tools instead, so it goes through review."
      fi
    fi
    ;;
esac

if [ -n "$reason" ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
fi

exit 0
