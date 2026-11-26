import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

// Clock is "2026-12-01 12:00". The seeded sample evening is therefore
// evening-1 on 2026-12-15, 18:00-20:00, 15 min, slot-1..slot-8, owned by teacher-1.
function setup() {
  let current = new Date("2026-12-01T12:00:00");
  const app = buildApp({ now: () => current });

  const call = (
    user: string | null,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    payload?: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      url,
      payload,
      headers: user ? { authorization: `Bearer ${user}` } : {},
    });

  const book = (user: string, slotId: string, childId: string) =>
    call(user, "POST", "/bookings", { slotId, childId });

  const setNow = (iso: string) => {
    current = new Date(iso);
  };

  return { call, book, setNow };
}

const errorCode = (res: { json: () => { error: { code: string } } }) => res.json().error.code;

describe("auth", () => {
  it("rejects a missing token with 401", async () => {
    const { call } = setup();
    const res = await call(null, "GET", "/me");
    expect(res.statusCode).toBe(401);
    expect(errorCode(res)).toBe("UNAUTHORIZED");
  });

  it("rejects an unknown user with 401", async () => {
    const { call } = setup();
    const res = await call("nobody", "GET", "/me");
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 before validation errors", async () => {
    const { call } = setup();
    const res = await call(null, "POST", "/evenings", { nonsense: true });
    expect(res.statusCode).toBe(401);
  });

  it("returns the user, with children for a parent", async () => {
    const { call } = setup();
    const res = await call("parent-1", "GET", "/me");
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Anna");
    expect(res.json().children.map((c: { name: string }) => c.name)).toEqual(["Sam", "Lily"]);
  });

  it("serves the Swagger UI without a token", async () => {
    const { call } = setup();
    const res = await call(null, "GET", "/docs/");
    expect(res.statusCode).toBe(200);
  });

  it("uses the same error shape for unknown routes", async () => {
    const { call } = setup();
    const res = await call("parent-1", "GET", "/nope");
    expect(res.statusCode).toBe(404);
    expect(errorCode(res)).toBe("NOT_FOUND");
  });
});

describe("malformed requests", () => {
  const post = (body: string, contentType?: string) =>
    buildApp({ now: () => new Date("2026-12-01T12:00:00") }).inject({
      method: "POST",
      url: "/bookings",
      body,
      headers: {
        authorization: "Bearer parent-1",
        ...(contentType ? { "content-type": contentType } : {}),
      },
    });

  it("returns 400 BAD_REQUEST for broken JSON", async () => {
    const res = await post("{not json", "application/json");
    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe("BAD_REQUEST");
  });

  // This is what curl sends when you forget -H 'content-type: application/json'.
  it("returns 415 UNSUPPORTED_MEDIA_TYPE for a form-encoded body", async () => {
    const res = await post(
      '{"slotId":"slot-1","childId":"child-1"}',
      "application/x-www-form-urlencoded",
    );
    expect(res.statusCode).toBe(415);
    expect(errorCode(res)).toBe("UNSUPPORTED_MEDIA_TYPE");
  });
});

