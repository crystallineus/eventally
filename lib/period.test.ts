import { describe, expect, it } from "vitest";
import { formatPeriod, nextPeriod, periodOf } from "./period";

describe("period", () => {
  it("advances months and rolls over the year", () => {
    expect(nextPeriod("2026-11")).toBe("2026-12");
    expect(nextPeriod("2026-12")).toBe("2027-01");
  });

  it("formats for display", () => {
    expect(formatPeriod("2026-12")).toBe("December 2026");
  });

  it("takes the period of a date", () => {
    expect(periodOf("2026-06-01")).toBe("2026-06");
  });

  it("rejects malformed periods", () => {
    expect(() => nextPeriod("2026-13")).toThrow();
    expect(() => formatPeriod("26-1")).toThrow();
  });
});
