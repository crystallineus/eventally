import { PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";
import type Anthropic from "@anthropic-ai/sdk";

// PayPal Agent Toolkit, limited to tools that can't move money. The toolkit only builds the tools
// enabled here, so invoice creation, refunds and payments don't exist for the assistant at all.
// Its OpenAI adapter gives JSON Schema parameters, which Anthropic tools take as-is.

let toolkit: PayPalAgentToolkit | undefined;

function getToolkit() {
  toolkit ??= new PayPalAgentToolkit({
    clientId: process.env.PAYPAL_CLIENT_ID!,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    configuration: {
      actions: { invoices: { get: true, search: true, sendReminder: true } },
      context: { sandbox: !process.env.PAYPAL_API_BASE || process.env.PAYPAL_API_BASE.includes("sandbox") },
    },
  });
  return toolkit;
}

export type ToolkitName = "get_invoice" | "search_invoicing" | "send_invoice_reminder";

/** Anthropic tool definitions for the named toolkit tools, using the toolkit's own descriptions and schemas. */
export function toolkitTools(names: ToolkitName[]): Anthropic.Beta.BetaTool[] {
  return getToolkit()
    .getTools()
    .filter((t) => names.includes(t.function.name as ToolkitName))
    .map((t) => ({
      name: t.function.name,
      description: t.function.description ?? "",
      input_schema: (t.function.parameters ?? { type: "object", properties: {} }) as Anthropic.Beta.BetaTool.InputSchema,
    }));
}

/** Run a toolkit tool and return its JSON result (the toolkit reports errors as data, not throws). */
export async function runToolkitTool(name: ToolkitName, args: Record<string, unknown>): Promise<unknown> {
  const result = await getToolkit().handleToolCall({
    id: `call_${Date.now()}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  });
  const content = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

type RawInvoice = {
  id?: string;
  status?: string;
  detail?: { invoice_number?: string; invoice_date?: string; payment_term?: { due_date?: string }; metadata?: { recipient_view_url?: string } };
  amount?: { value?: string };
  due_amount?: { value?: string };
  payments?: { paid_amount?: { value?: string }; transactions?: { payment_date?: string; amount?: { value?: string } }[] };
  items?: { name?: string; unit_amount?: { value?: string } }[];
};

/** Keep the fields that matter to a landlord or tenant so the model doesn't read a whole invoice object. */
export function trimInvoice(raw: unknown) {
  const i = (typeof raw === "string" ? JSON.parse(raw) : raw) as RawInvoice;
  if (!i?.id) return raw;
  return {
    paypal_invoice_id: i.id,
    status: i.status,
    invoice_number: i.detail?.invoice_number,
    invoice_date: i.detail?.invoice_date,
    due_date: i.detail?.payment_term?.due_date,
    total: i.amount?.value,
    amount_due: i.due_amount?.value,
    paid: i.payments?.paid_amount?.value ?? null,
    paid_on: i.payments?.transactions?.at(-1)?.payment_date ?? null,
    pay_link: i.detail?.metadata?.recipient_view_url ?? null,
    lines: i.items?.map((it) => ({ name: it.name, amount: it.unit_amount?.value })),
  };
}
