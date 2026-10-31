import { runDailySchedule } from "@/lib/schedule";

export const maxDuration = 60;

// Vercel Cron calls this once a day (vercel.json) with "Authorization: Bearer $CRON_SECRET".
// Sends invoices that are due soon, autopays invoices due today, and clears out old demos.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runDailySchedule();
  console.log("daily schedule", JSON.stringify(result));
  return Response.json(result);
}
