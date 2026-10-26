import { formatUsd } from "@/lib/money";

// Human-readable lines for the events log. Unknown types fall back to the raw type.
export function describeEvent(type: string, data: unknown): string {
  const d = (data ?? {}) as Record<string, unknown> & { result?: { summary?: string } };
  const by = typeof d.by === "string" ? d.by : "Someone";
  switch (type) {
    case "lease.created":
      return `Lease created: ${d.landlord} rents to ${d.tenant}.`;
    case "claim.submitted":
      return `${by} submitted a claim for ${formatUsd(Number(d.amountCents ?? 0))}.`;
    case "evidence.added":
      return `${by} added ${Array.isArray(d.kinds) ? d.kinds.join(", ") : "evidence"} photos.`;
    case "split.proposed":
      return `${by} proposed: landlord ${formatUsd(Number(d.landlordShareCents))}, tenant ${formatUsd(Number(d.tenantShareCents))}.`;
    case "split.approved":
      return `${by} approved the split.`;
    case "claim.approved":
      return String(d.summary ?? "Both sides approved.");
    case "claim.amount_changed":
      return `${by} changed the claimed amount from ${formatUsd(Number(d.fromCents ?? 0))} to ${formatUsd(Number(d.toCents ?? 0))}. The split was cleared for a new review.`;
    case "claim.withdrawn":
      return `${by} withdrew the claim.`;
    case "agent.review_finished":
      return "EvenTally AI finished its review.";
    case REVIEW_SUMMARY:
      return `AI review: ${d.passed} of ${d.total} checks passed · ${d.outcome}`;
    default:
      if (type.startsWith("agent.")) return d.result?.summary ?? String(d.note ?? type);
      return type;
  }
}

export const REVIEW_SUMMARY = "agent.review_summary";

const CHECKS = new Set([
  "agent.record_receipt",
  "agent.check_math",
  "agent.check_dates",
  "agent.check_duplicate",
  "agent.assess_photos",
  "agent.estimate_price",
]);

type LogEvent = { id: string; type: string; actor: string; data: unknown; createdAt: Date };

export type StepStatus = "pass" | "warn" | "fail";
export type StepRow = { id: string; type: string; status: StepStatus; summaries: string[]; whys: string[] };
const SEVERITY: Record<StepStatus, number> = { pass: 0, warn: 1, fail: 2 };

/**
 * One row per step type, in the order each type first appeared. The agent may call a tool more
 * than once (e.g. a price estimate for labor and another for parts); those merge into one row
 * that shows every result and takes the worst status.
 */
export function groupSteps(steps: Pick<LogEvent, "id" | "type" | "data">[]): StepRow[] {
  const rows = new Map<string, StepRow>();
  for (const s of steps) {
    const d = (s.data ?? {}) as { why?: string; result?: { status?: string; summary?: string } };
    const status = (["pass", "warn", "fail"].includes(d.result?.status ?? "") ? d.result!.status : "pass") as StepStatus;
    const row = rows.get(s.type) ?? { id: s.id, type: s.type, status: "pass", summaries: [], whys: [] };
    if (SEVERITY[status] > SEVERITY[row.status]) row.status = status;
    if (d.result?.summary && !row.summaries.includes(d.result.summary)) row.summaries.push(d.result.summary);
    if (d.why && !row.whys.includes(d.why)) row.whys.push(d.why);
    rows.set(s.type, row);
  }
  return [...rows.values()];
}

/**
 * Collapse each AI review (all agent events from "review_started" on) into one summary line,
 * e.g. "5 of 6 checks passed · asked the tenant for more evidence". Takes and returns events
 * newest first; the step-by-step detail stays on the claim page's AI review panel.
 */
export function condenseReviews<E extends LogEvent>(newestFirst: E[]): (E | LogEvent)[] {
  const out: (E | LogEvent)[] = [];
  let run: E[] | null = null;

  const flush = () => {
    if (!run) return;
    const checks = groupSteps(run.filter((e) => CHECKS.has(e.type)));
    const passed = checks.filter((c) => c.status === "pass").length;
    const last = run.at(-1)!;
    out.push({
      id: run[0].id,
      type: REVIEW_SUMMARY,
      actor: "agent",
      createdAt: last.createdAt,
      data: { passed, total: checks.length, outcome: outcomeOf(run) },
    });
    run = null;
  };

  for (const e of [...newestFirst].reverse()) {
    if (e.type === "agent.review_started") {
      flush();
      run = [e];
    } else if (run && e.actor === "agent") {
      run.push(e);
      if (e.type === "agent.review_finished") flush();
    } else {
      flush();
      out.push(e);
    }
  }
  flush();
  return out.reverse();
}

function outcomeOf(run: LogEvent[]): string {
  for (const e of [...run].reverse()) {
    const d = (e.data ?? {}) as { result?: { from?: string; landlordShareCents?: number; tenantShareCents?: number } };
    switch (e.type) {
      case "agent.request_more_evidence":
        return `asked the ${d.result?.from ?? "submitter"} for more evidence`;
      case "agent.propose_split":
        return `proposed landlord pays ${formatUsd(d.result?.landlordShareCents ?? 0)}, tenant pays ${formatUsd(d.result?.tenantShareCents ?? 0)}`;
      case "agent.refused":
        return "declined to review";
      case "agent.error":
        return "stopped with an error";
      case "agent.review_incomplete":
        return "ended without a decision";
    }
  }
  return run.some((e) => e.type === "agent.review_finished") ? "ended without a decision" : "in progress";
}

export type Proposal = {
  id: string;
  by: string; // a person's name, or "EvenTally AI"
  at: Date;
  landlordShareCents: number;
  tenantShareCents: number;
  rationale: string;
  approvals: { by: string; at: Date }[];
};

/** Every split proposed on a claim, oldest first, each with the approvals it received. */
export function proposalHistory(newestFirst: LogEvent[]): Proposal[] {
  const proposals: Proposal[] = [];
  for (const e of [...newestFirst].reverse()) {
    const d = (e.data ?? {}) as Record<string, unknown> & {
      result?: { landlordShareCents?: number; tenantShareCents?: number; rationale?: string; leaseCitation?: string };
    };
    if (e.type === "split.proposed") {
      proposals.push({
        id: e.id,
        by: String(d.by ?? "Someone"),
        at: e.createdAt,
        landlordShareCents: Number(d.landlordShareCents),
        tenantShareCents: Number(d.tenantShareCents),
        rationale: String(d.rationale ?? ""),
        approvals: [],
      });
    } else if (e.type === "agent.propose_split" && d.result) {
      proposals.push({
        id: e.id,
        by: "EvenTally AI",
        at: e.createdAt,
        landlordShareCents: Number(d.result.landlordShareCents),
        tenantShareCents: Number(d.result.tenantShareCents),
        rationale: [d.result.rationale, d.result.leaseCitation && `Lease: ${d.result.leaseCitation}`].filter(Boolean).join("\n\n"),
        approvals: [],
      });
    } else if (e.type === "split.approved" && proposals.length) {
      // Proposing counts as the proposer's approval, so it isn't listed separately.
      proposals.at(-1)!.approvals.push({ by: String(d.by ?? "Someone"), at: e.createdAt });
    }
  }
  return proposals;
}
