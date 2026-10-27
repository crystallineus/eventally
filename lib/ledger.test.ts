import { describe, expect, it } from "vitest";
import type { schema } from "@/lib/db";
import { adjustmentsFromClaims } from "./ledger";

type Claim = typeof schema.claims.$inferSelect;

const lease = { landlordId: "tom" };

function claim(overrides: Partial<Claim>): Claim {
  return {
    id: "c",
    leaseId: "l",
    submittedBy: "maya",
    title: "repair",
    description: "",
    issueReportedAt: new Date(),
    status: "approved",
    amountCents: 24000,
    landlordShareCents: 24000,
    tenantShareCents: 0,
    splitRationale: null,
    reviewStartedAt: null,
    landlordApprovedAt: new Date(),
    tenantApprovedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("adjustmentsFromClaims", () => {
  it("credits the landlord's share back when the tenant paid", () => {
    expect(adjustmentsFromClaims(lease, [claim({ id: "sink", title: "kitchen sink repair" })])).toEqual([
      { kind: "credit", amountCents: 24000, description: "Credit: kitchen sink repair", claimId: "sink" },
    ]);
  });

  it("charges the tenant's share when the landlord paid", () => {
    const screen = claim({ id: "screen", submittedBy: "tom", title: "window screen", amountCents: 4500, landlordShareCents: 0, tenantShareCents: 4500 });
    expect(adjustmentsFromClaims(lease, [screen])).toEqual([
      { kind: "charge", amountCents: 4500, description: "Charge: window screen", claimId: "screen" },
    ]);
  });

  it("ignores claims that are not approved or have nothing to move", () => {
    expect(
      adjustmentsFromClaims(lease, [
        claim({ status: "awaiting_approval" }),
        claim({ status: "invoiced" }),
        claim({ landlordShareCents: 0, tenantShareCents: 24000 }), // tenant paid and bears it all
      ]),
    ).toEqual([]);
  });
});