describe("creating evenings (requirements 1 and 2)", () => {
  it("is forbidden for parents", async () => {
    const { call } = setup();
    const res = await call("parent-1", "POST", "/evenings", {
      date: "2026-12-20",
      startTime: "18:00",
      endTime: "19:00",
      slotMinutes: 15,
    });
    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe("FORBIDDEN");
  });

  it("creates slots with a default capacity of 1", async () => {
    const { call } = setup();
    const res = await call("teacher-2", "POST", "/evenings", {
      date: "2026-12-20",
      startTime: "17:00",
      endTime: "18:00",
      slotMinutes: 20,
    });
    expect(res.statusCode).toBe(201);
    const evening = res.json();
    expect(evening.teacherId).toBe("teacher-2");
    expect(evening.slots.map((s: { startTime: string }) => s.startTime)).toEqual([
      "17:00",
      "17:20",
      "17:40",
    ]);
    expect(evening.slots.every((s: { maxBookings: number }) => s.maxBookings === 1)).toBe(true);
  });

  it("uses a custom capacity and drops a leftover piece", async () => {
    const { call } = setup();
    const res = await call("teacher-2", "POST", "/evenings", {
      date: "2026-12-20",
      startTime: "18:00",
      endTime: "20:10",
      slotMinutes: 15,
      maxBookingsPerSlot: 3,
    });
    expect(res.statusCode).toBe(201);
    const { slots } = res.json();
    expect(slots).toHaveLength(8);
    expect(slots[7].endTime).toBe("20:00");
    expect(slots.every((s: { maxBookings: number }) => s.maxBookings === 3)).toBe(true);
  });

  const valid = { date: "2026-12-20", startTime: "18:00", endTime: "19:00", slotMinutes: 15 };

  it.each([
    ["end before start", { ...valid, endTime: "17:00" }, "INVALID_TIME_RANGE"],
    ["end equal to start", { ...valid, endTime: "18:00" }, "INVALID_TIME_RANGE"],
    ["slot longer than the evening", { ...valid, slotMinutes: 90 }, "INVALID_TIME_RANGE"],
    ["evening in the past", { ...valid, date: "2026-11-30" }, "EVENING_IN_PAST"],
    ["evening earlier today", { ...valid, date: "2026-12-01", startTime: "11:00" }, "EVENING_IN_PAST"],
    ["bad time format", { ...valid, startTime: "6pm" }, "VALIDATION_ERROR"],
    ["impossible time", { ...valid, startTime: "25:00" }, "VALIDATION_ERROR"],
    ["bad date format", { ...valid, date: "20-12-2026" }, "VALIDATION_ERROR"],
    ["impossible date", { ...valid, date: "2026-02-30" }, "VALIDATION_ERROR"],
    ["slot too short", { ...valid, slotMinutes: 2 }, "VALIDATION_ERROR"],
    ["capacity 0", { ...valid, maxBookingsPerSlot: 0 }, "VALIDATION_ERROR"],
    ["missing field", { date: "2026-12-20", startTime: "18:00" }, "VALIDATION_ERROR"],
  ])("rejects %s with 400", async (_name, body, code) => {
    const { call } = setup();
    const res = await call("teacher-1", "POST", "/evenings", body);
    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe(code);
  });
});

describe("listing evenings and free slots (requirement 3)", () => {
  it("shows a parent the evenings of their children's teachers", async () => {
    const { call } = setup();
    await call("teacher-2", "POST", "/evenings", {
      date: "2026-12-20",
      startTime: "17:00",
      endTime: "18:00",
      slotMinutes: 20,
    });
    const anna = await call("parent-1", "GET", "/evenings"); // children in both classes
    expect(anna.json().map((e: { id: string }) => e.id)).toEqual(["evening-1", "evening-2"]);
    const carla = await call("parent-3", "GET", "/evenings"); // only teacher-1
    expect(carla.json().map((e: { id: string }) => e.id)).toEqual(["evening-1"]);
    const teacher = await call("teacher-1", "GET", "/evenings");
    expect(teacher.json().map((e: { id: string }) => e.id)).toEqual(["evening-1"]);
  });

  it("lists only free slots", async () => {
    const { call, book } = setup();
    await book("parent-1", "slot-1", "child-1");
    const res = await call("parent-3", "GET", "/evenings/evening-1/slots");
    expect(res.statusCode).toBe(200);
    const slots = res.json();
    expect(slots).toHaveLength(7);
    expect(slots[0]).toEqual({ id: "slot-2", startTime: "18:15", endTime: "18:30", spotsLeft: 1 });
  });

  it("hides an evening from parents of another teacher", async () => {
    const { call } = setup();
    const res = await call("parent-4", "GET", "/evenings/evening-1/slots");
    expect(res.statusCode).toBe(404);
  });

  it("is forbidden for teachers", async () => {
    const { call } = setup();
    const res = await call("teacher-1", "GET", "/evenings/evening-1/slots");
    expect(res.statusCode).toBe(403);
  });
});

