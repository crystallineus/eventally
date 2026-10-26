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
    const checks = run.filter((e) => CHECKS.has(e.type));
    const passed = checks.filter((e) => (e.data as { result?: { status?: string } })?.result?.status === "pass").length;
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
