# DECISIONS

The first part is the two-page answer the assignment asks for. The appendix after it lists every single decision, with the other options I looked at, so I can explain any line of the code.

# Part 1: The short version

## The big choices and why

**Stack.** TypeScript on Node.js, with the Fastify web framework. Fastify checks every request body with JSON Schema, so I did not need another validation library. The same schemas feed the OpenAPI docs (Swagger UI at `/docs`). Tests use Vitest. I run the TypeScript with `tsx`, so there is no build step: `npm install && npm start`.

**Storage.** Everything lives in memory (plain Maps). It is the simplest thing that works for a four-hour assignment, and the data is reset on every restart. Some sample users and one sample evening are created at startup.

**Why in-memory is still safe for double booking.** The service code has no `await` in it. Node runs one piece of JavaScript at a time (the event loop). So "is there room?" and "save the booking" run together, and two parents cannot both take the last spot. This only holds for one process. That is the first thing to fix when we scale (see below).

**Login.** The brief says no real login. A request sends `Authorization: Bearer parent-1`. The id is looked up in the seed data and tells us the role and, for a parent, the children. Missing or unknown id gives 401. Wrong role gives 403.

**Who can do what.**
- One evening belongs to exactly one teacher.
- A parent books only for their own child, and only on an evening of that child's teacher.
- A child has at most one booking per evening. A second try gives 409 Conflict. The parent should move the booking instead.
- Any parent of the child, and the evening's teacher, can move or cancel a booking. Every parent of the child sees it in `GET /bookings`.
- Things you may not see look like "not found" (404), so we do not leak that they exist.

**Slots.** The teacher sends date, start, end and slot length. Slots are built back to back. A leftover piece that is too short is dropped (18:00 to 20:10 with 15 minutes ends at 20:00). Each slot allows 1 conversation by default. The teacher can set a higher number for the evening, or change one slot later with `PATCH /slots/:slotId`. Lowering it below the current bookings gives 409.

**Removing a slot.** The teacher can delete a slot for a break. If it already has bookings, we answer 409 and the parents must move first. I did not cancel bookings automatically, because nobody would be told.

**Time.** Times are plain school-local strings (`2026-12-15`, `18:00`). No timezones. Once an evening has started, nobody can book, move, cancel or change slots (409 `EVENING_STARTED`). The clock is injected, so tests can fake time.

**Structure.** Routes, then service, then store. Routes only handle HTTP. The service has all the rules and knows nothing about HTTP. It throws one error type with a code, and one error handler turns it into JSON like `{ "error": { "code": "SLOT_FULL", "message": "..." } }`.

## What I left out on purpose

- A UI (an API was enough).
- Real login, users, passwords and managing teachers, parents and children.
- A database and any storage that survives a restart.
- Emails or other messages (for example when a teacher removes a slot).
- Timezones, and schools in different regions.
- More than one teacher per evening.
- Editing or deleting a whole evening. Moving a booking to a different evening.
- Waiting lists, reminders, and a calendar export.
- Pagination, rate limiting and metrics.
- Response schemas in OpenAPI (requests are validated, responses are not described).
- Translations.

## What breaks first at 100 schools tomorrow

1. **Data is lost on restart or deploy.** All state is in process memory. Fix: a real database (for example Postgres) with the same service rules.
2. **We cannot run more than one copy.** Each copy has its own memory, and my double-booking guarantee only works inside one process. Two copies would allow double bookings. Fix: a shared database with transactions, then scale out.
3. **Fake login.** Anyone can send `Bearer teacher-1` and be that teacher. Fix: real authentication (for example OIDC / school SSO or JWT) and real users from the school system.
4. **The rush at the start.** Parents all open the booking at the same moment. One process on one machine will be slow. Fix: a database, several copies behind a load balancer, caching for the free-slot list, and rate limiting.
5. **No timezones.** Fine for one school. For schools in other regions "now" and "started" are wrong. Fix: store a time zone per school and compare in UTC.
6. **No notifications.** If a teacher removes or changes a slot, parents are not told. Fix: send emails or push messages for bookings, moves and cancellations.
7. **No audit log and no monitoring.** We cannot see who changed what, or whether the service is healthy. Fix: an audit table, structured logs, metrics and alerts.
8. **Ids are simple counters (`slot-1`).** They collide across copies and are easy to guess. Fix: UUIDs or database ids.

