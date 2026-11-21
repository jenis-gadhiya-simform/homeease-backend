#!/usr/bin/env bash
# PostToolUse hook: format with Prettier and lint with oxlint after Claude edits a file.
# - Prettier runs on any file type it understands (unknown types are skipped).
# - oxlint runs with --fix on .ts/.js files; remaining lint errors are sent back
#   to Claude (exit 2) so it fixes them in the same turn.

set -uo pipefail

file=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
[ -z "$file" ] || [ ! -f "$file" ] && exit 0

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" || exit 0

# Only touch files inside this project, and never node_modules / build output.
case "$file" in
  "$root"/*) ;;
  *) exit 0 ;;
esac
case "$file" in
  */node_modules/* | */dist/* | */coverage/*) exit 0 ;;
esac

bin="$root/node_modules/.bin"

# 1. Format
"$bin/prettier" --write --ignore-unknown --log-level warn "$file" >/dev/null 2>&1

# 2. Lint (TypeScript / JavaScript only)
case "$file" in
  *.ts | *.tsx | *.js | *.mjs | *.cjs)
    if ! out=$("$bin/oxlint" --type-aware --fix --quiet "$file" 2>&1); then
      echo "oxlint found problems in $file that need fixing:" >&2
      echo "$out" >&2
      exit 2
    fi
    ;;
esac

exit 0