describe("booking (requirement 3)", () => {
  it("books a slot for the parent's own child", async () => {
    const { book } = setup();
    const res = await book("parent-1", "slot-1", "child-1");
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      id: "booking-1",
      eveningId: "evening-1",
      date: "2026-12-15",
      startTime: "18:00",
      endTime: "18:15",
      child: { id: "child-1", name: "Sam" },
      bookedBy: { id: "parent-1", name: "Anna" },
    });
  });

  it("returns 409 SLOT_FULL when the slot is taken", async () => {
    const { book } = setup();
    await book("parent-1", "slot-1", "child-1");
    const res = await book("parent-3", "slot-1", "child-3");
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe("SLOT_FULL");
  });

  it("returns 409 CHILD_ALREADY_BOOKED when the other parent books the same child", async () => {
    const { book } = setup();
    await book("parent-1", "slot-1", "child-1");
    const res = await book("parent-2", "slot-2", "child-1");
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe("CHILD_ALREADY_BOOKED");
  });

  it("returns 404 for a child that is not the parent's", async () => {
    const { book } = setup();
    const res = await book("parent-3", "slot-1", "child-1");
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 for a child of another teacher", async () => {
    const { book } = setup();
    const res = await book("parent-1", "slot-1", "child-2");
    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe("FORBIDDEN");
  });

  it("returns 404 for an evening the parent cannot see", async () => {
    const { book } = setup();
    const res = await book("parent-4", "slot-1", "child-4");
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for an unknown slot", async () => {
    const { book } = setup();
    const res = await book("parent-1", "slot-99", "child-1");
    expect(res.statusCode).toBe(404);
  });

  it("is forbidden for teachers", async () => {
    const { book } = setup();
    const res = await book("teacher-1", "slot-1", "child-1");
    expect(res.statusCode).toBe(403);
  });

  it("allows several bookings when the capacity is raised", async () => {
    const { call, book } = setup();
    await book("parent-1", "slot-1", "child-1");
    await call("teacher-1", "PATCH", "/slots/slot-1", { maxBookings: 2 });
    const res = await book("parent-3", "slot-1", "child-3");
    expect(res.statusCode).toBe(201);
  });

  it("lets only one of two parallel requests take the last spot", async () => {
    const { book } = setup();
    const [a, b] = await Promise.all([
      book("parent-1", "slot-1", "child-1"),
      book("parent-3", "slot-1", "child-3"),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
  });
});

describe("seeing bookings (requirement 5)", () => {
  it("shows a booking to every parent of the child", async () => {
    const { call, book } = setup();
    await book("parent-1", "slot-1", "child-1");
    const ben = await call("parent-2", "GET", "/bookings");
    expect(ben.statusCode).toBe(200);
    expect(ben.json()).toHaveLength(1);
    expect(ben.json()[0].bookedBy.name).toBe("Anna");
    expect(ben.json()[0].child.name).toBe("Sam");
  });

  it("does not show the booking to other parents", async () => {
    const { call, book } = setup();
    await book("parent-1", "slot-1", "child-1");
    const carla = await call("parent-3", "GET", "/bookings");
    expect(carla.json()).toEqual([]);
  });

  it("is sorted by time across all children", async () => {
    const { call, book } = setup();
    await call("teacher-2", "POST", "/evenings", {
      date: "2026-12-10",
      startTime: "17:00",
      endTime: "18:00",
      slotMinutes: 20,
    });
    await book("parent-1", "slot-2", "child-1"); // 2026-12-15 18:15
    await book("parent-1", "slot-9", "child-2"); // 2026-12-10 17:00
    const res = await call("parent-1", "GET", "/bookings");
    expect(res.json().map((b: { child: { name: string } }) => b.child.name)).toEqual([
      "Lily",
      "Sam",
    ]);
  });
});

