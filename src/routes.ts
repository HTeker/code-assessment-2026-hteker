import type { FastifyInstance } from "fastify";
import { getUser } from "./auth.js";
import type { CreateEveningInput, Service } from "./service.js";
import type { Store } from "./store.js";

const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
const TIME_PATTERN = "^([01]\\d|2[0-3]):[0-5]\\d$";

const eveningIdParams = {
  type: "object",
  properties: { eveningId: { type: "string" } },
  required: ["eveningId"],
};
const slotIdParams = {
  type: "object",
  properties: { slotId: { type: "string" } },
  required: ["slotId"],
};
const bookingIdParams = {
  type: "object",
  properties: { bookingId: { type: "string" } },
  required: ["bookingId"],
};

// Thin on purpose: check who is calling, call the service, send the result.
// All business rules are in service.ts.
export function registerRoutes(app: FastifyInstance, store: Store, service: Service): void {
  // Runs before body validation, so a caller who is not logged in always gets 401 first.
  app.decorateRequest("user");
  app.addHook("onRequest", async (request) => {
    request.user = getUser(request, store);
  });

  app.get(
    "/me",
    { schema: { tags: ["Me"], summary: "Who am I? (parents also get their children)" } },
    async (request) => service.getMe(request.user),
  );

  app.post<{ Body: CreateEveningInput }>(
    "/evenings",
    {
      schema: {
        tags: ["Evenings"],
        summary: "Teacher creates a conference evening; the slots are generated",
        body: {
          type: "object",
          required: ["date", "startTime", "endTime", "slotMinutes"],
          additionalProperties: false,
          properties: {
            date: { type: "string", pattern: DATE_PATTERN, examples: ["2026-12-15"] },
            startTime: { type: "string", pattern: TIME_PATTERN, examples: ["18:00"] },
            endTime: { type: "string", pattern: TIME_PATTERN, examples: ["20:00"] },
            slotMinutes: { type: "integer", minimum: 5, maximum: 240, examples: [15] },
            maxBookingsPerSlot: { type: "integer", minimum: 1, maximum: 50, default: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const evening = service.createEvening(request.user, request.body);
      return reply.code(201).send(evening);
    },
  );

  app.get(
    "/evenings",
    {
      schema: {
        tags: ["Evenings"],
        summary: "Teacher: own evenings. Parent: evenings of their children's teachers",
      },
    },
    async (request) => service.listEvenings(request.user),
  );

  app.get<{ Params: { eveningId: string } }>(
    "/evenings/:eveningId/slots",
    {
      schema: {
        tags: ["Evenings"],
        summary: "Parent: the free slots of an evening",
        params: eveningIdParams,
      },
    },
    async (request) => service.listFreeSlots(request.user, request.params.eveningId),
  );

  app.get<{ Params: { eveningId: string } }>(
    "/evenings/:eveningId/overview",
    {
      schema: {
        tags: ["Evenings"],
        summary: "Teacher: every slot with the children and parents who are coming",
        params: eveningIdParams,
      },
    },
    async (request) => service.getOverview(request.user, request.params.eveningId),
  );

  app.patch<{ Params: { slotId: string }; Body: { maxBookings: number } }>(
    "/slots/:slotId",
    {
      schema: {
        tags: ["Slots"],
        summary: "Teacher: change how many conversations fit in a slot",
        params: slotIdParams,
        body: {
          type: "object",
          required: ["maxBookings"],
          additionalProperties: false,
          properties: { maxBookings: { type: "integer", minimum: 1, maximum: 50 } },
        },
      },
    },
    async (request) =>
      service.updateSlot(request.user, request.params.slotId, request.body.maxBookings),
  );

  app.delete<{ Params: { slotId: string } }>(
    "/slots/:slotId",
    {
      schema: {
        tags: ["Slots"],
        summary: "Teacher: remove a slot (for example a break). Not allowed if it has bookings",
        params: slotIdParams,
      },
    },
    async (request, reply) => {
      service.deleteSlot(request.user, request.params.slotId);
      return reply.code(204).send();
    },
  );

  app.post<{ Body: { slotId: string; childId: string } }>(
    "/bookings",
    {
      schema: {
        tags: ["Bookings"],
        summary: "Parent: book a slot for one of their children",
        body: {
          type: "object",
          required: ["slotId", "childId"],
          additionalProperties: false,
          properties: {
            slotId: { type: "string", examples: ["slot-1"] },
            childId: { type: "string", examples: ["child-1"] },
          },
        },
      },
    },
    async (request, reply) => {
      const booking = service.bookSlot(request.user, request.body.slotId, request.body.childId);
      return reply.code(201).send(booking);
    },
  );

  app.get(
    "/bookings",
    {
      schema: {
        tags: ["Bookings"],
        summary: "Parent: the bookings of all their children (also those the other parent made)",
      },
    },
    async (request) => service.listBookings(request.user),
  );

  app.patch<{ Params: { bookingId: string }; Body: { slotId: string } }>(
    "/bookings/:bookingId",
    {
      schema: {
        tags: ["Bookings"],
        summary: "Parent of the child or the teacher: move a booking to another slot, same evening",
        params: bookingIdParams,
        body: {
          type: "object",
          required: ["slotId"],
          additionalProperties: false,
          properties: { slotId: { type: "string", examples: ["slot-2"] } },
        },
      },
    },
    async (request) =>
      service.moveBooking(request.user, request.params.bookingId, request.body.slotId),
  );

  app.delete<{ Params: { bookingId: string } }>(
    "/bookings/:bookingId",
    {
      schema: {
        tags: ["Bookings"],
        summary: "Parent of the child or the teacher: cancel a booking",
        params: bookingIdParams,
      },
    },
    async (request, reply) => {
      service.cancelBooking(request.user, request.params.bookingId);
      return reply.code(204).send();
    },
  );
}
