---
description: Write or update Vitest unit tests for a file or feature
argument-hint: <file path or feature>
---

Write focused unit tests for: $ARGUMENTS

Load the `nestjs-testing` skill first and follow it.

- Read the target code and any existing `*.spec.ts` beside it; extend existing specs instead of duplicating them.
- Use `Test.createTestingModule` from `@nestjs/testing` and `vi.fn()` mocks (this is Vitest + ESM, not Jest).
- Cover the happy path, validation/error branches and edge cases that actually exist in the code — no tests for behaviour the code doesn't have.
- Run `npx vitest run <spec file>` and make the new tests pass. If a test reveals a real bug, report it instead of bending the test around it.
