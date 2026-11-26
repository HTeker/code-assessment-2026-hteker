# DECISIONS

This file is the two-page answer the assignment asks for. Every single decision, with the other options I looked at, is in [DECISIONS_APPENDIX.md](DECISIONS_APPENDIX.md), so I can explain any line of the code.

# The short version

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
5. I read the result, ran it, and I own every line.

The planning files are committed in `.planning/`, so you can see the process.

## More detail

Every decision, with the alternatives I considered and why I picked each one, is in [DECISIONS_APPENDIX.md](DECISIONS_APPENDIX.md).
