import { describe, expect, it } from "vitest";
import { isDraft, visibleTo } from "./claims";

describe("claim drafts", () => {
  const draft = { sharedAt: null, submittedBy: "maya" };
  const sent = { sharedAt: new Date(), submittedBy: "maya" };

  it("shows a draft only to its submitter", () => {
    expect(visibleTo(draft, "maya")).toBe(true);
    expect(visibleTo(draft, "tom")).toBe(false);
    expect(isDraft(draft)).toBe(true);
  });

  it("shows a sent claim to both sides", () => {
    expect(visibleTo(sent, "maya")).toBe(true);
    expect(visibleTo(sent, "tom")).toBe(true);
    expect(isDraft(sent)).toBe(false);
  });
});
