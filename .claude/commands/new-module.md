---
description: Scaffold a NestJS feature module (module, controller, service, tests)
argument-hint: <name> [short description of what it does]
---

Create a new NestJS feature module for: $ARGUMENTS

Load the `nestjs-feature` skill (and `nestjs-testing` for the tests) first and follow it.

Requirements:

- Put it in `src/modules/<name>/` (all feature modules live under `src/modules/`, never directly in `src/`) with `<name>.module.ts`, `<name>.controller.ts`, `<name>.service.ts`.
- Import it into `AppModule` from `./modules/<name>/<name>.module.js`.
- This is an ESM project: relative imports end in `.js`.
- Validate request bodies/params with a Standard Schema library (Zod) via `@Body({ schema })` / `@Param('id', { schema })`, not hand-written checks.
- Register the module in `src/app.module.ts`.
- Add focused Vitest specs beside the code (`*.spec.ts`, using `vi.fn()` for mocks) covering each endpoint's happy path and main error case.
- Run `npm run lint` and `npm test` at the end and make them pass.

If the name or purpose is missing, ask for it before writing anything.
