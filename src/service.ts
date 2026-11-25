import type { Booking, Child, Evening, Parent, Slot, Teacher, User } from "./domain.js";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";
import { generateSlotTimes } from "./slots.js";
import type { Store } from "./store.js";
import { isValidDate, localNow, toMinutes } from "./time.js";

export interface CreateEveningInput {
  date: string;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  maxBookingsPerSlot?: number;
}

export interface BookingView {
  id: string;
  eveningId: string;
  date: string;
  startTime: string;
  endTime: string;
  child: { id: string; name: string };
  bookedBy: { id: string; name: string };
}

// All business rules live here. The functions are deliberately SYNCHRONOUS (no
// async/await): Node runs one piece of JavaScript at a time, so a function that
// checks and then writes finishes completely before the next request starts.
// That is what stops two parents from taking the same last spot.
export function createService(store: Store, now: () => Date) {
  // ---- small helpers ----

  function requireTeacher(user: User): Teacher {
    if (user.role !== "teacher") throw forbidden("Only teachers can do this");
    return user;
  }

  function requireParent(user: User): Parent {
    if (user.role !== "parent") throw forbidden("Only parents can do this");
    return user;
  }

  function hasStarted(evening: Evening): boolean {
    return `${evening.date} ${evening.startTime}` <= localNow(now());
  }

  function assertNotStarted(evening: Evening): void {
    if (hasStarted(evening)) throw conflict("EVENING_STARTED", "This evening has already started");
  }

  function bookingsOfSlot(slotId: string): Booking[] {
    return [...store.bookings.values()].filter((b) => b.slotId === slotId);
  }

  function slotsOfEvening(eveningId: string): Slot[] {
    return [...store.slots.values()]
      .filter((s) => s.eveningId === eveningId)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  function childrenOf(parent: Parent): Child[] {
    return parent.childIds.flatMap((id) => store.children.get(id) ?? []);
  }

  // A parent may see an evening when one of their children is in that teacher's class.
  function parentSeesEvening(parent: Parent, evening: Evening): boolean {
    return childrenOf(parent).some((c) => c.teacherId === evening.teacherId);
  }

  // Not allowed to see it = "not found", so we do not reveal that it exists.
  function getEveningForTeacher(teacher: Teacher, eveningId: string): Evening {
    const evening = store.evenings.get(eveningId);
    if (!evening || evening.teacherId !== teacher.id) throw notFound("Evening");
    return evening;
  }

  function getEveningForParent(parent: Parent, eveningId: string): Evening {
    const evening = store.evenings.get(eveningId);
    if (!evening || !parentSeesEvening(parent, evening)) throw notFound("Evening");
    return evening;
  }

  // Finds a slot and its evening, and checks that this teacher owns it.
  function getOwnSlot(teacher: Teacher, slotId: string): { slot: Slot; evening: Evening } {
    const slot = store.slots.get(slotId);
    if (!slot) throw notFound("Slot");
    return { slot, evening: getEveningForTeacher(teacher, slot.eveningId) };
  }

  // A booking can be changed by any parent of the child and by the evening's teacher.
  function getBookingForUser(user: User, bookingId: string) {
    const booking = store.bookings.get(bookingId);
    const slot = booking && store.slots.get(booking.slotId);
    const evening = slot && store.evenings.get(slot.eveningId);
    if (!booking || !slot || !evening) throw notFound("Booking");
    const allowed =
      user.role === "teacher"
        ? evening.teacherId === user.id
        : user.childIds.includes(booking.childId);
    if (!allowed) throw notFound("Booking");
    return { booking, slot, evening };
  }

  function toBookingView(booking: Booking, slot: Slot, evening: Evening): BookingView {
    const child = store.children.get(booking.childId);
    const parent = store.parents.get(booking.bookedByParentId);
    return {
      id: booking.id,
      eveningId: evening.id,
      date: evening.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      child: { id: booking.childId, name: child?.name ?? "" },
      bookedBy: { id: booking.bookedByParentId, name: parent?.name ?? "" },
    };
  }

  function viewOf(booking: Booking): BookingView {
    const slot = store.slots.get(booking.slotId) as Slot;
    const evening = store.evenings.get(slot.eveningId) as Evening;
    return toBookingView(booking, slot, evening);
  }

  // ---- public operations ----

  function getMe(user: User) {
    if (user.role === "teacher") return user;
    return { ...user, children: childrenOf(user) };
  }

  // Requirements 1 and 2: create an evening and its slots.
  function createEvening(teacherUser: User, input: CreateEveningInput) {
    const teacher = requireTeacher(teacherUser);
    if (!isValidDate(input.date)) {
      throw badRequest("VALIDATION_ERROR", "date is not a real calendar date");
    }
    if (toMinutes(input.endTime) <= toMinutes(input.startTime)) {
      throw badRequest("INVALID_TIME_RANGE", "endTime must be after startTime");
    }
    const times = generateSlotTimes(input.startTime, input.endTime, input.slotMinutes);
    if (times.length === 0) {
      throw badRequest("INVALID_TIME_RANGE", "slotMinutes is longer than the evening");
    }
    const evening: Evening = {
      id: store.nextId("evening"),
      teacherId: teacher.id,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      slotMinutes: input.slotMinutes,
    };
    if (hasStarted(evening)) {
      throw badRequest("EVENING_IN_PAST", "The evening must start in the future");
    }
    store.evenings.set(evening.id, evening);
    const slots = times.map((t): Slot => {
      const slot: Slot = {
        id: store.nextId("slot"),
        eveningId: evening.id,
        startTime: t.startTime,
        endTime: t.endTime,
        maxBookings: input.maxBookingsPerSlot ?? 1,
      };
      store.slots.set(slot.id, slot);
      return slot;
    });
    return { ...evening, slots };
  }

  function listEvenings(user: User): Evening[] {
    const evenings = [...store.evenings.values()].filter((e) =>
      user.role === "teacher" ? e.teacherId === user.id : parentSeesEvening(user, e),
    );
    return evenings.sort((a, b) =>
      `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`),
    );
  }

  // Requirement 3 (first half): a parent sees only the slots that still have room.
  function listFreeSlots(parentUser: User, eveningId: string) {
    const parent = requireParent(parentUser);
    getEveningForParent(parent, eveningId);
    return slotsOfEvening(eveningId)
      .map((s) => ({
        id: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        spotsLeft: s.maxBookings - bookingsOfSlot(s.id).length,
      }))
      .filter((s) => s.spotsLeft > 0);
  }

  // Requirement 6: every slot, in time order, with who is coming.
  function getOverview(teacherUser: User, eveningId: string) {
    const teacher = requireTeacher(teacherUser);
    const evening = getEveningForTeacher(teacher, eveningId);
    const slots = slotsOfEvening(eveningId).map((slot) => {
      const bookings = bookingsOfSlot(slot.id).map((b) => {
        const view = toBookingView(b, slot, evening);
        return { id: view.id, child: view.child, bookedBy: view.bookedBy };
      });
      return {
        id: slot.id,
        startTime: slot.startTime,
        endTime: slot.endTime,
        maxBookings: slot.maxBookings,
        spotsLeft: slot.maxBookings - bookings.length,
        bookings,
      };
    });
    return { evening, slots };
  }

  // Change how many conversations fit in one slot.
  function updateSlot(teacherUser: User, slotId: string, maxBookings: number): Slot {
    const teacher = requireTeacher(teacherUser);
    const { slot, evening } = getOwnSlot(teacher, slotId);
    assertNotStarted(evening);
    if (maxBookings < bookingsOfSlot(slot.id).length) {
      throw conflict("CAPACITY_BELOW_BOOKINGS", "The slot already has more bookings than that");
    }
    slot.maxBookings = maxBookings;
    return slot;
  }

  // Requirement 7: remove a slot (for example for a break). Booked slots cannot be removed.
  function deleteSlot(teacherUser: User, slotId: string): void {
    const teacher = requireTeacher(teacherUser);
    const { slot, evening } = getOwnSlot(teacher, slotId);
    assertNotStarted(evening);
    if (bookingsOfSlot(slot.id).length > 0) {
      throw conflict("SLOT_HAS_BOOKINGS", "Move the bookings to another slot first");
    }
    store.slots.delete(slot.id);
  }

  // Requirement 3 (second half): book a slot for a child.
  // Everything below is synchronous, so the "is there room?" check and the
  // write happen together and two parents cannot both take the last spot.
  function bookSlot(parentUser: User, slotId: string, childId: string): BookingView {
    const parent = requireParent(parentUser);
    const slot = store.slots.get(slotId);
    const evening = slot && store.evenings.get(slot.eveningId);
    if (!slot || !evening || !parentSeesEvening(parent, evening)) throw notFound("Slot");

    const child = parent.childIds.includes(childId) ? store.children.get(childId) : undefined;
    if (!child) throw notFound("Child");
    if (child.teacherId !== evening.teacherId) {
      throw forbidden("This child is not in this teacher's class");
    }

    assertNotStarted(evening);

    const eveningSlotIds = new Set(slotsOfEvening(evening.id).map((s) => s.id));
    const alreadyBooked = [...store.bookings.values()].some(
      (b) => b.childId === child.id && eveningSlotIds.has(b.slotId),
    );
    if (alreadyBooked) {
      throw conflict("CHILD_ALREADY_BOOKED", "This child already has a booking this evening");
    }
    if (bookingsOfSlot(slot.id).length >= slot.maxBookings) {
      throw conflict("SLOT_FULL", "This slot is full");
    }

    const booking: Booking = {
      id: store.nextId("booking"),
      slotId: slot.id,
      childId: child.id,
      bookedByParentId: parent.id,
    };
    store.bookings.set(booking.id, booking);
    return toBookingView(booking, slot, evening);
  }

  // Requirement 5: a parent sees the bookings of ALL their children,
  // including ones the other parent made.
  function listBookings(parentUser: User): BookingView[] {
    const parent = requireParent(parentUser);
    return [...store.bookings.values()]
      .filter((b) => parent.childIds.includes(b.childId))
      .map(viewOf)
      .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
  }

  // Requirement 4 (move). Only inside the same evening.
  function moveBooking(user: User, bookingId: string, targetSlotId: string): BookingView {
    const { booking, slot, evening } = getBookingForUser(user, bookingId);
    assertNotStarted(evening);

    const target = store.slots.get(targetSlotId);
    if (!target) throw notFound("Slot");
    if (target.eveningId !== evening.id) {
      throw badRequest("INVALID_MOVE", "Can only move within the same evening");
    }
    if (target.id === slot.id) return toBookingView(booking, slot, evening);
    if (bookingsOfSlot(target.id).length >= target.maxBookings) {
      throw conflict("SLOT_FULL", "The new slot is full");
    }
    booking.slotId = target.id;
    return toBookingView(booking, target, evening);
  }

  // Requirement 4 (cancel).
  function cancelBooking(user: User, bookingId: string): void {
    const { booking, evening } = getBookingForUser(user, bookingId);
    assertNotStarted(evening);
    store.bookings.delete(booking.id);
  }

  return {
    getMe,
    createEvening,
    listEvenings,
    listFreeSlots,
    getOverview,
    updateSlot,
    deleteSlot,
    bookSlot,
    listBookings,
    moveBooking,
    cancelBooking,
  };
}

export type Service = ReturnType<typeof createService>;
