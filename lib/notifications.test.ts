import { describe, expect, it } from "vitest";
import { isNotable } from "@/lib/notifications-shared";

describe("isNotable", () => {
  it("skips your own actions", () => {
    expect(isNotable({ type: "claim.submitted", actor: "tenant" }, "tenant", "all")).toBe(false);
    expect(isNotable({ type: "claim.submitted", actor: "tenant" }, "landlord", "important")).toBe(true);
  });

  it("shows only things that need you by default", () => {
    expect(isNotable({ type: "invoice.sent", actor: "system" }, "tenant", "important")).toBe(true);
    expect(isNotable({ type: "invoice.sent", actor: "system" }, "landlord", "important")).toBe(false);
    expect(isNotable({ type: "invoice.paid", actor: "paypal" }, "landlord", "important")).toBe(true);
    expect(isNotable({ type: "evidence.added", actor: "landlord" }, "tenant", "important")).toBe(false);
  });

  it("every update still hides the review's individual steps", () => {
    expect(isNotable({ type: "evidence.added", actor: "landlord" }, "tenant", "all")).toBe(true);
    expect(isNotable({ type: "agent.propose_split", actor: "agent" }, "tenant", "all")).toBe(false);
    expect(isNotable({ type: "agent.review_finished", actor: "agent" }, "tenant", "all")).toBe(true);
  });

  it("off shows nothing", () => {
    expect(isNotable({ type: "invoice.sent", actor: "system" }, "tenant", "off")).toBe(false);
  });
});
