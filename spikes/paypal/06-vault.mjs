// Spike 4: PayPal Vault without purchase, then a merchant-initiated charge with the saved PayPal.
// Steps (run in order):
//   node --env-file=.env spikes/paypal/06-vault.mjs setup              -> prints an approve link for the buyer
//   node --env-file=.env spikes/paypal/06-vault.mjs token <setupId>    -> saves the approved PayPal, prints vault id
//   node --env-file=.env spikes/paypal/06-vault.mjs charge <vaultId> 1.00  -> pays without the buyer logging in
import { pp, saveResult } from "./lib.mjs";

const [step, arg, amount = "1.00"] = process.argv.slice(2);

if (step === "setup") {
  const res = await pp("POST", "/v3/vault/setup-tokens", {
    payment_source: {
      paypal: {
        description: "EvenTally rent payments",
        usage_type: "MERCHANT",
        customer_type: "CONSUMER",
        experience_context: {
          brand_name: "EvenTally",
          return_url: "https://example.com/eventally/vault/return",
          cancel_url: "https://example.com/eventally/vault/cancel",
          shipping_preference: "NO_SHIPPING",
        },
      },
    },
  });
  console.log(`setup-tokens: HTTP ${res.status}`);
  if (res.status >= 300) console.log(JSON.stringify(res.body, null, 2));
  else {
    console.log(`setup token: ${res.body.id}  status: ${res.body.status}`);
    console.log(`approve link: ${res.body.links?.find((l) => l.rel === "approve")?.href}`);
  }
  saveResult("06-vault-setup", res);
} else if (step === "token") {
  const res = await pp("POST", "/v3/vault/payment-tokens", { payment_source: { token: { id: arg, type: "SETUP_TOKEN" } } });
  console.log(`payment-tokens: HTTP ${res.status}`);
  console.log(res.status >= 300 ? JSON.stringify(res.body, null, 2) : `vault id: ${res.body.id}  customer: ${res.body.customer?.id}  payer: ${res.body.payment_source?.paypal?.email_address}`);
  saveResult("06-vault-token", res);
} else if (step === "charge") {
  const order = await pp("POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [{ amount: { currency_code: "USD", value: amount }, description: "EvenTally spike: vaulted charge" }],
    payment_source: { paypal: { vault_id: arg } },
  }, { "PayPal-Request-Id": `eventally-spike-${Date.now()}` });
  console.log(`create order: HTTP ${order.status}  status: ${order.body?.status}`);
  let final = order;
  if (order.status < 300 && order.body.status !== "COMPLETED") {
    final = await pp("POST", `/v2/checkout/orders/${order.body.id}/capture`, {});
    console.log(`capture: HTTP ${final.status}  status: ${final.body?.status}`);
  }
  const capture = final.body?.purchase_units?.[0]?.payments?.captures?.[0];
  console.log(final.status >= 300 ? JSON.stringify(final.body, null, 2) : `capture ${capture?.id}: ${capture?.status} ${capture?.amount?.value}`);
  saveResult("06-vault-charge", { order, final });
} else {
  console.log("usage: setup | token <setupTokenId> | charge <vaultId> [amount]");
}
