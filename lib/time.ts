// EvenTally serves US landlords and tenants, so timestamps are shown and "today" is decided in
// Pacific time rather than the server's UTC. Calendar dates (lease terms, report dates) have no
// time zone and are formatted elsewhere as plain dates.
export const APP_TIME_ZONE = "America/Los_Angeles";

/** e.g. "Oct 25, 2026, 9:28 PM PT" */
export function formatDateTime(d: Date): string {
  return `${d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: APP_TIME_ZONE })} PT`;
}

/** Today's date in Pacific time as YYYY-MM-DD. */
export function todayInAppZone(now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return now.toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE });
}
