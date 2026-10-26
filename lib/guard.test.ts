import { describe, expect, it } from "vitest";
import { amountsIn, unknownAmounts } from "./guard";

describe("guard", () => {
  it("finds dollar amounts in prose", () => {
    expect(amountsIn("Labor $180 plus parts $60.00, total $1,240.5.")).toEqual([18000, 6000, 124050]);
  });

  it("ignores numbers that aren't dollar amounts", () => {
    expect(amountsIn("Lease §12(a), 2 hours, 100%")).toEqual([]);
  });

  it("flags amounts the ledger doesn't know", () => {
    expect(unknownAmounts("Landlord pays $240.00 of the $240 receipt.", [24000])).toEqual([]);
    expect(unknownAmounts("Landlord pays $250.", [24000])).toEqual(["$250.00"]);
  });
});
