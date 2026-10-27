import { settleFromPayPal } from "@/lib/invoicing";
import { verifyWebhook } from "@/lib/paypal";
import { syncPayoutByBatch } from "@/lib/payouts";

// PayPal webhook receiver. Verifies the signature against the raw body, then settles paid
// invoices. Redeliveries are harmless: settlement is idempotent and event ids are unique.
export async function POST(request: Request) {
  if (!process.env.PAYPAL_WEBHOOK_ID) {
    // Not configured: answer 503 so PayPal retries later instead of us guessing.
    return Response.json({ error: "PayPal webhook is not configured" }, { status: 503 });
  }
  const raw = await request.text();
  if (!(await verifyWebhook(request.headers, raw))) {
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  const event = JSON.parse(raw) as {
    id: string;
    event_type: string;
    resource?: { invoice?: Parameters<typeof settleFromPayPal>[0]; payout_batch_id?: string };
  };
  // Payout item events: re-read the batch from PayPal rather than trusting the payload's shape.
  if (event.event_type.startsWith("PAYMENT.PAYOUTS-ITEM.") && event.resource?.payout_batch_id) {
    const payout = await syncPayoutByBatch(event.resource.payout_batch_id);
    return Response.json({ result: payout ? payout.status : "unknown_payout" });
  }
  if (event.event_type === "INVOICING.INVOICE.PAID" && event.resource?.invoice) {
    try {
      const result = await settleFromPayPal(event.resource.invoice, "webhook", event.id);
      return Response.json({ result });
    } catch (err) {
      // A unique violation on the event id means we already processed this delivery.
      if (err instanceof Error && /paypal_event_id/.test(String((err as { cause?: unknown }).cause ?? err.message))) {
        return Response.json({ result: "duplicate" });
      }
      throw err;
    }
  }
  return Response.json({ result: "ignored" });
}
