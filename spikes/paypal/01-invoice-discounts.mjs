// Spike 1: can a PayPal invoice express a rent credit?
// Creates DRAFT invoices only (nothing is sent), prints totals, then deletes the drafts.
// Usage: node --env-file=.env spikes/paypal/01-invoice-discounts.mjs
import { pp, usd, saveResult } from "./lib.mjs";

const merchant = process.env.PAYPAL_SANDBOX_MERCHANT_EMAIL;
const buyer = process.env.PAYPAL_SANDBOX_BUYER_EMAIL;

const rent = (cents = 200000) => ({
  name: "Rent – December 2026",
  quantity: "1",
  unit_amount: usd(cents),
  unit_of_measure: "AMOUNT",
});
const surcharge = { name: "Window screen repair (tenant share)", quantity: "1", unit_amount: usd(4500), unit_of_measure: "AMOUNT" };

function invoice({ items, invoiceDiscountCents, note }) {
  const body = {
    detail: { currency_code: "USD", note, memo: "eventally spike – safe to delete" },
    invoicer: { email_address: merchant },
    primary_recipients: [{ billing_info: { email_address: buyer } }],
    items,
  };
  if (invoiceDiscountCents != null) {
    body.amount = { breakdown: { discount: { invoice_discount: { amount: usd(invoiceDiscountCents) } } } };
  }
  return body;
}

const cases = [
  {
    id: "A_invoice_discount",
    expect: "total 1805.00",
    body: invoice({ items: [rent(), surcharge], invoiceDiscountCents: 24000, note: "Credit: kitchen sink repair $240.00" }),
  },
  {
    id: "B_negative_item",
    expect: "probably rejected",
    trySend: true,
    body: invoice({
      items: [rent(), surcharge, { name: "Credit: kitchen sink repair", quantity: "1", unit_amount: usd(-24000), unit_of_measure: "AMOUNT" }],
    }),
  },
  {
    id: "C_item_discount_on_rent",
    expect: "total 1805.00",
    body: invoice({ items: [{ ...rent(), discount: { amount: usd(24000) } }, surcharge] }),
  },
  {
    id: "D_two_credits_two_item_discounts",
    expect: "can each credit be its own line? total 1765.00",
    body: invoice({
      items: [
        { ...rent(), discount: { amount: usd(24000) } },
        { ...surcharge, discount: { amount: usd(4000) } }, // tests discount on a different line
      ],
    }),
  },
  {
    id: "E_credit_exceeds_rent",
    expect: "total would be negative – rejected or clamped?",
    trySend: true,
    body: invoice({ items: [rent()], invoiceDiscountCents: 250000 }),
  },
  {
    id: "F_zero_total",
    expect: "credit equals rent – can a $0 invoice exist?",
    trySend: true,
    body: invoice({ items: [rent()], invoiceDiscountCents: 200000 }),
  },
];

const results = [];
for (const c of cases) {
  const res = await pp("POST", "/v2/invoicing/invoices", c.body);
  const id = res.body?.id;
  const summary = {
    case: c.id,
    expect: c.expect,
    status: res.status,
    total: res.body?.amount?.value ?? null,
    breakdown: res.body?.amount?.breakdown ?? null,
    error: res.status >= 300 ? { name: res.body?.name, message: res.body?.message, details: res.body?.details } : null,
  };
  results.push({ ...summary, response: res.body });
  console.log(`\n[${c.id}] HTTP ${res.status}  total=${summary.total}  (expect: ${c.expect})`);
  if (summary.error) console.log("  error:", JSON.stringify(summary.error));
  else console.log("  breakdown:", JSON.stringify(summary.breakdown));

  // Drafts are loosely validated; sending is where PayPal may reject. Cancel right after a successful send.
  if (id && c.trySend) {
    const sent = await pp("POST", `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: true });
    results.at(-1).send = { status: sent.status, body: sent.body };
    console.log(`  send: HTTP ${sent.status}`, sent.status >= 300 ? JSON.stringify({ name: sent.body?.name, details: sent.body?.details }) : "");
    if (sent.status < 300) {
      const cancel = await pp("POST", `/v2/invoicing/invoices/${id}/cancel`, { send_to_recipient: false, send_to_invoicer: false });
      console.log(`  cancelled: HTTP ${cancel.status}`);
      continue;
    }
  }

  if (id) {
    const del = await pp("DELETE", `/v2/invoicing/invoices/${id}`);
    console.log(`  draft ${id} deleted: HTTP ${del.status}`);
  }
}

console.log("\nSaved:", saveResult("01-invoice-discounts", results));
