// Spike 2b: register (or reuse) a sandbox webhook pointing at this Codespace's public port 3000.
// Usage: node --env-file=.env spikes/paypal/03-register-webhook.mjs [public-base-url]
import { pp } from "./lib.mjs";

const base =
  process.argv[2] ??
  (process.env.CODESPACE_NAME
    ? `https://${process.env.CODESPACE_NAME}-3000.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
    : null);
if (!base) throw new Error("Pass the public base URL as an argument");
const url = `${base.replace(/\/$/, "")}/webhooks/paypal`;

const eventTypes = [
  "INVOICING.INVOICE.PAID",
  "INVOICING.INVOICE.UPDATED",
  "INVOICING.INVOICE.CANCELLED",
  "PAYMENT.CAPTURE.COMPLETED",
];

const existing = await pp("GET", "/v1/notifications/webhooks");
const match = existing.body?.webhooks?.find((w) => w.url === url);
if (match) {
  console.log(`Webhook already registered for ${url}`);
  console.log(`PAYPAL_WEBHOOK_ID=${match.id}`);
  process.exit(0);
}

const res = await pp("POST", "/v1/notifications/webhooks", {
  url,
  event_types: eventTypes.map((name) => ({ name })),
});
if (res.status >= 300) {
  console.error(`Failed: HTTP ${res.status}`, JSON.stringify(res.body, null, 2));
  process.exit(1);
}
console.log(`Registered ${url}`);
console.log(`Events: ${res.body.event_types.map((e) => e.name).join(", ")}`);
console.log(`PAYPAL_WEBHOOK_ID=${res.body.id}`);
