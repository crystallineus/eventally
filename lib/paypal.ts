import { toApiValue, type Cents } from "@/lib/money";

// Thin PayPal REST client (sandbox by default). Shapes were verified against the sandbox in
// spikes/paypal/: negative line items are allowed, a negative invoice total is not.

const BASE = process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com";

let token: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new PayPalError(`OAuth failed (${res.status})`, res.status, await res.text());
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return token.value;
}

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = parsed?.details?.[0]?.issue ?? parsed?.name ?? res.statusText;
    throw new PayPalError(`PayPal ${method} ${path} failed (${res.status}): ${detail}`, res.status, parsed);
  }
  return parsed as T;
}

const usd = (cents: Cents) => ({ currency_code: "USD", value: toApiValue(cents) });

export type PayPalInvoice = {
  id: string;
  status: string;
  detail: { invoice_number?: string; metadata?: { recipient_view_url?: string } };
  amount?: { value: string };
  payments?: { paid_amount?: { value: string }; transactions?: { payment_id: string; amount: { value: string } }[] };
};

export type NewInvoice = {
  /** Our invoice row id; doubles as PayPal's idempotency key so a retry never creates a second invoice. */
  requestId: string;
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  note: string;
  invoicerEmail: string;
  recipientEmail: string;
  lines: { name: string; amountCents: Cents }[];
};

/** Create a draft invoice, send it to the tenant, and return it with the payer link. */
export async function createAndSendInvoice(input: NewInvoice): Promise<PayPalInvoice> {
  const draft = await call<PayPalInvoice>(
    "POST",
    "/v2/invoicing/invoices",
    {
      detail: {
        currency_code: "USD",
        invoice_number: input.invoiceNumber,
        invoice_date: input.invoiceDate,
        payment_term: { due_date: input.dueDate },
        note: input.note,
      },
      invoicer: { email_address: input.invoicerEmail },
      primary_recipients: [{ billing_info: { email_address: input.recipientEmail } }],
      items: input.lines.map((l) => ({ name: l.name.slice(0, 200), quantity: "1", unit_amount: usd(l.amountCents), unit_of_measure: "AMOUNT" })),
    },
    { "PayPal-Request-Id": input.requestId },
  );
  if (draft.status === "DRAFT") {
    await call("POST", `/v2/invoicing/invoices/${draft.id}/send`, { send_to_recipient: true }, { "PayPal-Request-Id": `${input.requestId}-send` });
  }
  return getInvoice(draft.id);
}

export function getInvoice(id: string): Promise<PayPalInvoice> {
  return call<PayPalInvoice>("GET", `/v2/invoicing/invoices/${encodeURIComponent(id)}`);
}

/**
 * Ask PayPal whether a webhook delivery is genuine. The raw body is spliced in unchanged:
 * re-serializing the parsed event can alter bytes and make verification fail.
 */
export async function verifyWebhook(headers: Headers, rawBody: string): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("PAYPAL_WEBHOOK_ID must be set to verify webhooks");
  const meta = {
    auth_algo: headers.get("paypal-auth-algo"),
    cert_url: headers.get("paypal-cert-url"),
    transmission_id: headers.get("paypal-transmission-id"),
    transmission_sig: headers.get("paypal-transmission-sig"),
    transmission_time: headers.get("paypal-transmission-time"),
    webhook_id: webhookId,
  };
  if (Object.values(meta).some((v) => !v)) return false;
  const body = `${JSON.stringify(meta).slice(0, -1)},"webhook_event":${rawBody}}`;
  try {
    const result = await call<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", body);
    return result.verification_status === "SUCCESS";
  } catch (err) {
    // PayPal rejects forged headers (e.g. a foreign cert_url) with a 4xx instead of FAILURE.
    if (err instanceof PayPalError && err.status < 500) return false;
    throw err;
  }
}

// ---- Payouts (landlord pays a tenant back right away) ----------------------------------------
// Note: Payouts amounts use `currency`, not Invoicing's `currency_code`.

export type PayoutBatch = {
  batch_header: { payout_batch_id: string; batch_status: string };
  items?: { payout_item_id: string; transaction_status: string; errors?: { name?: string; message?: string } }[];
};

/**
 * Send one payout. `senderBatchId` must be unique per payout: PayPal rejects a reused id,
 * which is what stops a retry from paying twice.
 */
export function createPayout(input: { senderBatchId: string; receiverEmail: string; amountCents: Cents; subject: string; note: string }) {
  return call<PayoutBatch>("POST", "/v1/payments/payouts", {
    sender_batch_header: { sender_batch_id: input.senderBatchId, email_subject: input.subject, email_message: input.note },
    items: [
      {
        recipient_type: "EMAIL",
        receiver: input.receiverEmail,
        amount: { value: toApiValue(input.amountCents), currency: "USD" },
        note: input.note,
        sender_item_id: input.senderBatchId,
      },
    ],
  });
}

export function getPayout(batchId: string) {
  return call<PayoutBatch>("GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}`);
}
