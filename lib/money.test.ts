import { describe, expect, it } from "vitest";
import { buildRentInvoice, formatUsd, parseUsd, splitByShare, toApiValue } from "./money";

describe("parseUsd", () => {
  it.each([
    ["1805", 180500],
    ["1805.5", 180550],
    ["1,805.00", 180500],
    ["$1,805.00", 180500],
    ["-240.00", -24000],
    ["0.07", 7],
  ])("%s -> %i cents", (input, cents) => expect(parseUsd(input)).toBe(cents));

  it.each(["", "abc", "1.234", "1,80.00", "$-5"])("rejects %j", (input) => {
    expect(() => parseUsd(input)).toThrow();
  });
});

describe("formatting", () => {
  it("formats API values", () => {
    expect(toApiValue(180500)).toBe("1805.00");
    expect(toApiValue(-24000)).toBe("-240.00");
    expect(toApiValue(7)).toBe("0.07");
  });

  it("formats display values", () => {
    expect(formatUsd(180500)).toBe("$1,805.00");
    expect(formatUsd(-24000)).toBe("-$240.00");
  });

  it("rejects fractional cents", () => {
    expect(() => toApiValue(1.5)).toThrow();
  });
});

describe("splitByShare", () => {
  it("landlord pays 100%", () => {
    expect(splitByShare(24000, 10000)).toEqual({ landlord: 24000, tenant: 0 });
  });

  it("always adds up to the total on odd cents", () => {
    const { landlord, tenant } = splitByShare(4501, 5000);
    expect(landlord + tenant).toBe(4501);
    expect(landlord).toBe(2251);
  });

  it("rejects shares outside 0–100%", () => {
    expect(() => splitByShare(100, 10001)).toThrow();
    expect(() => splitByShare(100, -1)).toThrow();
  });
});

describe("buildRentInvoice", () => {
  const rent = { name: "Rent – December 2026", amountCents: 200000 };

  it("matches the demo: $2,000 − $240 + $45 = $1,805", () => {
    const invoice = buildRentInvoice(rent, [
      { kind: "credit", amountCents: 24000, description: "Credit: kitchen sink repair", claimId: "c1" },
      { kind: "charge", amountCents: 4500, description: "Charge: window screen repair", claimId: "c2" },
    ]);
    expect(invoice.totalCents).toBe(180500);
    expect(invoice.carryOverCents).toBe(0);
    expect(invoice.lines.map((l) => l.amountCents)).toEqual([200000, 4500, -24000]);
  });

  it("carries excess credit over instead of producing a negative total", () => {
    const invoice = buildRentInvoice(rent, [{ kind: "credit", amountCents: 250000, description: "Credit: water heater" }]);
    expect(invoice.totalCents).toBe(0);
    expect(invoice.carryOverCents).toBe(50000);
    expect(invoice.lines.at(-1)).toEqual({ name: "Credit carried over to next period", amountCents: 50000 });
  });

  it("rejects non-positive adjustments", () => {
    expect(() => buildRentInvoice(rent, [{ kind: "credit", amountCents: -100, description: "bad" }])).toThrow();
  });
});
