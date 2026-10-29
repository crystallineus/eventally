import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { prepareAction, type Action, type Attachment, type Pending } from "@/lib/assistant/actions";
import { explainClaim, explainMonth, listClaims, listTodos } from "@/lib/assistant/context";
import { runToolkitTool, toolkitTools, trimInvoice } from "@/lib/assistant/paypal-toolkit";
import { db, schema } from "@/lib/db";
import { amountsIn, unknownAmounts } from "@/lib/guard";
import { formatUsd, parseUsd, type Cents } from "@/lib/money";
import { ASSISTANT } from "@/lib/persona";
import { NOTIFY_LABEL, NOTIFY_LEVELS, type NotifyLevel } from "@/lib/notifications-shared";
import { formatLeaseTerm } from "@/lib/period";
import { todayInAppZone } from "@/lib/time";

// Aunt Tally as a chat assistant for one lease. She looks things up (ledger months, claims, to-dos,
// the lease, PayPal invoices via the Agent Toolkit) and prepares actions on the person's behalf:
// submitting a claim, approving, proposing a split, paying a claim back, sending an invoice or a
// reminder. Preparing only returns a confirmation card; nothing happens until the person presses it
// (lib/assistant/actions.ts performAction). Conversations stay private to the person asking; only
// confirmed actions reach the shared events log, marked "via Aunt Tally".

const MODEL = process.env.ASSISTANT_MODEL || process.env.REVIEW_MODEL || "claude-opus-5-5";
const FALLBACK = MODEL.startsWith("claude-haiku") ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
const MAX_TURNS = 6;
const client = new Anthropic();

type Lease = typeof schema.leases.$inferSelect;
type Role = "landlord" | "tenant";
export type ChatMessage = { role: "user" | "assistant"; text: string };
export type ChatReply = { text: string; pending?: Pending };

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

const LEASE_TOOL: Anthropic.Beta.BetaTool = {
  name: "get_lease",
  description: "The lease terms: property, rent, deposit, due day, term and the repair clause word for word.",
  input_schema: { type: "object", properties: {} },
};

const claimRef = { claim: { type: "string", description: "Claim title words (e.g. \"range hood\") or its claim_id" } } as const;

/** Tools that only prepare an action and show a confirmation card. Name -> action kind, and who may use it. */
const ACTION_TOOLS: { tool: Anthropic.Beta.BetaTool; kind: Action["kind"]; roles: Role[] }[] = [
  {
    kind: "create_claim",
    roles: ["landlord", "tenant"],
    tool: {
      name: "prepare_claim",
      description:
        "Prepare a new repair claim from what they told you. Needs a short title and the receipt total; the description, the date the problem was reported, and photos attached in the chat are added if known. Shows a Submit card.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title, e.g. \"Kitchen sink leak\"" },
          description: { type: "string", description: "What broke and what was done, in their words" },
          issue_date: { type: "string", description: "Date the problem was reported, YYYY-MM-DD" },
          amount: { type: "string", description: "Receipt total in dollars, e.g. \"240.00\"" },
          wants_payout: { type: "boolean", description: "Tenant only: they want to be paid back right away via PayPal" },
        },
        required: ["title", "amount"],
      },
    },
  },
  { kind: "add_evidence", roles: ["landlord", "tenant"], tool: { name: "prepare_add_photos", description: "Prepare adding the photos attached in the chat to an open claim.", input_schema: { type: "object", properties: claimRef, required: ["claim"] } } },
  { kind: "approve_split", roles: ["landlord", "tenant"], tool: { name: "prepare_approve", description: "Prepare approving the proposed split on a claim.", input_schema: { type: "object", properties: claimRef, required: ["claim"] } } },
  {
    kind: "propose_split",
    roles: ["landlord", "tenant"],
    tool: {
      name: "prepare_propose_split",
      description: "Prepare proposing a different split on an open claim, with their reason.",
      input_schema: {
        type: "object",
        properties: { ...claimRef, landlord_percent: { type: "number", description: "Share the landlord bears, 0-100" }, rationale: { type: "string", description: "One or two sentences, in their words" } },
        required: ["claim", "landlord_percent", "rationale"],
      },
    },
  },
  { kind: "withdraw_claim", roles: ["landlord", "tenant"], tool: { name: "prepare_withdraw", description: "Prepare withdrawing a claim they submitted.", input_schema: { type: "object", properties: claimRef, required: ["claim"] } } },
  {
    kind: "change_amount",
    roles: ["landlord", "tenant"],
    tool: { name: "prepare_change_amount", description: "Prepare correcting the amount on a claim they submitted.", input_schema: { type: "object", properties: { ...claimRef, amount: { type: "string" } }, required: ["claim", "amount"] } },
  },
  {
    kind: "set_payout_preference",
    roles: ["tenant"],
    tool: {
      name: "prepare_payback_preference",
      description: "Tenant: prepare asking to be paid back right away via PayPal (or switching back to a rent credit) on a claim they submitted.",
      input_schema: { type: "object", properties: { ...claimRef, wants_payout: { type: "boolean" } }, required: ["claim", "wants_payout"] },
    },
  },
  { kind: "request_review", roles: ["landlord", "tenant"], tool: { name: "prepare_review", description: "Prepare asking you (Aunt Tally) to review a claim again after changes.", input_schema: { type: "object", properties: claimRef, required: ["claim"] } } },
  { kind: "pay_back_now", roles: ["landlord"], tool: { name: "prepare_pay_back_now", description: "Landlord: prepare paying the tenant back now via PayPal Payouts on an approved claim.", input_schema: { type: "object", properties: claimRef, required: ["claim"] } } },
  { kind: "send_next_invoice", roles: ["landlord"], tool: { name: "prepare_send_invoice", description: "Landlord: prepare sending next month's rent invoice through PayPal.", input_schema: { type: "object", properties: {} } } },
  {
    kind: "set_notifications",
    roles: ["landlord", "tenant"],
    tool: {
      name: "prepare_notifications",
      description: "Prepare changing what shows up under their notification bell.",
      input_schema: {
        type: "object",
        properties: { level: { type: "string", enum: [...NOTIFY_LEVELS], description: "important = only things that need them; all = every update; off = nothing" } },
        required: ["level"],
      },
    },
  },
  {
    kind: "pay_invoice",
    roles: ["tenant"],
    tool: {
      name: "prepare_pay_invoice",
      description: "Tenant: prepare paying the rent invoice that's waiting for payment, with the PayPal they saved for rent. Shows a Pay card.",
      input_schema: { type: "object", properties: {} },
    },
  },
  {
    kind: "send_reminder",
    roles: ["landlord"],
    tool: {
      name: "prepare_reminder",
      description: "Landlord: prepare a PayPal payment reminder for an unpaid rent invoice on this lease.",
      input_schema: {
        type: "object",
        properties: { paypal_invoice_id: { type: "string" }, note: { type: "string", description: "A short, friendly note to the tenant (under 200 characters)" } },
        required: ["paypal_invoice_id", "note"],
      },
    },
  },
];

