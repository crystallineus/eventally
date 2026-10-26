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
    default:
      if (type.startsWith("agent.")) return d.result?.summary ?? String(d.note ?? type);
      return type;
  }
}
