// Notification settings, safe to import in the browser. Must match the notify_level enum in lib/db/schema.ts.
export const NOTIFY_LEVELS = ["important", "all", "off"] as const;
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number];
export const NOTIFY_LABEL: Record<NotifyLevel, string> = {
  important: "Only things that need me",
  all: "Every update",
  off: "Nothing",
};

type Role = "landlord" | "tenant";

/** Events that usually mean "you have something to look at or do". */
const IMPORTANT: Record<Role, string[]> = {
  tenant: ["claim.shared", "claim.submitted", "split.proposed", "claim.approved", "claim.withdrawn", "agent.review_finished", "invoice.sent", "invoice.reminder_sent", "payout.succeeded", "payout.failed", "invoice.autopay_skipped", "invoice.autopay_failed"],
  landlord: ["claim.shared", "claim.submitted", "split.proposed", "claim.approved", "claim.withdrawn", "agent.review_finished", "invoice.paid", "payout.failed", "invoice.auto_send_failed"],
};

export function isNotable(event: { type: string; actor: string }, role: Role, level: NotifyLevel): boolean {
  if (level === "off" || event.actor === role) return false;
  if (level === "important") return IMPORTANT[role].includes(event.type);
  // Every update, minus the review's individual steps (its summary is review_finished).
  return !event.type.startsWith("agent.") || event.type === "agent.review_finished";
}
