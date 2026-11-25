import { toHHmm, toMinutes } from "./time.js";

export interface SlotTime {
  startTime: string;
  endTime: string;
}

// Back-to-back slots of slotMinutes from startTime. A leftover piece that is
// too short for a full slot is dropped (18:00-20:10 with 15 min ends at 20:00).
export function generateSlotTimes(
  startTime: string,
  endTime: string,
  slotMinutes: number,
): SlotTime[] {
  const end = toMinutes(endTime);
  const slots: SlotTime[] = [];
  for (let start = toMinutes(startTime); start + slotMinutes <= end; start += slotMinutes) {
    slots.push({ startTime: toHHmm(start), endTime: toHHmm(start + slotMinutes) });
  }
  return slots;
}
