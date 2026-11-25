---
quick_id: 261125-ool
mode: quick
type: execute
files_modified:
  - package.json
  - tsconfig.json
  - .gitignore
  - .dockerignore
  - Dockerfile
  - src/**
  - test/**
  - README.md
  - ASSIGNMENT.md
  - DECISIONS.md
---

# Quick Task 261125-ool: Parent-teacher conference service

**Read first:** `261125-ool-CONTEXT.md` in this directory. Every decision there is LOCKED. This plan makes the open "Claude's discretion" items concrete. Do not improvise beyond it; if something is truly unspecified, choose the simplest option and record it for the DECISIONS.md appendix.

**Guiding rule:** clean, robust, as simple as possible. Boring explicit code. No classes where a function will do (except the one error class). No DI framework, no ORM, no lodash, no date library.

---

## Fixed design (applies to all tasks)

### Tooling
- `npm`, Node >= 20 (`"engines": {"node": ">=20"}`), `"type": "module"`.
- Runtime deps: `fastify`, `@fastify/swagger`, `@fastify/swagger-ui`.
- Dev deps: `typescript`, `tsx`, `vitest`, `@types/node`.
- Scripts: `"start": "tsx src/server.ts"`, `"dev": "tsx watch src/server.ts"`, `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`.
- tsconfig: `strict: true`, `noUncheckedIndexedAccess: true`, `module/moduleResolution: "NodeNext"`, `target: "ES2022"`, `noEmit: true`. (Run with tsx, so no build step. Imports use `.js` extensions per NodeNext.)
- Port from `PORT` env, default 3000, host `0.0.0.0`.

### File layout
```
src/
  domain.ts        types: Teacher, Parent, Child, User, Evening, Slot, Booking
  errors.ts        AppError class (code, status, message) + small factory helpers
  time.ts          pure helpers: toMinutes("HH:mm"), toHHmm(min), isValidDate("YYYY-MM-DD"), localNow(date): "YYYY-MM-DD HH:mm"
  slots.ts         pure generateSlotTimes(startTime, endTime, slotMinutes): {startTime,endTime}[]  (drops leftover)
  store.ts         createStore(): in-memory Maps + counter ids (evening-1, slot-1, booking-1)
  seed.ts          seed(store, now): users/children + one sample evening 14 days from now
  service.ts       createService(store, now): all business rules, SYNCHRONOUS functions
  auth.ts          getUser(request, store): parses "Authorization: Bearer <userId>" → User, else 401
  routes.ts        registers all routes with JSON schemas; thin: auth → service → reply
  app.ts           buildApp({ now?, seedData? }): Fastify instance + swagger + error handler + routes
  server.ts        buildApp() + listen
test/
  slots.test.ts    unit tests for generateSlotTimes + time helpers
  api.test.ts      HTTP tests via app.inject() with a fixed fake clock
```

### Data model (`domain.ts`)
- `Teacher { id, name, role: "teacher" }`, `Parent { id, name, role: "parent", childIds: string[] }`, `User = Teacher | Parent`.
- `Child { id, name, teacherId }`.
- `Evening { id, teacherId, date, startTime, endTime, slotMinutes }`.
- `Slot { id, eveningId, startTime, endTime, maxBookings }`.
- `Booking { id, slotId, childId, bookedByParentId }`. Child's evening is derived via slot → evening.

### Store (`store.ts`)
Plain object of `Map<string, T>` for teachers/parents/children/evenings/slots/bookings, plus `nextId(prefix)` using a counter per prefix → `"slot-1"`, `"slot-2"`. Readable ids make curl demos easy. No business logic in the store.

### Time & cutoff
- Times are school-local wall-clock strings. `localNow(now())` formats the injected `Date` with local getters into `"YYYY-MM-DD HH:mm"`. An evening has started when `${date} ${startTime}` <= localNow (plain string compare works because the format is fixed width).
- `now` is injected: `buildApp({ now: () => new Date("2026-12-01T12:00:00") })` in tests.

### Errors
- `AppError extends Error { code: string; status: number }`.
- One Fastify `setErrorHandler`: AppError → `{ error: { code, message } }` with its status. Fastify validation errors (`error.validation`) → 400 `{ error: { code: "VALIDATION_ERROR", message } }`. Anything else → 500 `{ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } }` (log it).
- Codes: `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `INVALID_TIME_RANGE` 400, `EVENING_IN_PAST` 400, `INVALID_MOVE` 400, `EVENING_STARTED` 409, `SLOT_FULL` 409, `CHILD_ALREADY_BOOKED` 409, `SLOT_HAS_BOOKINGS` 409, `CAPACITY_BELOW_BOOKINGS` 409.
- Policy: 404 `NOT_FOUND` for resources the user may not see (don't leak that they exist). 403 `FORBIDDEN` for wrong role, and for "this child is not in this teacher's class".

### Access rules (service)
- Teacher can only see/modify own evenings & their slots (others → 404).
- Parent can see an evening only if one of their children has that evening's teacher (else 404).
- Parent books only for own child: child not theirs → 404 `NOT_FOUND`. Child's teacher ≠ evening's teacher → 403 `FORBIDDEN` "This child is not in this teacher's class". (Record this choice.)
- Booking visible/editable to: any parent whose `childIds` includes booking.childId, and the evening's teacher. Others → 404.
- All mutations on an evening (book, move, cancel, delete slot, patch slot) are rejected with 409 `EVENING_STARTED` once the evening has started.

### API (all JSON; all require `Authorization: Bearer <userId>`)
| Method & URL | Who | Body | Success | Notes |
|---|---|---|---|---|
| `GET /me` | any | – | 200 user (+ children with names for parents) | handy for demos |
| `POST /evenings` | teacher | `{date, startTime, endTime, slotMinutes, maxBookingsPerSlot?}` | 201 evening + `slots[]` | schema: date `^\d{4}-\d{2}-\d{2}$`, time `^([01]\d\|2[0-3]):[0-5]\d$`, slotMinutes int 5..240, maxBookingsPerSlot int 1..50 default 1. Service: real calendar date, end > start, ≥1 slot fits (`INVALID_TIME_RANGE`), not already started (`EVENING_IN_PAST`). |
| `GET /evenings` | teacher: own; parent: evenings of their children's teachers | – | 200 list of evenings (no slots) | sorted by date, startTime |
| `GET /evenings/:eveningId/slots` | parent | – | 200 free slots only: `{id, startTime, endTime, spotsLeft}` | req. 3 |
| `GET /evenings/:eveningId/overview` | teacher (owner) | – | 200 `{evening, slots:[{id,startTime,endTime,maxBookings,spotsLeft,bookings:[{id, child:{id,name}, bookedBy:{id,name}}]}]}` all slots, time order | req. 6 |
| `PATCH /slots/:slotId` | teacher (owner) | `{maxBookings}` int 1..50 | 200 slot | `CAPACITY_BELOW_BOOKINGS` |
| `DELETE /slots/:slotId` | teacher (owner) | – | 204 | `SLOT_HAS_BOOKINGS` | req. 7 |
| `POST /bookings` | parent | `{slotId, childId}` | 201 booking view | `SLOT_FULL`, `CHILD_ALREADY_BOOKED` (one per child per evening) |
| `GET /bookings` | parent | – | 200 bookings for ALL their children (incl. booked by other parent), sorted | req. 5 |
| `PATCH /bookings/:bookingId` | parent of child or evening teacher | `{slotId}` | 200 booking view | target must be in the same evening (else 400 `INVALID_MOVE` "Can only move within the same evening"); same slot → no-op 200; target full → `SLOT_FULL` | req. 4 |
| `DELETE /bookings/:bookingId` | parent of child or evening teacher | – | 204 | req. 4 |

Booking view: `{ id, eveningId, date, startTime, endTime, child:{id,name}, bookedBy:{id,name} }`.

Swagger: `@fastify/swagger` (openapi 3, bearerAuth security scheme, title "Parent-teacher conferences") + `@fastify/swagger-ui` at `/docs`. Route schemas carry `tags` and `summary`. Response schemas optional (skip them to keep it small — record this).

### Concurrency note
Service functions are synchronous: each check-then-write runs to completion on the single JS thread before another request is handled, so two parents can't both take the last spot. Must be commented in `service.ts` near `bookSlot` and explained in DECISIONS.md.

### Seed (`seed.ts`)
- `teacher-1` "Ms. Jansen", `teacher-2` "Mr. de Vries".
- `parent-1` "Anna" → [child-1, child-2]; `parent-2` "Ben" → [child-1]; `parent-3` "Carla" → [child-3]; `parent-4` "Daan" → [child-4].
- `child-1` "Sam" (teacher-1), `child-2` "Lily" (teacher-2), `child-3` "Noor" (teacher-1), `child-4` "Milan" (teacher-2).
- Covers: Sam has two parents; Anna has kids in two classes.
- Sample evening for teacher-1: date = local today + 14 days (computed from injected `now`), 18:00–20:00, 15 min, max 1 → becomes `evening-1` with `slot-1`..`slot-8`. Create it through the service (not raw store writes) so it obeys the same rules.
- Tests use the same seed with a fixed clock. `buildApp` takes only `{ now }`.

---

## Task 1: Scaffold + core logic + unit tests
**files:** package.json, tsconfig.json, .gitignore (node_modules, coverage), src/domain.ts, src/errors.ts, src/time.ts, src/slots.ts, src/store.ts, src/seed.ts, src/service.ts, test/slots.test.ts
**action:** Init npm project with the exact deps/scripts above (`npm install`). Implement pure helpers, slot generation (drop leftover partial slot), store, seed and the full service (all rules in "Access rules", "Time & cutoff", "API" table — service returns plain data/view objects). Unit tests: even division; leftover dropped (18:00–20:10/15 → last 19:45–20:00); slot longer than range → []; end <= start handled by service; toMinutes/toHHmm round-trip; isValidDate rejects 2026-02-30; localNow format.
**verify:** `npm run typecheck` and `npm test` pass.
**done:** commit `feat(261125-ool): core domain, slot generation and booking service`.

## Task 2: HTTP layer + integration tests + Dockerfile + README/ASSIGNMENT
**files:** src/auth.ts, src/routes.ts, src/app.ts, src/server.ts, test/api.test.ts, Dockerfile, .dockerignore, README.md, ASSIGNMENT.md
**action:** Implement auth, routes (with JSON schemas, tags, summaries), error handler, swagger. `git mv README.md ASSIGNMENT.md` (content unchanged), then write new README.md: what it is (2 lines), requirements (Node ≥ 20), `npm install`, `npm start`, open http://localhost:3000/docs (Authorize with a seeded user id), `npm test`, Docker (`docker build -t conferences . && docker run -p 3000:3000 conferences`), table of seeded users/children, and a curl walkthrough: Anna lists evenings → lists free slots of evening-1 → books slot-1 for child-1 (Sam) → Ben sees it in GET /bookings → Ben moves it to slot-2 → teacher-1 overview → teacher-1 deletes empty slot-5 for a break → Anna cancels. Mention data is in-memory and resets on restart; link to DECISIONS.md and ASSIGNMENT.md.
Dockerfile: `node:24-alpine`, WORKDIR /app, copy package*.json, `npm ci`, copy src + tsconfig, `EXPOSE 3000`, `CMD ["npm","start"]` (tsx is a devDependency → use `npm ci` including dev deps; record this tradeoff).
Integration tests (fresh `buildApp({ now: fixed })` per test, `app.inject`), covering at least: 401 missing/unknown token; 403 parent creating evening; teacher creates evening → correct slots incl. capacity default 1 and custom; 400 invalid time range / bad format / past evening; parent sees only free slots; book → 201; SLOT_FULL; CHILD_ALREADY_BOOKED (second parent books same child same evening); cannot book for other's child (404); child of other teacher → 403; second parent sees booking in GET /bookings; move by other parent; move to full slot 409; move to other evening 400; cancel by parent; teacher cancels/moves; teacher overview lists all slots with child + bookedBy; teacher of other evening → 404; PATCH capacity up allows second booking; CAPACITY_BELOW_BOOKINGS; DELETE slot empty → 204 and gone from slots/overview; SLOT_HAS_BOOKINGS; EVENING_STARTED for book/move/cancel/delete when clock is after start (use a second app with a later clock, or create evening then advance a mutable clock variable).
**verify:** `npm run typecheck`, `npm test` pass; `npm start` then `curl -s localhost:3000/me -H 'Authorization: Bearer parent-1'` returns Anna and `/docs` returns 200; stop server.
**done:** commits `feat(261125-ool): HTTP API with auth, validation and OpenAPI docs` and `docs(261125-ool): README run guide, move brief to ASSIGNMENT.md, Dockerfile` (may combine docker into first).

## Task 3: DECISIONS.md
**files:** DECISIONS.md
**action:** Write DECISIONS.md by reading the FINAL code (not just this plan) so it matches reality. Style: below 5th-grade reading level — short sentences, simple everyday words — but KEEP technical jargon (Fastify, in-memory, event loop, 409 Conflict, JSON Schema, OpenAPI, Bearer token, tsx, Vitest…). Use a tiny one-line plain explanation the first time a jargon word appears if helpful.
Structure:
1. **Core (~2 pages)** — the parts the assignment asks for:
   - The big choices and why (stack, in-memory, fake bearer auth, one teacher per evening, slot rules, booking rules, time model, structure).
   - What I left out on purpose (UI, real auth, database, notifications/emails, timezones, multi-teacher evenings, editing/deleting evenings, waiting lists, pagination, rate limiting, response schemas, i18n…).
   - What breaks first at 100 schools tomorrow (ordered: data lost on restart/deploy + can't run >1 instance because state is in process memory → double booking across instances if scaled; fake auth = anyone can be anyone; evening-start rush hammering one process; no timezone handling across regions; no notifications when teacher removes/changes; no audit log/monitoring; counter ids not unique across instances). For each: one line on the fix.
   - How I used AI: factual — Claude Code running the GSD "quick" workflow: (a) AI asked me ~20 multiple-choice questions to lock every grey area, (b) a planner agent/plan, (c) an executor agent wrote code, tests and docs as atomic commits, (d) I reviewed, ran it and own every line. Note the planning files are committed under `.planning/` so reviewers can see the process. Leave it easy for the user to rewrite in their own words.
2. **Appendix: every decision** — EVERY decision from CONTEXT.md plus every implementation choice (npm, tsx vs tsc build vs node type-stripping, Vitest vs Jest vs node:test, Fastify JSON Schema vs zod, counter ids vs UUIDs, error shape, 404-vs-403 policy, URL design, booking view shape, free-slots-only listing, overview includes empty slots, same-slot move no-op, move only within same evening, cutoff applies to teacher too, evening-in-past check, slot bounds 5..240, capacity bounds 1..50, Dockerfile with dev deps, no response schemas, synchronous service for atomicity, injectable clock, seeded sample evening 14 days ahead, seed through service, string-compare time trick, .planning committed, ASSIGNMENT.md move, commits on main…). Format each as:
   ```
   ### N. <Short title>
   - **Decision:** …
   - **Alternatives:** A — …; B — …
   - **Why:** …
   ```
   Group under headings (Stack & tooling, Data & storage, Identity & access, Evenings & slots, Bookings, Time, API & errors, Testing, Delivery & docs).
**verify:** every API route, status code and seed id mentioned in DECISIONS.md exists in code (grep spot-check); core section reads ≈2 pages (~900–1100 words).
**done:** commit `docs(261125-ool): DECISIONS.md with core rationale and full decision appendix`.

---

## must_haves
- All 7 assignment requirements reachable via the API and covered by integration tests.
- `npm install && npm start` works; `/docs` serves Swagger UI; `npm test` and `npm run typecheck` green.
- ASSIGNMENT.md == original README.md content.
- DECISIONS.md: ~2-page core + full appendix, simple style with jargon, matches code.
