---
description: Review staged/unstaged changes and create a Conventional Commit
argument-hint: [optional hint about the change]
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git add:*), Bash(git commit:*), Bash(git log:*), Bash(npm run lint), Bash(npm test)
---

## Context

- Status: !`git status --short`
- Diff: !`git diff HEAD --stat`
- Recent commits: !`git log --oneline -5`
- Hint from user: $ARGUMENTS

## Task

1. Look at the full diff (`git diff HEAD`). If you see secrets, `.env` files, or debug leftovers, stop and tell me.
2. Run `npm run lint` and `npm test`. If either fails, stop and report — don't commit.
3. Stage the relevant files (never `.env`) and create one commit with a Conventional Commit message (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`), a concise subject under 72 chars, and a short body explaining *why* when it isn't obvious.
4. Do not push.
