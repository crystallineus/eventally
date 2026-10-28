import Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { explainClaim, explainMonth, listClaims, listTodos } from "@/lib/assistant/context";
import { runToolkitTool, toolkitTools, trimInvoice } from "@/lib/assistant/paypal-toolkit";
import { db, schema } from "@/lib/db";
import { amountsIn, unknownAmounts } from "@/lib/guard";
import { formatUsd, parseUsd, type Cents } from "@/lib/money";
import { ASSISTANT } from "@/lib/persona";
import { formatPeriod } from "@/lib/period";
import { todayInAppZone } from "@/lib/time";

// Aunt Tally as a chat assistant for one lease: explain a bill, list what's waiting on you, look an
// invoice up in PayPal (Agent Toolkit), and, for the landlord, propose a payment reminder that only
// goes out after they press Confirm. Conversations stay private to the person asking; only actions
// (a reminder sent) are written to the shared events log, by the confirm endpoint.

const MODEL = process.env.ASSISTANT_MODEL || process.env.REVIEW_MODEL || "claude-opus-5-5";
const FALLBACK = MODEL.startsWith("claude-haiku") ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
const MAX_TURNS = 6;
const client = new Anthropic();

type Lease = typeof schema.leases.$inferSelect;
type Role = "landlord" | "tenant";
export type ChatMessage = { role: "user" | "assistant"; text: string };
export type PendingReminder = { type: "send_reminder"; invoiceId: string; paypalInvoiceId: string; month: string; amount: string; note: string };
export type ChatReply = { text: string; pending?: PendingReminder };

const OWN_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "explain_month",
    description:
      "Everything on the EvenTally ledger for one month: rent, payments, repair charges and credits, PayPal payouts, and the rent invoice if one was sent, with the claim behind each line. Leave period out for the latest month; the month after the last billed one shows the next invoice preview.",
    input_schema: { type: "object", properties: { period: { type: "string", description: "Month as YYYY-MM" } } },
  },
  {
    name: "list_claims",
    description: "All repair claims on this lease with their status, amounts and links.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "explain_claim",
    description:
      "One repair claim in detail: who paid up front, the proposed or agreed split and why, approvals, Aunt Tally's review results, any evidence request, payout, and the next step for the person asking.",
    input_schema: {
      type: "object",
      properties: { claim: { type: "string", description: "Claim title words (e.g. \"range hood\") or its claim_id" } },
      required: ["claim"],
    },
  },
  {
    name: "list_todos",
    description: "What's waiting on the person you're talking to on this lease, most urgent first, each with a link.",
    input_schema: { type: "object", properties: {} },
  },
];

const REMINDER_TOOL: Anthropic.Beta.BetaTool = {
  name: "propose_reminder",
  description:
    "Landlord only. Prepare a PayPal payment reminder for an unpaid rent invoice on this lease. It is NOT sent: the landlord sees a Confirm button. Use only when the landlord asks for a reminder.",
  input_schema: {
    type: "object",
    properties: {
      paypal_invoice_id: { type: "string" },
      note: { type: "string", description: "A short, friendly note to the tenant (under 200 characters)" },
    },
    required: ["paypal_invoice_id", "note"],
  },
};

function systemPrompt(lease: Lease, role: Role, names: { me: string; other: string }) {
  return `You are ${ASSISTANT.name} (full name ${ASSISTANT.fullName}), the AI assistant in the EvenTally app, an elephant auntie who keeps the ledger. You are an AI, not a person; never claim or imply otherwise. Your voice is warm, plain and calm, never cutesy about money, and on nobody's side.

You're talking with ${names.me}, the ${role} on "${lease.propertyName}" (the ${role === "landlord" ? "tenant" : "landlord"} is ${names.other}). Rent is ${formatUsd(lease.rentCents)} a month, due on day ${lease.dueDay}. Today is ${todayInAppZone()} (Pacific time).

You can explain any month on the ledger line by line, explain a repair claim and where it stands, list what's waiting on ${names.me}, and look an invoice up in PayPal.${role === "landlord" ? " You can also prepare a payment reminder; it only goes out after the landlord presses Confirm." : ""}

Rules:
- Look things up with your tools before answering; don't guess.
- Every dollar amount you write must come from a tool result.
- You can't change anything: no splits, invoices, payouts or approvals. Point to the page where the person can do it, using links from tool results written as [text](/path).
- No legal advice. If asked who should pay for a repair, say each claim is settled by both people approving a split.
- Agreed splits, sent invoices and paid invoices are final. Explain them; don't question them or suggest re-checking. A claim's "background" is the reasoning both sides already accepted.
- "Paid up front by" is who paid the repair bill; the agreed split is who bears the cost. They often differ, and that's expected.
- Don't describe how you looked things up or which tools you used; just answer.
- Keep answers short: a few sentences or a short list.`;
}

