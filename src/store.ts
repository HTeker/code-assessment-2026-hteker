import type { Booking, Child, Evening, Parent, Slot, Teacher } from "./domain.js";

// Plain in-memory storage. No business rules live here.
export interface Store {
  teachers: Map<string, Teacher>;
  parents: Map<string, Parent>;
  children: Map<string, Child>;
  evenings: Map<string, Evening>;
  slots: Map<string, Slot>;
  bookings: Map<string, Booking>;
  nextId(prefix: "evening" | "slot" | "booking"): string;
}

export function createStore(): Store {
  const counters = new Map<string, number>();
  return {
    teachers: new Map(),
    parents: new Map(),
    children: new Map(),
    evenings: new Map(),
    slots: new Map(),
    bookings: new Map(),
    // Readable ids ("slot-1", "slot-2") make curl demos easy.
    nextId(prefix) {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      return `${prefix}-${n}`;
    },
  };
}
