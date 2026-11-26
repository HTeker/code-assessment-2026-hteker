# Parent-teacher conferences

A small backend (TypeScript, Fastify) for planning parent-teacher conference evenings. Teachers create an evening and slots are generated; parents book, move and cancel slots for their children.

The original brief is in [ASSIGNMENT.md](ASSIGNMENT.md). The choices I made, what I left out and what breaks first are in [DECISIONS.md](DECISIONS.md).

Data is kept in memory and is seeded at startup. It resets every time the server restarts.

## Run it

Requires Node.js 22.12 or newer (Vitest 5 needs it).

```bash
npm install
npm start
```

Then open http://localhost:3000/docs (Swagger UI). Click **Authorize** and enter a seeded user id, for example `parent-1` or `teacher-1`. Use `PORT=4000 npm start` to change the port.

Other commands:

```bash
npm test            # unit and API tests (Vitest)
npm run typecheck   # TypeScript check
```

With Docker:

```bash
docker build -t conferences .
docker run -p 3000:3000 conferences
```

## Logging in

There is no real login. Every request sends `Authorization: Bearer <userId>` with one of the seeded ids below.

| Id | Who | Notes |
|---|---|---|
| `teacher-1` | Ms. Jansen | class: Sam, Noor |
| `teacher-2` | Mr. de Vries | class: Lily, Milan |
| `parent-1` | Anna | parent of Sam and Lily (two different classes) |
| `parent-2` | Ben | parent of Sam (Sam has two parents) |
| `parent-3` | Carla | parent of Noor |
| `parent-4` | Daan | parent of Milan |

| Child id | Name | Teacher |
|---|---|---|
| `child-1` | Sam | `teacher-1` |
| `child-2` | Lily | `teacher-2` |
| `child-3` | Noor | `teacher-1` |
| `child-4` | Milan | `teacher-2` |

A sample evening is created at startup for `teacher-1`: `evening-1`, 14 days from today, 18:00-20:00, 15-minute slots (`slot-1` to `slot-8`), one conversation per slot.

## Try it with curl

Start the server (`npm start`), then:

```bash
# 1. Anna lists the evenings of her children's teachers
curl -s localhost:3000/evenings -H 'Authorization: Bearer parent-1'

# 2. Anna lists the free slots of evening-1
curl -s localhost:3000/evenings/evening-1/slots -H 'Authorization: Bearer parent-1'

# 3. Anna books slot-1 for Sam
curl -s -X POST localhost:3000/bookings -H 'Authorization: Bearer parent-1' -H 'content-type: application/json' \
  -d '{"slotId":"slot-1","childId":"child-1"}'

# 4. Ben (Sam's other parent) sees the booking
curl -s localhost:3000/bookings -H 'Authorization: Bearer parent-2'

# 5. Ben moves it to slot-2
curl -s -X PATCH localhost:3000/bookings/booking-1 -H 'Authorization: Bearer parent-2' -H 'content-type: application/json' \
  -d '{"slotId":"slot-2"}'

# 6. Ms. Jansen sees the overview of the evening
curl -s localhost:3000/evenings/evening-1/overview -H 'Authorization: Bearer teacher-1'

# 7. Ms. Jansen removes the empty slot-5 (a break)
curl -s -X DELETE localhost:3000/slots/slot-5 -H 'Authorization: Bearer teacher-1'

# 8. Anna cancels the booking
curl -s -X DELETE localhost:3000/bookings/booking-1 -H 'Authorization: Bearer parent-1'
```

Teachers can also create their own evening:

```bash
curl -s -X POST localhost:3000/evenings -H 'Authorization: Bearer teacher-1' -H 'content-type: application/json' \
  -d '{"date":"2027-01-20","startTime":"17:00","endTime":"19:30","slotMinutes":10,"maxBookingsPerSlot":2}'
```

## API overview

| Method and URL | Who | What |
|---|---|---|
| `GET /me` | anyone | who am I |
| `POST /evenings` | teacher | create an evening and its slots |
| `GET /evenings` | teacher, parent | teacher: own evenings; parent: evenings of their children's teachers |
| `GET /evenings/:eveningId/slots` | parent | free slots |
| `GET /evenings/:eveningId/overview` | teacher (owner) | all slots with children and parents |
| `PATCH /slots/:slotId` | teacher (owner) | change `maxBookings` |
| `DELETE /slots/:slotId` | teacher (owner) | remove a slot (not if it has bookings) |
| `POST /bookings` | parent | book a slot for a child |
| `GET /bookings` | parent | bookings of all their children |
| `PATCH /bookings/:bookingId` | parent of the child, evening's teacher | move to another slot of the same evening |
| `DELETE /bookings/:bookingId` | parent of the child, evening's teacher | cancel |

Errors always look like `{ "error": { "code": "SLOT_FULL", "message": "This slot is full" } }`. The full list of codes is in the appendix of [DECISIONS.md](DECISIONS.md).