## How I used AI

I used Claude Code, with the GSD "quick" workflow, as a pair that does the typing while I make the decisions:

1. The AI asked me a long list of multiple-choice questions (about 20) until every grey area in the brief was decided. Those answers are saved as locked decisions.
2. The decisions were turned into one written plan: the exact API, error codes, file layout and seed data.
3. An executor agent wrote the code, the tests and the docs in small, separate commits.
4. The main session then checked the work: ran the tests and the type check, read the code, and compared this file to the code. That review caught one real bug: `engines` said Node 20, but Vitest 5 needs Node 22.12.
5. I read the result, ran it, and I own every line. I can explain all of it.

The planning files are committed in `.planning/`, so you can see the process.

# Appendix: every decision

Format: what I decided, what else I could have done, and why I picked this.

## Stack & tooling

### 1. TypeScript on Node.js
- **Decision:** TypeScript with strict settings, on Node.js (needs Node 22.12 or newer, because Vitest 5 needs it; `engines` says so).
- **Alternatives:** A, Kotlin. B, plain JavaScript.
- **Why:** TypeScript was allowed and is quick to write. Types catch mistakes in the rules. Strict mode and `noUncheckedIndexedAccess` stop silent `undefined` bugs.

### 2. Fastify
- **Decision:** Fastify 5 as the web framework.
- **Alternatives:** A, Express. B, NestJS. C, Hono.
- **Why:** Request validation with JSON Schema and OpenAPI support come built in or as small plugins. NestJS is too big for four hours and brings dependency injection I would have to explain. Express has no built-in validation.

### 3. JSON Schema for request validation
- **Decision:** Each route has a JSON Schema for its body and params. Fastify checks it before my code runs.
- **Alternatives:** A, zod. B, hand-written checks.
- **Why:** No extra library. The same schema is used for the Swagger docs. Two side effects to know: extra unknown fields in a body are silently dropped (not rejected), and numbers sent as strings like `"15"` are converted to numbers (Fastify default).

### 4. OpenAPI docs at /docs
- **Decision:** `@fastify/swagger` and `@fastify/swagger-ui`. Every route has a tag and a summary. A global Bearer scheme gives an Authorize button.
- **Alternatives:** A, only the README. B, a Postman collection.
- **Why:** Reviewers can try the API in the browser. It was one of the "extras" I chose.

### 5. npm
- **Decision:** npm with a committed `package-lock.json`.
- **Alternatives:** pnpm, yarn.
- **Why:** Everyone has npm. Nothing to install first.

### 6. tsx to run the code, no build step
- **Decision:** `npm start` runs `tsx src/server.ts`. `npm run typecheck` runs `tsc --noEmit`.
- **Alternatives:** A, compile with `tsc` and run `node dist`. B, Node's built-in type stripping.
- **Why:** The simplest thing that always works. No `dist` folder, no stale builds. Built-in type stripping only works without a flag on newer Node versions, and it has extra rules about imports. tsx just works. For a real deployment I would compile to JavaScript.

### 7. Vitest
- **Decision:** Vitest for unit and API tests.
- **Alternatives:** Jest, `node:test`.
- **Why:** Runs TypeScript with no setup, is fast, and has a Jest-like API that is easy to read.

### 8. NodeNext modules
- **Decision:** `"type": "module"`, `module: NodeNext`, imports end in `.js`.
- **Alternatives:** CommonJS, or a bundler-style setup.
- **Why:** This is the standard modern Node setup. The `.js` ending looks odd but is what Node requires.

### 9. Port and host
- **Decision:** Port from the `PORT` variable, default 3000. Host `0.0.0.0`.
- **Alternatives:** Fixed port, or `localhost` only.
- **Why:** `0.0.0.0` is needed so Docker can reach the server.

### 10. Few dependencies
- **Decision:** Only Fastify and its two Swagger plugins at runtime. No ORM, no lodash, no date library, no dependency injection.
- **Alternatives:** Day.js or date-fns for time, a validation library.
- **Why:** Less to explain and less to break. The time rules need only a few small functions.

## Data & storage

