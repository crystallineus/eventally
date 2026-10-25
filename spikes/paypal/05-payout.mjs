// Spike 3: can the landlord (sandbox Business) pay a tenant back immediately via Payouts?
// Sends $240.00 to the sandbox buyer, then polls the batch until it settles.
// Usage: node --env-file=.env spikes/paypal/05-payout.mjs
import { pp, saveResult } from "./lib.mjs";

const batchId = `eventally-spike-${Date.now()}`;
const created = await pp("POST", "/v1/payments/payouts", {
  sender_batch_header: {
    sender_batch_id: batchId, // PayPal rejects a reused id, which doubles as idempotency
    email_subject: "Repair reimbursement",
    email_message: "Reimbursement for the kitchen sink repair you paid for.",
  },
  items: [
    {
      recipient_type: "EMAIL",
      receiver: process.env.PAYPAL_SANDBOX_BUYER_EMAIL,
      amount: { value: "240.00", currency: "USD" }, // note: Payouts uses `currency`, not `currency_code`
      note: "Kitchen sink repair – claim #demo",
      sender_item_id: "claim-demo-1",
    },
  ],
});
console.log(`Create: HTTP ${created.status}`);
if (created.status >= 300) {
  console.error(JSON.stringify(created.body, null, 2));
  saveResult("05-payout", { created });
  process.exit(1);
}

const payoutBatchId = created.body.batch_header.payout_batch_id;
console.log(`Batch ${payoutBatchId}  status=${created.body.batch_header.batch_status}`);

let batch;
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  batch = (await pp("GET", `/v1/payments/payouts/${payoutBatchId}`)).body;
  const item = batch.items?.[0];
  console.log(`  poll ${i + 1}: batch=${batch.batch_header.batch_status}  item=${item?.transaction_status}`);
  if (!["PENDING", "PROCESSING"].includes(batch.batch_header.batch_status)) break;
}

const item = batch.items?.[0];
console.log(`\nFinal: batch=${batch.batch_header.batch_status}  item=${item?.transaction_status}`);
console.log(`Amount ${item?.payout_item?.amount?.value}  fee ${item?.payout_item_fee?.value ?? "n/a"}  errors ${JSON.stringify(item?.errors ?? null)}`);
console.log("Saved:", saveResult("05-payout", { created: created.body, final: batch }));