function systemPrompt(lease: Lease, role: Role, names: { me: string; other: string }, savedPayPal: string | null, notify: NotifyLevel) {
  return `You are ${ASSISTANT.name} (full name ${ASSISTANT.fullName}), the AI assistant in the EvenTally app, an elephant auntie who keeps the ledger. You are an AI, not a person; never claim or imply otherwise. Your voice is warm, plain and calm, never cutesy about money, and on nobody's side.

You're talking with ${names.me}, the ${role} on "${lease.propertyName}" (the ${role === "landlord" ? "tenant" : "landlord"} is ${names.other}). Rent is ${formatUsd(lease.rentCents)} a month, due on day ${lease.dueDay}. Today is ${todayInAppZone()} (Pacific time).

You can explain any month on the ledger line by line, explain a repair claim and where it stands, quote the lease, list what's waiting on ${names.me}, and look an invoice up in PayPal. You can also do things for ${names.me}: submit a claim, add photos, approve or propose a split, withdraw, change an amount${role === "tenant" ? ", ask to be paid back right away, pay a rent invoice with their saved PayPal" : ", pay a claim back via PayPal, send the next rent invoice, send a payment reminder"}, or ask for a new review.

Rules:
- Look things up with your tools before answering; don't guess.
- Every dollar amount you write must come from a tool result or from what ${names.me} told you.
- Doing things: your prepare_* tools only show a confirmation card. Nothing happens until ${names.me} presses its button, so never say it's done; say what the card will do and ask them to check it. When they ask you to do something, prepare the card right away instead of asking "shall I?": the card is how they confirm. Only one card shows at a time. Your messages starting with ✓ or ✗ were written by the app after the person pressed a card: ✓ means it really happened, ✗ means it failed. You can only act for ${names.me}, never for ${names.other}.
- Submitting a claim: you need what was repaired, the receipt total, what happened, when it was reported, and photos (a receipt; before/after if they have them, attached with the paperclip button).${role === "tenant" ? " Also ask whether they'd like to be paid back right away via PayPal or credited on the next rent invoice." : ""} Ask for anything missing, a couple of things at a time. After three rounds of asking, prepare the claim with what you have; your review will ask for anything still missing.
- After a review, tell them what it found and offer the next step: approve the split, propose a different one, add evidence, or withdraw.
- Notifications: ${names.me}'s bell is set to "${NOTIFY_LABEL[notify]}". After they submit a claim, approve, or propose a split, say they'll see it under the bell when ${names.other} responds${notify === "off" ? `; since their notifications are off, ask if they'd like "${NOTIFY_LABEL.important}" turned on` : ""}.${role === "tenant" ? `
- Paying rent: ${savedPayPal ? `${names.me} saved their PayPal (${savedPayPal}) for rent, so you can prepare a Pay card when a rent invoice is waiting. When they ask what they owe, list the unpaid invoice and the approved claims on it, then ask if they'd like to pay it now.` : `${names.me} hasn't saved a PayPal for rent. They can pay with the invoice's Pay with PayPal button, or press "Save my PayPal for rent" on the [ledger](/ledger) once so you can pay for them next time.`}` : ""}
- Link to pages with links from tool results, written as [text](/path).
- No legal advice. If asked who should pay for a repair, say each claim is settled by both people approving a split.
- Agreed splits, sent invoices and paid invoices are final. Explain them; don't question them or suggest re-checking. A claim's "background" is the reasoning both sides already accepted.
- "Paid up front by" is who paid the repair bill; the agreed split is who bears the cost. They often differ, and that's expected.
- Don't describe how you looked things up or which tools you used; just answer.
- Keep answers short: a few sentences or a short list.`;
}

