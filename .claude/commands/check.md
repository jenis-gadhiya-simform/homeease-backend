---
description: Run format check, lint, type-check, unit tests and build, then fix what fails
allowed-tools: Bash(npm run *), Bash(npx prettier *), Bash(npx tsc *), Read, Edit
---

Run the project's full quality gate and fix anything that fails:

1. `npx prettier --check "src/**/*.ts" "test/**/*.ts"` — if it fails, run `npm run format`.
2. `npm run lint` — fix every reported problem in the source (don't disable rules unless there is a real reason, and say why).
3. `npx tsc --noEmit -p tsconfig.json` — fix type errors.
4. `npm test` — fix failing unit tests. If a test is wrong rather than the code, explain why before changing it.
5. `npm run build`.

Re-run any step you changed code for. Finish with a short table: step, result (pass/fixed/fail), and what was changed.
