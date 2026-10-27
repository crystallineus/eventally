// Spike 2c: send the demo invoice ($2,000 rent − $240 credit + $45 surcharge = $1,805) to the sandbox buyer.
// Usage: node --env-file=.env spikes/paypal/04-send-invoice.mjs
// Then open the printed payer URL, log in as the sandbox Personal account, and pay.
import { pp, usd, saveResult } from "./lib.mjs";

const item = (name, cents) => ({ name, quantity: "1", unit_amount: usd(cents), unit_of_measure: "AMOUNT" });

const created = await pp("POST", "/v2/invoicing/invoices", {
  detail: {
    currency_code: "USD",
    note: "December rent with approved repair adjustments. Details are in your EvenTally ledger.",
    memo: "eventally spike 2",
  },
  invoicer: { email_address: process.env.PAYPAL_SANDBOX_MERCHANT_EMAIL },
  primary_recipients: [{ billing_info: { email_address: process.env.PAYPAL_SANDBOX_BUYER_EMAIL } }],
  items: [
    item("Rent – December 2026", 200000),
    item("Credit: kitchen sink repair (paid by tenant)", -24000),
    item("Charge: window screen repair (tenant share)", 4500),
  ],
});
if (created.status >= 300) {
  console.error(`Create failed: HTTP ${created.status}`, JSON.stringify(created.body, null, 2));
  process.exit(1);
}
const id = created.body.id;
console.log(`Created ${id}  total=${created.body.amount.value}`);

const sent = await pp("POST", `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: true });
if (sent.status >= 300) {
  console.error(`Send failed: HTTP ${sent.status}`, JSON.stringify(sent.body, null, 2));
  process.exit(1);
}

const invoice = (await pp("GET", `/v2/invoicing/invoices/${id}`)).body;
const payerUrl = invoice.detail?.metadata?.recipient_view_url ?? sent.body?.href;
console.log(`Sent. status=${invoice.status}`);
console.log(`Payer URL: ${payerUrl}`);
console.log("Saved:", saveResult("04-sent-invoice", invoice));