export async function chat(user: { id: string; name: string; paypalVaultId?: string | null; paypalVaultEmail?: string | null; notify?: NotifyLevel }, lease: Lease, history: ChatMessage[], attachments: Attachment[] = []): Promise<ChatReply> {
  const role: Role = lease.landlordId === user.id ? "landlord" : "tenant";
  const [other] = await db()
    .select({ name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, (role === "landlord" ? lease.tenantId : lease.landlordId) ?? lease.landlordId));
  const leaseInvoices = await db().select().from(schema.invoices).where(eq(schema.invoices.leaseId, lease.id));
  const ownsInvoice = (paypalId: unknown) => leaseInvoices.find((i) => i.paypalInvoiceId && i.paypalInvoiceId === paypalId);

  const actionTools = ACTION_TOOLS.filter((a) => a.roles.includes(role));
  const tools = [
    ...OWN_TOOLS,
    LEASE_TOOL,
    ...toolkitTools(role === "landlord" ? ["get_invoice", "search_invoicing"] : ["get_invoice"]),
    ...actionTools.map((a) => a.tool),
  ];
  const known = new Set<Cents>([lease.rentCents]);
  const learn = (value: unknown) => {
    const text = JSON.stringify(value);
    for (const c of amountsIn(text)) known.add(Math.abs(c));
    for (const m of text.matchAll(/"(-?\d+\.\d{2})"/g)) known.add(Math.abs(parseUsd(m[1])));
  };
  let pending: Pending | undefined;

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
      case "get_lease":
        return {
          property: lease.propertyName,
          address: lease.address,
          rent: formatUsd(lease.rentCents),
          deposit: formatUsd(lease.depositCents),
          due_day: lease.dueDay,
          term: formatLeaseTerm(lease.startDate, lease.endDate),
          repair_clause: lease.repairClause,
        };
      default: {
        const spec = actionTools.find((a) => a.tool.name === name);
        if (!spec) return { error: `Unknown tool ${name}` };
        // Text the other side will read goes through the money guard.
        const shown = [input.rationale, input.note].filter((v) => typeof v === "string").join(" ");
        const wrong = unknownAmounts(shown, known);
        if (wrong.length) return { error: `These amounts don't match the ledger: ${wrong.join(", ")}. Rewrite without them.` };
        const prepared = await prepareAction(lease, role, user.id, spec.kind, input, attachments);
        if ("error" in prepared) return prepared;
        pending = prepared;
        return { status: `Card shown; waiting for ${user.name.split(" ")[0]} to press "${prepared.confirmLabel}"`, card: prepared.title, details: prepared.lines };
      }
    }
  }

  // Amounts the person typed themselves ("the plumber charged $1,240") are fine to repeat.
  for (const m of history) if (m.role === "user") for (const n of m.text.replace(/,(?=\d{3})/g, "").matchAll(/\d+(?:\.\d{1,2})?/g)) known.add(Math.round(Number(n[0]) * 100));
  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(-20).map((m) => ({ role: m.role, content: m.text.slice(0, 2000) }));
  if (attachments.length) {
    messages.push({ role: "user", content: `(Photos attached in the chat right now: ${attachments.map((a) => `${a.kind}: ${a.name}`).join(", ")})` });
  }
  let retriedGuard = false;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      ...FALLBACK,
      output_config: { effort: "low" },
      system: systemPrompt(lease, role, { me: user.name, other: other?.name ?? "the other side" }, user.paypalVaultId ? (user.paypalVaultEmail ?? "saved") : null, user.notify ?? "important"),
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