### 11. In-memory storage
- **Decision:** Plain `Map` objects in `store.ts`. Data resets on restart.
- **Alternatives:** A, SQLite. B, Postgres. C, a JSON file.
- **Why:** The brief allows it. It is the fastest to build and to run for reviewers (no setup). The cost: no persistence and one process only. Listed in Part 1.

### 12. Seed data at startup
- **Decision:** 2 teachers, 4 parents, 4 children with fixed ids, plus one sample evening.
- **Alternatives:** Empty store with admin endpoints; a seed file.
- **Why:** The brief says fixed examples are enough. Readable ids make curl demos easy.
- **Seed:** `teacher-1` Ms. Jansen, `teacher-2` Mr. de Vries. `parent-1` Anna (Sam and Lily), `parent-2` Ben (Sam), `parent-3` Carla (Noor), `parent-4` Daan (Milan). `child-1` Sam and `child-3` Noor are in `teacher-1`'s class. `child-2` Lily and `child-4` Milan are in `teacher-2`'s class. Sam has two parents. Anna has children in two classes.

### 13. Counter ids
- **Decision:** `evening-1`, `slot-1`, `booking-1`, counted per type.
- **Alternatives:** `crypto.randomUUID()`.
- **Why:** Easy to type in curl and to read in tests. Not safe across several copies of the service (listed in Part 1).

### 14. Routes, service, store
- **Decision:** Routes only deal with HTTP. `service.ts` has all rules and no HTTP knowledge. `store.ts` only holds data.
- **Alternatives:** Put the logic in the route handlers; classes with repositories.
- **Why:** Easy to test and to reason about. Rules sit in one file.

### 15. Functions, not classes
- **Decision:** `createService(store, now)` returns plain functions. The only class is `AppError`.
- **Alternatives:** A `ConferenceService` class, dependency injection.
- **Why:** Less ceremony. Dependencies are passed as arguments.

### 16. Synchronous service for atomic booking
- **Decision:** No `async` or `await` in the service. A comment in `service.ts` explains it.
- **Alternatives:** A lock or mutex; a database transaction.
- **Why:** In one Node process, synchronous code cannot be interrupted. So the check and the write cannot interleave. This is the double-booking protection.

### 17. What a booking stores
- **Decision:** `{ id, slotId, childId, bookedByParentId }`. The evening and time are looked up through the slot.
- **Alternatives:** Store the evening id and times on the booking too.
- **Why:** One source of truth. A move only changes `slotId`.

### 18. Seed through the service
- **Decision:** The sample evening is created with `createEvening`, the same code the API uses.
- **Alternatives:** Write slots directly into the store.
- **Why:** Seed data must follow the same rules, so it cannot drift from them.

## Identity & access

### 19. Fake Bearer token
- **Decision:** `Authorization: Bearer <userId>`. The id must be a seeded teacher or parent, else 401 `UNAUTHORIZED`.
- **Alternatives:** An `X-User-Id` header, a signed JWT, query parameters.
- **Why:** Follows the brief ("assume every request tells you who the user is"). A Bearer header works with the Swagger Authorize button and looks like real auth.

### 20. Login check runs first
- **Decision:** An `onRequest` hook finds the user before body validation. The routes live in their own Fastify scope, so `/docs` stays public.
- **Alternatives:** Look up the user inside each handler.
- **Why:** Otherwise a caller who is not logged in would get 400 validation errors before 401. The test "returns 401 before validation errors" covers it.

### 21. Wrong role is 403
- **Decision:** A parent calling a teacher endpoint (or the other way) gets 403 `FORBIDDEN`.
- **Alternatives:** 404 for everything.
- **Why:** The caller is known, but not allowed. A clear 403 helps them.

### 22. Not allowed to see it is 404
- **Decision:** Evenings, slots and bookings that belong to someone else answer 404 `NOT_FOUND`, never 403.
- **Alternatives:** 403 for all of them.
- **Why:** With 403 we would confirm that the id exists. 404 leaks nothing.

### 23. One evening, one teacher
- **Decision:** An evening belongs to the teacher who created it.
- **Alternatives:** Several teachers per evening.
- **Why:** Simple and matches the brief. A class has one teacher in the seed.

### 24. Which parent sees which evening
- **Decision:** A parent sees an evening only if one of their children has that evening's teacher. Otherwise 404.
- **Alternatives:** Show all evenings to everyone.
- **Why:** Parents should not see other classes.