export async function chat(user: { id: string; name: string }, lease: Lease, history: ChatMessage[]): Promise<ChatReply> {
  const role: Role = lease.landlordId === user.id ? "landlord" : "tenant";
  const [other] = await db()
    .select({ name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, (role === "landlord" ? lease.tenantId : lease.landlordId) ?? lease.landlordId));
  const leaseInvoices = await db().select().from(schema.invoices).where(eq(schema.invoices.leaseId, lease.id));
  const ownsInvoice = (paypalId: unknown) => leaseInvoices.find((i) => i.paypalInvoiceId && i.paypalInvoiceId === paypalId);

  const tools = [
    ...OWN_TOOLS,
    ...toolkitTools(role === "landlord" ? ["get_invoice", "search_invoicing"] : ["get_invoice"]),
    ...(role === "landlord" ? [REMINDER_TOOL] : []),
  ];
  const known = new Set<Cents>([lease.rentCents]);
  const learn = (value: unknown) => {
    const text = JSON.stringify(value);
    for (const c of amountsIn(text)) known.add(Math.abs(c));
    for (const m of text.matchAll(/"(-?\d+\.\d{2})"/g)) known.add(Math.abs(parseUsd(m[1])));
  };
  let pending: PendingReminder | undefined;

  async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "explain_month":
        return explainMonth(lease, typeof input.period === "string" ? input.period : undefined);
      case "list_claims":
        return listClaims(lease);
      case "explain_claim":
        return explainClaim(lease, role, String(input.claim ?? ""));
      case "list_todos":
        return { todos: await listTodos(lease, role) };
      case "get_invoice": {
        // Only invoices on this lease: a tenant must never see another tenant's invoice.
        if (!ownsInvoice(input.invoice_id)) return { error: "That invoice isn't on this lease." };
        return trimInvoice(await runToolkitTool("get_invoice", input));
      }
      case "search_invoicing": {
        const raw = (await runToolkitTool("search_invoicing", input)) as { items?: unknown[] };
        const items = (raw?.items ?? []).map(trimInvoice).filter((i) => ownsInvoice((i as { paypal_invoice_id?: string }).paypal_invoice_id));
        return { invoices: items };
      }
      case "propose_reminder": {
        if (role !== "landlord") return { error: "Only the landlord can send reminders." };
        const invoice = ownsInvoice(input.paypal_invoice_id);
        if (!invoice || invoice.status !== "sent") return { error: "Reminders are only for an unpaid invoice that was sent on this lease." };
        const note = String(input.note ?? "").slice(0, 200);
        // The tenant reads this note, so it goes through the money guard too.
        const wrong = unknownAmounts(note, known.add(invoice.totalCents));
        if (wrong.length) return { error: `These amounts in the note don't match the invoice: ${wrong.join(", ")}. Rewrite the note.` };
        pending = { type: "send_reminder", invoiceId: invoice.id, paypalInvoiceId: invoice.paypalInvoiceId!, month: formatPeriod(invoice.period), amount: formatUsd(invoice.totalCents), note };
        return { status: "waiting for the landlord to press Confirm", month: pending.month, amount: pending.amount, note };
      }
      default:
        return { error: `Unknown tool ${name}` };
    }
  }

  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(-20).map((m) => ({ role: m.role, content: m.text.slice(0, 2000) }));
  let retriedGuard = false;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      ...FALLBACK,
      output_config: { effort: "low" },
      system: systemPrompt(lease, role, { me: user.name, other: other?.name ?? "the other side" }),
      tools,
      messages,
    });
    if (response.stop_reason === "refusal") return { text: "I can't help with that one. Your ledger and claims pages have everything on this lease." };
    messages.push({ role: "assistant", content: response.content });

    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (calls.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      // Money guard: every amount she writes has to come from what the tools returned.
      const unknown = unknownAmounts(text, known);
      if (unknown.length && !retriedGuard) {
        retriedGuard = true;
        messages.push({ role: "user", content: `(System check: these amounts don't match the ledger or PayPal: ${unknown.join(", ")}. Rewrite your answer using only amounts from tool results.)` });
        continue;
      }
      if (unknown.length) return { text: "I couldn't double-check some of those numbers, so I'd rather not guess. The ledger page has the exact amounts." };
      return { text: text || "I'm not sure. Try asking another way?", pending };
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      try {
        const result = await runTool(call.name, (call.input ?? {}) as Record<string, unknown>);
        learn(result);
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) });
      } catch (err) {
        results.push({ type: "tool_result", tool_use_id: call.id, content: err instanceof Error ? err.message : String(err), is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { text: "That took me too many steps. Could you ask a simpler question?", pending };
}

/** Landlord pressed Confirm: send the PayPal reminder through the Agent Toolkit and log it for both sides. */
export async function sendReminder(user: { id: string; name: string }, lease: Lease, invoiceId: string, note: string) {
  if (lease.landlordId !== user.id) throw new Error("Only the landlord can send reminders");
  const [invoice] = await db()
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.leaseId, lease.id)));
  if (!invoice?.paypalInvoiceId || invoice.status !== "sent") throw new Error("That invoice isn't waiting for payment");
  const result = (await runToolkitTool("send_invoice_reminder", {
    invoice_id: invoice.paypalInvoiceId,
    subject: `Reminder: ${formatPeriod(invoice.period)} rent`,
    note: note.slice(0, 200),
  })) as { ok?: boolean; message?: string } | string;
  if (typeof result === "object" && result?.ok === false) throw new Error(result.message ?? "PayPal didn't send the reminder");
  await db().insert(schema.events).values({
    leaseId: lease.id,
    actor: "landlord",
    type: "invoice.reminder_sent",
    data: { by: user.name, period: formatPeriod(invoice.period), note: note.slice(0, 200), via: "Aunt Tally (PayPal Agent Toolkit)" },
  });
}
