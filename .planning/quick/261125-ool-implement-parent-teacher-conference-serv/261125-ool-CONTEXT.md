# Quick Task 261125-ool: Implement parent-teacher conference service - Context

**Gathered:** 2026-11-25
**Status:** Ready for planning
**Source:** 5+ rounds of multiple-choice Q&A with the user (all answers below are LOCKED)

<domain>
## Task Boundary

Implement the assignment in the original `README.md` (to be moved to `ASSIGNMENT.md`): a TypeScript backend for planning parent-teacher conference evenings. Deliver code + tests + a new `README.md` (how to run/try) + a `DECISIONS.md` in the repo root.

Requirements from the assignment:
1. Teacher creates a conference evening (date, start time, end time, conversation length) → time slots are generated.
2. A slot has a max number of conversations, default 1.
3. Parent sees free slots of an evening and books one for a child.
4. Parent can move a booking to another slot, or cancel it.
5. A child can have more than one parent; every parent of the child sees the appointment.
6. Teacher sees an overview of the evening: which child comes when, with which parent.
7. Teacher can remove a time slot (e.g. for a break).

Overarching user instruction: **code must be clean, robust and as simple as possible, so it is easy to reason about and justify in a live interview.** Prefer boring, explicit code over clever abstractions. Minimal dependencies. Scope should look like ~4 hours of focused human work (no gold plating).
</domain>

<decisions>
## Implementation Decisions (LOCKED)

### Stack
- **TypeScript** on Node.js (Node 24 available locally). Strict tsconfig.
- **Fastify** web framework. Use JSON Schema route schemas for request validation (built-in). Use `@fastify/swagger` + `@fastify/swagger-ui` for OpenAPI docs at `/docs`.
- Tests with **Vitest**; HTTP tests via Fastify `app.inject()` (no real network).
- Package manager: npm (simplest for reviewers). Run TS directly with `tsx` for dev/start, or compile with `tsc` — pick the simplest robust option and justify it.

### Storage
- **In-memory** store (plain Maps/arrays) behind a small store module. Data resets on restart; seeded at startup. Node's single-threaded event loop + synchronous service methods means check-then-write is atomic (no awaits between check and write) — this is the double-booking guarantee and must be explained.

### Identity
- **Fake Bearer token**: `Authorization: Bearer <userId>`. The userId is looked up in seeded users; role (teacher/parent), parent→children links and child→teacher links come from the seed. Unknown/missing token → 401. Wrong role for an endpoint → 403.

### Ownership & eligibility
- An evening belongs to **exactly one teacher** (the creator).
- A parent may only book for **their own child**, and only on an evening of **that child's teacher**.
- **One booking per child per evening.** Second booking for same child on same evening → 409 (move instead).

### Slot generation
- Evening input: `date` (YYYY-MM-DD), `startTime`/`endTime` (HH:mm), `slotMinutes`, optional `maxBookingsPerSlot` (default 1).
- Slots are consecutive full-length slots from start; a **leftover partial slot is dropped** (e.g. 18:00–20:10 with 15 min → last slot 19:45–20:00).
- Validate: end after start, slotMinutes positive and fits at least one slot, sane bounds.

### Time model
- **Local date + HH:mm strings** (school-local wall time). No timezones, no UTC conversion.
- Cutoff: parents cannot book/move/cancel once the evening has **started** (date+startTime <= now). Teachers may also not change bookings after start (keep one rule).
- **Injectable clock**: service receives a `now()` function so tests can fake time. Default uses server local time.

### Capacity
- `maxBookingsPerSlot` set per evening (default 1), copied to each slot; **editable per slot** via `PATCH` on a slot (`maxBookings`).
- Lowering a slot's maxBookings **below its current number of bookings → 409**.

### Slot removal
- Teacher (owner) can delete a slot. If the slot **has bookings → 409** (parents must move first). Removed slots simply disappear.

### Move / cancel rights
- **Any parent of the child AND the evening's teacher** can move or cancel a booking.
- Move target must be a slot of the same evening with free capacity → otherwise 409.

### Visibility
- Every parent of a child sees that child's bookings (e.g. `GET /me/bookings` or similar for a parent returns bookings for all their children, including ones booked by the other parent). Record `bookedBy` parent id.
- Parent listing free slots: only slots with remaining capacity.
- Teacher overview: **every slot (booked or empty)** in time order, with each booking's child and booking parent, and remaining capacity.

### Structure
- **Routes → service → store**. Thin Fastify routes (HTTP/validation/auth mapping only); a service module with all business rules (no HTTP knowledge, throws typed domain errors mapped to status codes in one place); in-memory store. A separate pure slot-generation function (unit tested).

### Tests
- **Unit tests** for slot generation (and time helpers) + **HTTP integration tests** (inject) covering every requirement and the main error cases (401/403/404/409/400, cutoff via fake clock, double-booking, capacity, removal with bookings, visibility for second parent, teacher move/cancel).

### Extras (chosen)
- OpenAPI + Swagger UI at `/docs`.
- `Dockerfile` (simple, runs the app).
- Slot capacity edit endpoint (PATCH slot maxBookings).
- NOT chosen: web UI.

### Seed data
- Small realistic set: 2 teachers, ~4 parents, ~4 children. Include: one child with two parents; one parent with children in two different teachers' classes; one sample evening pre-created (in the future) so reviewers can try booking immediately. Use readable stable ids (e.g. `teacher-1`, `parent-1`, `child-1`) so curl examples are easy.

### Documents
- Move current `README.md` → `ASSIGNMENT.md` verbatim (git mv).
- New `README.md`: short steps to install, run, run tests, open /docs, plus curl examples for the main flow using seeded tokens; list seeded users.
- `DECISIONS.md` in root:
  - **Writing style: below 5th-grade reading level (short sentences, simple words) BUT keep the technical jargon** (e.g. "Fastify", "in-memory", "409 Conflict", "event loop").
  - **Structure: a ~2-page core** covering exactly what the assignment asks: the choices made and why; what was deliberately left out; what goes wrong first if live tomorrow at 100 schools (e.g. in-memory data lost on restart / no horizontal scaling, fake auth, no timezone, no notifications, single process, no rate limiting, no persistence/backups); how AI was used.
  - **Then an "Appendix: every decision" section** listing EVERY decision (all locked decisions above plus every non-trivial choice made during implementation: libraries, error format, status codes, id generation, validation approach, API shape/URLs, etc.). Format per decision: **Decision / Alternatives considered / Why this one**. This file is the user's sole reference for the interview, so it must be complete and match the actual code.
  - **AI section: describe the real workflow factually**: Claude Code with the GSD "quick" workflow — a multiple-choice Q&A round to lock every grey-area decision, then a planner agent writing a plan and an executor agent writing code/tests/docs, with the human reviewing and owning the result. User will edit into their own words.

### Git
- Atomic commits directly on `main`. Do not push.

### Claude's Discretion
- Exact URL design (keep RESTful and small), error response shape, id generation (e.g. `crypto.randomUUID()` or counters), file layout, TS run approach, Fastify plugin details. Every such choice must be listed in the DECISIONS.md appendix.
</decisions>

<specifics>
## Specific Ideas
- Error mapping: one domain error class with a code → status map, handled in a single Fastify error handler.
- Keep service functions synchronous so check+write can't interleave.
</specifics>

<canonical_refs>
## Canonical References
- `README.md` (current, original assignment text — becomes `ASSIGNMENT.md`)
</canonical_refs>
