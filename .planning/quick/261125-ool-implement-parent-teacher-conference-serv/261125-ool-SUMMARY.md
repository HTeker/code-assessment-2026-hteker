---
quick_id: 261125-ool
status: complete
completed: 2026-11-25
commits:
  - 8564d4e
  - 79a4976
  - e19d4ff
  - 008ee4f
tests: 65 passing (7 unit, 58 API)
---

# Quick Task 261125-ool: Parent-teacher conference service Summary

TypeScript/Fastify in-memory conference-booking API with fake Bearer auth, synchronous service for atomic booking, OpenAPI docs at `/docs`, 65 passing tests, Dockerfile, README, and a DECISIONS.md with a 63-item appendix.

## Commits (on main, not pushed)

- `8564d4e` feat(261125-ool): core domain, slot generation and booking service
- `79a4976` feat(261125-ool): HTTP API with auth, validation and OpenAPI docs (also contains the `git mv README.md ASSIGNMENT.md` rename, see deviations)
- `e19d4ff` docs(261125-ool): README run guide, move brief to ASSIGNMENT.md
- `008ee4f` docs(261125-ool): DECISIONS.md with core rationale and full decision appendix

## Verification

- `npm run typecheck`: clean.
- `npm test`: 65/65 pass (`test/slots.test.ts` 7, `test/api.test.ts` 58).
- `npm start`: `GET /me` with `Bearer parent-1` returned Anna with children; `/docs/` returned 200; `/docs/json` contains the global bearerAuth security. The README curl walkthrough was run end to end against the live server. Server stopped afterwards.
- DECISIONS.md spot-check: all 11 routes, 14 error codes and seed ids match the code. Part 1 is about 957 words.

## Deviations from Plan

1. **Rename landed in the API commit.** `git mv README.md ASSIGNMENT.md` was staged before the first task-2 commit, so the rename is in `79a4976`, and `e19d4ff` only adds the new README. Content is unchanged (verified identical to the original). Not rewritten because history is already linear and unpushed work is harmless here.
2. **Auth in an `onRequest` hook** (plan said `getUser` called from routes). Routes live in an encapsulated scope with `decorateRequest("user")`, so unauthenticated calls get 401 before body validation, and `/docs` stays public.
3. **Extra error handling:** malformed JSON and other Fastify 4xx errors map to 400 `BAD_REQUEST`; unknown routes map to 404 `NOT_FOUND` in the same error shape.
4. **`error` typed as `FastifyError`** in `setErrorHandler` (Fastify 5 types it as `unknown`).
5. **Invalid calendar date** (for example 2026-02-30) returns 400 `VALIDATION_ERROR` (plan only named the real-calendar check, not the code).
6. **Swagger security applied globally** in the OpenAPI config rather than per route.
7. **Tooling versions:** npm resolved TypeScript 7, Vitest 5, Fastify 5.
8. **Docker image not built:** the Docker daemon was not running here, so the Dockerfile is unverified.

## Known notes

- Fastify defaults: extra body fields are silently removed and numeric strings (`"15"`) are coerced. Recorded in DECISIONS.md appendix item 3.
- The parallel double-booking test is a smoke test only (`inject` is in-process); the real guarantee is the synchronous service. Recorded in appendix item 58.
- No stubs, TODOs or skipped tests.
