import { describe, expect, it } from "vitest";
import { formatDateTime, todayInAppZone } from "./time";

describe("time", () => {
  it("formats timestamps in Pacific time with a PT suffix", () => {
    expect(formatDateTime(new Date("2026-10-26T04:28:00Z"))).toBe("Oct 25, 2026, 9:28 PM PT");
  });

  it("uses the Pacific date for today, not UTC", () => {
    expect(todayInAppZone(new Date("2026-10-26T04:28:00Z"))).toBe("2026-10-25");
    expect(todayInAppZone(new Date("2026-10-26T20:00:00Z"))).toBe("2026-10-26");
  });
});