### 25. Booking for a child
- **Decision:** A parent books only for their own child: a child that is not theirs gives 404 `NOT_FOUND`. If the child is theirs but in another teacher's class, the answer is 403 `FORBIDDEN` ("This child is not in this teacher's class").
- **Alternatives:** 404 for both, or 409.
- **Why:** The parent knows their own child, so telling them the child is in the wrong class leaks nothing and is more helpful.

### 26. Who can move or cancel
- **Decision:** Any parent of the child, and the teacher who owns the evening. Others get 404.
- **Alternatives:** Only the parent who booked it; parents only.
- **Why:** The brief says a child can have more than one parent and every parent sees the booking. A teacher needs to fix mistakes (for example a sick teacher or a break).

## Evenings & slots

### 27. Evening input and limits
- **Decision:** `POST /evenings` takes `date` (`YYYY-MM-DD`), `startTime`, `endTime` (`HH:mm`, 24 hours), `slotMinutes` (whole number 5 to 240) and optional `maxBookingsPerSlot` (whole number 1 to 50, default 1).
- **Alternatives:** ISO date-time strings; no limits.
- **Why:** Plain strings match the time model. Limits stop silly values (a 1-minute or 3-day slot, 10000 people per slot).

### 28. Leftover time is dropped
- **Decision:** Slots run back to back from the start. A last piece shorter than a full slot is not created.
- **Alternatives:** Make a short last slot; reject evenings that do not divide evenly.
- **Why:** Every slot has the same length, as a teacher would expect. Rejecting would be annoying.

### 29. Where each check lives
- **Decision:** JSON Schema checks shape and bounds. The service checks real meaning: a real calendar date (2026-02-30 gives 400 `VALIDATION_ERROR`), end after start and at least one slot fits (400 `INVALID_TIME_RANGE`), and not in the past (400 `EVENING_IN_PAST`).
- **Alternatives:** Everything in the schema; everything in the service.
- **Why:** Schemas cannot know calendars or the clock. The service can, and it stays testable without HTTP.

### 30. No evenings in the past
- **Decision:** Creating an evening that has already started is rejected (it uses the same "started" rule as the cutoff).
- **Alternatives:** Allow it.
- **Why:** Nobody can book it anyway.

### 31. Capacity per evening, editable per slot
- **Decision:** `maxBookingsPerSlot` is copied to every slot. `PATCH /slots/:slotId` with `{ "maxBookings": n }` (1 to 50) changes one slot.
- **Alternatives:** Capacity only per evening; capacity stored only on the evening.
- **Why:** The brief says "a slot has a maximum". Per-slot editing is a small extra that handles a "double slot" case.

### 32. Lower capacity than bookings
- **Decision:** 409 `CAPACITY_BELOW_BOOKINGS`.
- **Alternatives:** Silently cancel the extra bookings.
- **Why:** Never remove a booking without the parent knowing.

### 33. Removing slots
- **Decision:** `DELETE /slots/:slotId` answers 204. A slot with bookings gives 409 `SLOT_HAS_BOOKINGS`. A removed slot is gone for good.
- **Alternatives:** Cancel the bookings automatically; mark the slot as blocked.
- **Why:** The parents must move first, because we have no notifications. "Gone" is the simplest thing that meets the brief (a break).

### 34. No edit or delete of a whole evening
- **Decision:** Not supported.
- **Alternatives:** `PATCH` and `DELETE /evenings/:id`.
- **Why:** Not asked for. Changing times would need a clear rule for existing bookings.

### 35. Overview shows empty slots too
- **Decision:** `GET /evenings/:eveningId/overview` lists every slot in time order with `maxBookings`, `spotsLeft` and its bookings (child, and the parent who booked).
- **Alternatives:** Only booked slots.
- **Why:** The teacher sees the whole evening, including the free gaps.

### 36. Parents only see free slots
- **Decision:** `GET /evenings/:eveningId/slots` returns slots with `spotsLeft > 0`, as `{ id, startTime, endTime, spotsLeft }`. It does not hide slots of an evening that already started (booking then fails with 409).
- **Alternatives:** Return all slots with a "full" flag.
- **Why:** The brief says "sees the free time slots". Keeping started evenings visible is the simplest rule.

