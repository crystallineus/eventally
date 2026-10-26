import { describe, expect, it } from "vitest";
import { checkDates, checkMath, type Receipt } from "./checks";

const receipt: Receipt = {
  merchant: "Bay Plumbing",
  date: "2026-11-21",
  lineItems: [
    { description: "Labor", amountCents: 18000 },
    { description: "P-trap kit", amountCents: 6000 },
  ],
  taxCents: null,
  totalCents: 24000,
};

describe("checkMath", () => {
  it("passes when items add up and match the claim", () => {
    expect(checkMath(receipt, 24000).status).toBe("pass");
  });

  it("fails when items don't add up to the total", () => {
    expect(checkMath({ ...receipt, totalCents: 25000 }, 25000).status).toBe("fail");
  });

  it("warns when the claim differs from the receipt", () => {
    const result = checkMath(receipt, 26000);
    expect(result.status).toBe("warn");
    expect(result.summary).toContain("$260.00");
  });

  it("includes tax in the sum", () => {
    expect(checkMath({ ...receipt, taxCents: 500, totalCents: 24500 }, 24500).status).toBe("pass");
  });
});

describe("checkDates", () => {
  const lease = { startDate: "2026-06-01", endDate: "2027-05-31" };

  it("passes a receipt after the report, inside the lease", () => {
    expect(checkDates("2026-11-21", "2026-11-20", lease, "2026-11-25").status).toBe("pass");
  });

  it("warns on a receipt dated before the problem was reported", () => {
    expect(checkDates("2026-11-19", "2026-11-20", lease, "2026-11-25").status).toBe("warn");
  });

  it("fails on future or out-of-lease dates", () => {
    expect(checkDates("2026-12-01", "2026-11-20", lease, "2026-11-25").status).toBe("fail");
    expect(checkDates("2026-05-01", "2026-04-20", lease, "2026-11-25").status).toBe("fail");
  });

  it("warns when the date is unreadable", () => {
    expect(checkDates(null, "2026-11-20", lease, "2026-11-25").status).toBe("warn");
  });
});