describe("moving and cancelling (requirement 4)", () => {
  it("lets the other parent of the child move a booking", async () => {
    const { call, book } = setup();
    await book("parent-1", "slot-1", "child-1");
    const res = await call("parent-2", "PATCH", "/bookings/booking-1", { slotId: "slot-2" });
    expect(res.statusCode).toBe(200);
    expect(res.json().startTime).toBe("18:15");
    expect(res.json().bookedBy.name).toBe("Anna");
    const free = await call("parent-3", "GET", "/evenings/evening-1/slots");
    expect(free.json().map((s: { id: string }) => s.id)).toContain("slot-1");
    expect(free.json().map((s: { id: string }) => s.id)).not.toContain("slot-2");
  });

  it("treats a move to the same slot as a no-op", async () => {
    const { call, book } = setup();
    await book("parent-1", "slot-1", "child-1");
    const res = await call("parent-1", "PATCH", "/bookings/booking-1", { slotId: "slot-1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().startTime).toBe("18:00");
  });

  it("returns 409 when the target slot is full", async () => {
    const { call, book } = setup();
    await book("parent-1", "slot-1", "child-1");
    await book("parent-3", "slot-2", "child-3");
    const res = await call("parent-1", "PATCH", "/bookings/booking-1", { slotId: "slot-2" });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe("SLOT_FULL");
  });

  it("returns 400 when the target slot is in another evening", async () => {
    const { call, book } = setup();
    const other = await call("teacher-1", "POST", "/evenings", {
      date: "2026-12-20",
      startTime: "18:00",
      endTime: "19:00",
      slotMinutes: 15,
    });
    const otherSlotId = other.json().slots[0].id;
    await book("parent-1", "slot-1", "child-1");
    const res = await call("parent-1", "PATCH", "/bookings/booking-1", { slotId: otherSlotId });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe("INVALID_MOVE");
  });

  it("returns 404 when the target slot does not exist", async () => {
    const { call, book } = setup();
    await book("parent-1", "slot-1", "child-1");
    const res = await call("parent-1", "PATCH", "/bookings/booking-1", { slotId: "slot-99" });
    expect(res.statusCode).toBe(404);
  });

  it("lets a parent cancel, which frees the slot", async () => {
    const { call, book } = setup();
    await book("parent-1", "slot-1", "child-1");
    const res = await call("parent-2", "DELETE", "/bookings/booking-1");
    expect(res.statusCode).toBe(204);
    expect((await call("parent-1", "GET", "/bookings")).json()).toEqual([]);
    const again = await book("parent-3", "slot-1", "child-3");
    expect(again.statusCode).toBe(201);
  });

  it("hides a booking from parents of other children", async () => {
    const { call, book } = setup();
    await book("parent-1", "slot-1", "child-1");
    const move = await call("parent-3", "PATCH", "/bookings/booking-1", { slotId: "slot-2" });
    const cancel = await call("parent-3", "DELETE", "/bookings/booking-1");
    expect(move.statusCode).toBe(404);
    expect(cancel.statusCode).toBe(404);
  });

  it("lets the evening's teacher move and cancel", async () => {
    const { call, book } = setup();
    await book("parent-1", "slot-1", "child-1");
    const move = await call("teacher-1", "PATCH", "/bookings/booking-1", { slotId: "slot-3" });
    expect(move.statusCode).toBe(200);
    expect(move.json().startTime).toBe("18:30");
    const cancel = await call("teacher-1", "DELETE", "/bookings/booking-1");
    expect(cancel.statusCode).toBe(204);
  });

  it("does not let another teacher touch the booking", async () => {
    const { call, book } = setup();
    await book("parent-1", "slot-1", "child-1");
    const res = await call("teacher-2", "DELETE", "/bookings/booking-1");
    expect(res.statusCode).toBe(404);
  });
});

describe("teacher overview (requirement 6)", () => {
  it("lists every slot in time order with child and parent", async () => {
    const { call, book } = setup();
    await book("parent-2", "slot-3", "child-1");
    await book("parent-3", "slot-1", "child-3");
    const res = await call("teacher-1", "GET", "/evenings/evening-1/overview");
    expect(res.statusCode).toBe(200);
    const { evening, slots } = res.json();
    expect(evening.id).toBe("evening-1");
    expect(slots).toHaveLength(8);
    const times = slots.map((s: { startTime: string }) => s.startTime);
    expect(times).toEqual([...times].sort());
    expect(slots[0]).toMatchObject({
      id: "slot-1",
      maxBookings: 1,
      spotsLeft: 0,
      bookings: [
        {
          id: "booking-2",
          child: { id: "child-3", name: "Noor" },
          bookedBy: { id: "parent-3", name: "Carla" },
        },
      ],
    });
    expect(slots[1]).toMatchObject({ id: "slot-2", spotsLeft: 1, bookings: [] });
    expect(slots[2].bookings[0]).toMatchObject({
      child: { name: "Sam" },
      bookedBy: { name: "Ben" },
    });
  });

  it("returns 404 for a teacher who does not own the evening", async () => {
    const { call } = setup();
    const res = await call("teacher-2", "GET", "/evenings/evening-1/overview");
    expect(res.statusCode).toBe(404);
  });

  it("is forbidden for parents", async () => {
    const { call } = setup();
    const res = await call("parent-1", "GET", "/evenings/evening-1/overview");
    expect(res.statusCode).toBe(403);
  });
});

describe("slot capacity and removal (requirements 2 and 7)", () => {
  it("returns 409 when capacity goes below the current bookings", async () => {
    const { call, book } = setup();
    await call("teacher-1", "PATCH", "/slots/slot-1", { maxBookings: 2 });
    await book("parent-1", "slot-1", "child-1");
    await book("parent-3", "slot-1", "child-3");
    const res = await call("teacher-1", "PATCH", "/slots/slot-1", { maxBookings: 1 });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe("CAPACITY_BELOW_BOOKINGS");
  });

  it("rejects a capacity outside 1..50", async () => {
    const { call } = setup();
    const res = await call("teacher-1", "PATCH", "/slots/slot-1", { maxBookings: 0 });
    expect(res.statusCode).toBe(400);
  });

  it("hides slots from other teachers", async () => {
    const { call } = setup();
    const patch = await call("teacher-2", "PATCH", "/slots/slot-1", { maxBookings: 2 });
    const del = await call("teacher-2", "DELETE", "/slots/slot-1");
    expect(patch.statusCode).toBe(404);
    expect(del.statusCode).toBe(404);
  });

  it("removes an empty slot", async () => {
    const { call } = setup();
    const res = await call("teacher-1", "DELETE", "/slots/slot-5");
    expect(res.statusCode).toBe(204);
    const free = await call("parent-1", "GET", "/evenings/evening-1/slots");
    expect(free.json().map((s: { id: string }) => s.id)).not.toContain("slot-5");
    const overview = await call("teacher-1", "GET", "/evenings/evening-1/overview");
    expect(overview.json().slots).toHaveLength(7);
  });

  it("returns 409 when the slot has bookings", async () => {
    const { call, book } = setup();
    await book("parent-1", "slot-1", "child-1");
    const res = await call("teacher-1", "DELETE", "/slots/slot-1");
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe("SLOT_HAS_BOOKINGS");
  });

  it("allows removing the slot after the booking is moved", async () => {
    const { call, book } = setup();
    await book("parent-1", "slot-1", "child-1");
    await call("parent-1", "PATCH", "/bookings/booking-1", { slotId: "slot-2" });
    const res = await call("teacher-1", "DELETE", "/slots/slot-1");
    expect(res.statusCode).toBe(204);
  });
});

describe("cutoff once the evening has started", () => {
  it("rejects book, move, cancel, capacity change and slot removal with 409", async () => {
    const { call, book, setNow } = setup();
    await book("parent-1", "slot-1", "child-1");

    setNow("2026-12-15T18:00:00"); // exactly the start time

    const results = await Promise.all([
      book("parent-3", "slot-2", "child-3"),
      call("parent-1", "PATCH", "/bookings/booking-1", { slotId: "slot-2" }),
      call("parent-1", "DELETE", "/bookings/booking-1"),
      call("teacher-1", "PATCH", "/bookings/booking-1", { slotId: "slot-2" }),
      call("teacher-1", "DELETE", "/bookings/booking-1"),
      call("teacher-1", "PATCH", "/slots/slot-2", { maxBookings: 2 }),
      call("teacher-1", "DELETE", "/slots/slot-2"),
    ]);
    for (const res of results) {
      expect(res.statusCode).toBe(409);
      expect(errorCode(res)).toBe("EVENING_STARTED");
    }
  });

  it("still allows booking one minute before the start", async () => {
    const { book, setNow } = setup();
    setNow("2026-12-15T17:59:00");
    const res = await book("parent-1", "slot-1", "child-1");
    expect(res.statusCode).toBe(201);
  });
});
