import { describe, expect, it } from "vitest";
import { generateSlotTimes } from "../src/slots.js";
import { isValidDate, localNow, toHHmm, toMinutes } from "../src/time.js";

describe("generateSlotTimes", () => {
  it("splits an evening that divides evenly", () => {
    const slots = generateSlotTimes("18:00", "19:00", 15);
    expect(slots).toEqual([
      { startTime: "18:00", endTime: "18:15" },
      { startTime: "18:15", endTime: "18:30" },
      { startTime: "18:30", endTime: "18:45" },
      { startTime: "18:45", endTime: "19:00" },
    ]);
  });

  it("drops a leftover piece that is too short for a full slot", () => {
    const slots = generateSlotTimes("18:00", "20:10", 15);
    expect(slots).toHaveLength(8);
    expect(slots[slots.length - 1]).toEqual({ startTime: "19:45", endTime: "20:00" });
  });

  it("returns nothing when one slot is longer than the whole evening", () => {
    expect(generateSlotTimes("18:00", "18:20", 30)).toEqual([]);
  });

  it("returns nothing when the end is not after the start", () => {
    expect(generateSlotTimes("19:00", "18:00", 15)).toEqual([]);
  });
});

describe("time helpers", () => {
  it("converts HH:mm to minutes and back", () => {
    expect(toMinutes("18:45")).toBe(1125);
    expect(toHHmm(1125)).toBe("18:45");
    expect(toHHmm(toMinutes("07:05"))).toBe("07:05");
    expect(toHHmm(toMinutes("00:00"))).toBe("00:00");
  });

  it("accepts real dates and rejects impossible ones", () => {
    expect(isValidDate("2026-12-01")).toBe(true);
    expect(isValidDate("2028-02-29")).toBe(true);
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("2026-1-1")).toBe(false);
  });

  it("formats local time as YYYY-MM-DD HH:mm", () => {
    expect(localNow(new Date(2026, 0, 5, 7, 3))).toBe("2026-01-05 07:03");
    expect(localNow(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31 23:59");
  });
});
