// Spike 2a: receive PayPal webhooks, verify the signature, record every delivery.
// Usage: node --env-file=.env spikes/paypal/02-webhook-server.mjs   (listens on :3000, path /webhooks/paypal)
import { createServer } from "node:http";
import { pp, saveResult } from "./lib.mjs";

const PORT = 3000;
const seen = new Map(); // event id -> delivery count (idempotency check)
const deliveries = [];

async function verify(headers, rawBody) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return { verification_status: "SKIPPED (no PAYPAL_WEBHOOK_ID)" };
  // Splice the raw body in as-is: re-serializing the parsed event can change bytes and break verification.
  const meta = {
    auth_algo: headers["paypal-auth-algo"],
    cert_url: headers["paypal-cert-url"],
    transmission_id: headers["paypal-transmission-id"],
    transmission_sig: headers["paypal-transmission-sig"],
    transmission_time: headers["paypal-transmission-time"],
    webhook_id: webhookId,
  };
  const body = `${JSON.stringify(meta).slice(0, -1)},"webhook_event":${rawBody}}`;
  const res = await pp("POST", "/v1/notifications/verify-webhook-signature", JSON.parse(body));
  return res.status === 200 ? res.body : { verification_status: `ERROR ${res.status}`, error: res.body };
}

createServer(async (req, res) => {
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("eventally webhook spike: ok\n");
    return;
  }
  if (req.method !== "POST" || req.url !== "/webhooks/paypal") {
    res.writeHead(404).end();
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  // Ack fast so PayPal doesn't retry while we verify.
  res.writeHead(200).end();

  let event;
  try { event = JSON.parse(raw); } catch { console.log("non-JSON body:", raw.slice(0, 200)); return; }

  const count = (seen.get(event.id) ?? 0) + 1;
  seen.set(event.id, count);
  const verification = await verify(req.headers, raw);

  const resource = event.resource ?? {};
  const invoice = resource.invoice ?? resource;
  const entry = {
    received_at: new Date().toISOString(),
    event_id: event.id,
    event_type: event.event_type,
    delivery_count: count,
    verification: verification.verification_status,
    invoice_id: invoice.id ?? null,
    invoice_status: invoice.status ?? null,
    amount: invoice.amount?.value ?? resource.amount?.value ?? null,
    headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.startsWith("paypal-"))),
    event,
  };
  deliveries.push(entry);
  saveResult("02-webhook-deliveries", deliveries);

  console.log(
    `[${entry.received_at}] ${entry.event_type}  event=${entry.event_id}  delivery#${count}` +
      `  invoice=${entry.invoice_id} status=${entry.invoice_status} amount=${entry.amount}  verify=${entry.verification}`
  );
}).listen(PORT, () => console.log(`Listening on :${PORT}  (webhook id: ${process.env.PAYPAL_WEBHOOK_ID || "not set"})`));
