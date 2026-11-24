#!/usr/bin/env bash
# PreToolUse hook (Bash): stop shell commands that read secret env files
# (.env, .env.local, .env.production, …). `.env.example` stays allowed.
# The Read tool is covered by permissions.deny in .claude/settings.json;
# this covers `cat .env`, `grep X .env`, `source .env`, `--env-file .env`, ….

set -uo pipefail

command=$(jq -r '.tool_input.command // empty')
[ -z "$command" ] && exit 0

# Ignore the template, then look for `.env` as a file name: not part of a
# longer word (`process.env`, `env.ts`), optionally with a suffix like
# `.local` / `.production` / `.test.local`.
stripped=$(printf '%s' "$command" | sed -E 's/\.env\.example//g')
if printf '%s' "$stripped" | grep -Eq '(^|[^A-Za-z0-9_])\.env(\.[A-Za-z0-9_.]+)?($|[^A-Za-z0-9_.])'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Reading .env files is blocked in this project (secrets). Use .env.example for variable names, or ask the user for a specific non-secret value."
    }
  }'
  exit 0
fi
exit 0