### 37. Evening list
- **Decision:** `GET /evenings` returns evenings without slots, sorted by date and start time. For a teacher: their own. For a parent: evenings of their children's teachers.
- **Alternatives:** Include slots; filter out past evenings.
- **Why:** A parent needs the id first. Slots have their own endpoint.

## Bookings

### 38. One booking per child per evening
- **Decision:** A second booking for the same child on the same evening gives 409 `CHILD_ALREADY_BOOKED`, even from the other parent.
- **Alternatives:** Allow several; replace the old one automatically.
- **Why:** Stops both parents booking the same child twice. The parent should move the booking.

### 39. Order of checks when booking
- **Decision:** Role (403), then slot not visible (404), child not theirs (404), child in other class (403), evening started (409), child already booked (409), slot full (409).
- **Alternatives:** Other orders.
- **Why:** Permission problems first, then time, then capacity. The error always names the real problem.

### 40. Moving a booking
- **Decision:** `PATCH /bookings/:bookingId` with `{ "slotId": ... }`. The target must be in the same evening, else 400 `INVALID_MOVE`. An unknown slot is 404. A full target is 409 `SLOT_FULL`.
- **Alternatives:** Allow moves between evenings; cancel and book again.
- **Why:** Moving between evenings is a different request (and maybe a different teacher). Same evening keeps rules simple.

### 41. Move to the same slot
- **Decision:** Returns 200 with the unchanged booking.
- **Alternatives:** 409 or 400.
- **Why:** Doing nothing is harmless. It is also safe when a request is repeated.

### 42. Who is "booked by"
- **Decision:** `bookedBy` is the parent who made the booking. A move or a teacher change does not change it.
- **Alternatives:** Track who moved it last.
- **Why:** Simple. The overview shows who made the appointment.

### 43. Booking view
- **Decision:** `{ id, eveningId, date, startTime, endTime, child: { id, name }, bookedBy: { id, name } }`.
- **Alternatives:** Return only ids.
- **Why:** The client can show the booking without more calls.

### 44. Parents see all their children's bookings
- **Decision:** `GET /bookings` returns the bookings of all the parent's children, including ones the other parent made. Sorted by date and start time.
- **Alternatives:** Only the bookings I made.
- **Why:** The brief says every parent of the child sees the appointment.

## Time

### 45. Local strings, no timezones
- **Decision:** Dates are `YYYY-MM-DD`, times `HH:mm`, in the school's local time.
- **Alternatives:** UTC timestamps with a school timezone.
- **Why:** A conference is "18:00 at school". Timezones are a real risk later (Part 1) but would add a lot of code now.

### 46. Cutoff at the start, for everyone
- **Decision:** When `date + startTime` is now or earlier, book, move, cancel, `PATCH` slot and `DELETE` slot all answer 409 `EVENING_STARTED`. Teachers are included.
- **Alternatives:** Allow teachers to change things during the evening; a cutoff hours before.
- **Why:** One rule is easy to explain. A moving appointment during the evening causes confusion.

### 47. String comparison for time
- **Decision:** Compare `"YYYY-MM-DD HH:mm"` strings directly.
- **Alternatives:** `Date` objects.
- **Why:** The format has a fixed width, so text order equals time order. It avoids timezone surprises in `Date` parsing.

### 48. Injectable clock
- **Decision:** `buildApp({ now })` and `createService(store, now)`. The default is the real time.
- **Alternatives:** Mock timers; call `new Date()` everywhere.
- **Why:** Tests can set the time (for example "exactly at the start") with no tricks.

### 49. Sample evening 14 days ahead
- **Decision:** The seed creates `evening-1` for `teacher-1` 14 days from today, 18:00 to 20:00, 15 minutes, one per slot. That gives `slot-1` to `slot-8`.
- **Alternatives:** A fixed date.
- **Why:** A fixed date would be in the past one day. Reviewers can book right away.

## API & errors

### 50. URL design
- **Decision:** `GET /me`, `POST /evenings`, `GET /evenings`, `GET /evenings/:eveningId/slots`, `GET /evenings/:eveningId/overview`, `PATCH /slots/:slotId`, `DELETE /slots/:slotId`, `POST /bookings`, `GET /bookings`, `PATCH /bookings/:bookingId`, `DELETE /bookings/:bookingId`.
- **Alternatives:** Nested `/evenings/:id/bookings`; `POST /bookings/:id/move`.
- **Why:** Small and REST-like. Bookings and slots have their own ids, so they do not need to be nested. Move is a `PATCH` of `slotId`.

