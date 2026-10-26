import { describe, expect, it } from "vitest";
import { condenseReviews, describeEvent, groupSteps, REVIEW_SUMMARY } from "./event-label";

let t = 0;
const ev = (type: string, actor = "agent", data: unknown = {}) => ({ id: `e${++t}`, type, actor, data, createdAt: new Date(2026, 9, 21, 12, 0, t) });
const check = (type: string, status: string) => ev(type, "agent", { result: { status, summary: "" } });

describe("condenseReviews", () => {
  it("turns one review into a single summary line between other events", () => {
    const chronological = [
      ev("claim.submitted", "tenant"),
      ev("agent.review_started"),
      check("agent.record_receipt", "pass"),
      check("agent.check_math", "pass"),
      check("agent.assess_photos", "warn"),
      ev("agent.request_more_evidence", "agent", { result: { from: "tenant" } }),
      ev("agent.review_finished"),
      ev("evidence.added", "tenant"),
    ];
    const condensed = condenseReviews([...chronological].reverse());

    expect(condensed.map((e) => e.type)).toEqual(["evidence.added", REVIEW_SUMMARY, "claim.submitted"]);
    const summary = condensed[1];
    expect(describeEvent(summary.type, summary.data)).toBe("AI review: 2 of 3 checks passed · asked the tenant for more evidence");
  });

  it("summarizes each review run separately", () => {
    const chronological = [
      ev("agent.review_started"),
      check("agent.check_math", "pass"),
      ev("agent.review_finished"),
      ev("agent.review_started"),
      check("agent.check_math", "pass"),
      ev("agent.propose_split", "agent", { result: { landlordShareCents: 24000, tenantShareCents: 0 } }),
      ev("agent.review_finished"),
    ];
    const condensed = condenseReviews([...chronological].reverse());
    expect(condensed.map((e) => describeEvent(e.type, e.data))).toEqual([
      "AI review: 1 of 1 checks passed · proposed landlord pays $240.00, tenant pays $0.00",
      "AI review: 1 of 1 checks passed · ended without a decision",
    ]);
  });

  it("marks a review that is still running", () => {
    const condensed = condenseReviews([check("agent.check_math", "pass"), ev("agent.review_started")]);
    expect(describeEvent(condensed[0].type, condensed[0].data)).toContain("in progress");
  });
});

describe("groupSteps", () => {
  it("merges repeated steps into one row with the worst status", () => {
    const rows = groupSteps([
      check("agent.check_math", "pass"),
      ev("agent.estimate_price", "agent", { why: "labor", result: { status: "pass", summary: "Labor range" } }),
      ev("agent.estimate_price", "agent", { why: "parts", result: { status: "warn", summary: "Parts range" } }),
    ]);
    expect(rows.map((r) => r.type)).toEqual(["agent.check_math", "agent.estimate_price"]);
    expect(rows[1]).toMatchObject({ status: "warn", summaries: ["Labor range", "Parts range"], whys: ["labor", "parts"] });
  });

  it("counts a repeated step once in the review summary", () => {
    const chronological = [
      ev("agent.review_started"),
      check("agent.estimate_price", "pass"),
      check("agent.estimate_price", "pass"),
      ev("agent.review_finished"),
    ];
    const [summary] = condenseReviews([...chronological].reverse());
    expect(describeEvent(summary.type, summary.data)).toContain("1 of 1 checks passed");
  });
});