### 51. Success status codes
- **Decision:** 201 for creating (evening, booking), 200 for reads and updates, 204 with no body for deletes.
- **Alternatives:** 200 everywhere.
- **Why:** Standard HTTP meaning.

### 52. One error shape and code list
- **Decision:** `{ "error": { "code", "message" } }`. A single error handler. Codes: `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `INVALID_TIME_RANGE` 400, `EVENING_IN_PAST` 400, `INVALID_MOVE` 400, `EVENING_STARTED` 409, `SLOT_FULL` 409, `CHILD_ALREADY_BOOKED` 409, `SLOT_HAS_BOOKINGS` 409, `CAPACITY_BELOW_BOOKINGS` 409. Also `BAD_REQUEST` 400 (for example broken JSON), `UNSUPPORTED_MEDIA_TYPE` 415 (a body sent without `content-type: application/json`) and `INTERNAL_ERROR` 500.
- **Alternatives:** Plain messages; RFC 7807 problem+json.
- **Why:** A stable code is easy for a client to switch on. The message is for humans.

### 53. Other errors
- **Decision:** An unknown route is 404 `NOT_FOUND` in the same shape. A surprise error is logged and answers 500 with a generic message, with no details.
- **Alternatives:** Fastify's default error JSON.
- **Why:** The API always looks the same, and no internals leak.

### 54. 409 for rule conflicts
- **Decision:** Full slot, double booking, started evening, slot with bookings and low capacity all use 409 Conflict.
- **Alternatives:** 400 or 422.
- **Why:** The request is well-formed but conflicts with the current state.

### 55. No response schemas
- **Decision:** Only requests have schemas. Responses are plain objects.
- **Alternatives:** Describe responses for the docs and faster output.
- **Why:** Keeps the routes short. A real project should add them.

## Testing

### 56. Unit tests plus API tests
- **Decision:** `test/slots.test.ts` (7 tests) for slot generation and time helpers. `test/api.test.ts` (58 tests) call the real routes with `app.inject()`, with no network.
- **Alternatives:** Only unit tests; tests with a real HTTP port.
- **Why:** API tests cover the real behavior (status codes, rules, who can see what) fast.

### 57. Fresh app per test, fake clock
- **Decision:** Each test builds its own app with its own store and a clock set to 2026-12-01 12:00.
- **Alternatives:** A shared app.
- **Why:** Tests cannot affect each other.

### 58. The double-booking test
- **Decision:** One test sends two parallel bookings for one slot and expects one 201 and one 409.
- **Alternatives:** None.
- **Why:** Honest note: it is a smoke test. The real guarantee is the synchronous service code (decision 16).

## Delivery & docs

### 59. Dockerfile
- **Decision:** `node:24-alpine`, `npm ci` (with dev dependencies, because `tsx` is one), copy `src`, `npm start`. A `.dockerignore` keeps `node_modules`, tests, docs and `.git` out.
- **Alternatives:** A multi-stage build that compiles to JavaScript and installs only production dependencies.
- **Why:** The simplest image that works. The cost is a bigger image. A real deployment should compile first.

### 60. README and ASSIGNMENT.md
- **Decision:** The original brief was moved to `ASSIGNMENT.md` with `git mv`, unchanged. The new `README.md` has the run steps, the seed users, and a curl walkthrough.
- **Alternatives:** Keep the brief in the README.
- **Why:** The brief asks for a README that explains how to start and try it out.

### 61. Planning files are committed
- **Decision:** `.planning/` stays in the repository.
- **Alternatives:** Git-ignore it.
- **Why:** Reviewers can see how the AI workflow ran (questions, locked decisions, plan).

### 62. Commits straight on main
- **Decision:** Small commits on `main`, no pull requests, nothing pushed by the AI.
- **Alternatives:** A feature branch.
- **Why:** A solo assignment. Small commits still show the steps.

### 63. Length of this file
- **Decision:** Part 1 is the two-page answer the brief asks for. The appendix is extra, for the interview.
- **Alternatives:** Cut the appendix.
- **Why:** The brief says no more than two pages, so the core stays short. The appendix lets me defend each choice.
