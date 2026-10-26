import Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { checkDates, checkMath, type CheckResult, type Receipt } from "@/lib/agent/checks";
import { db, schema } from "@/lib/db";
import { unknownAmounts } from "@/lib/guard";
import { formatUsd, parseUsd, splitByShare, type Cents } from "@/lib/money";
import { formatLeaseTerm } from "@/lib/period";
import { PRICE_CATEGORIES, type PriceCategory } from "@/lib/reference-prices";

// The review agent: looks at the evidence, calls checks as tools, and ends by either asking one
// side for more evidence or proposing a split. It has no tool that moves money — approved splits
// reach the next rent invoice only after both people approve (lib/claims.ts).

const MODEL = "claude-opus-5-5";
const MAX_TURNS = 12;
const LOCK_MINUTES = 5;

const client = new Anthropic();

type Claim = typeof schema.claims.$inferSelect;
type Lease = typeof schema.leases.$inferSelect;
type Role = "landlord" | "tenant";

// ---- tool inputs ---------------------------------------------------------------------------

const why = z.string().min(1).describe("One sentence, for both parties, on why you're taking this step.");
const usd = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "Dollar amount like 180.00, no $ sign")
  .describe('Dollar amount as a string, e.g. "180.00"');

const inputs = {
  record_receipt: z.strictObject({
    why,
    evidence_id: z.string().describe("ID of the receipt image you read"),
    merchant: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().describe("Receipt date as YYYY-MM-DD, or null if unreadable"),
    line_items: z.array(z.strictObject({ description: z.string(), amount: usd })),
    tax: usd.nullable(),
    total: usd,
    legible: z.boolean().describe("False if you had to guess at any amount"),
    other_amounts: z.array(usd).describe("Any other dollar figures printed on the receipt, such as an hourly rate"),
  }),
  check_math: z.strictObject({ why }),
  check_dates: z.strictObject({ why }),
  check_duplicate: z.strictObject({ why }),
  assess_photos: z.strictObject({
    why,
    status: z.enum(["pass", "warn", "fail"]).describe("pass: photos show the problem and the repair the receipt bills for"),
    summary: z.string().describe("One or two plain sentences for both parties"),
  }),
  estimate_price: z.strictObject({
    why,
    category: z.enum(Object.keys(PRICE_CATEGORIES) as [PriceCategory, ...PriceCategory[]]),
  }),
  request_more_evidence: z.strictObject({
    why,
    from: z.enum(["tenant", "landlord"]),
    kinds: z.array(z.enum(["before", "after", "receipt", "itemized_invoice"])).min(1),
    message: z.string().describe("What you need and why, addressed to that person"),
  }),
  propose_split: z.strictObject({
    why,
    landlord_percent: z.number().min(0).max(100).describe("Share of the receipt total the landlord should bear"),
    lease_citation: z.string().describe("The lease clause you rely on, quoted or referenced"),
    rationale: z.string().describe("Two to four plain sentences for both parties"),
  }),
} as const;

type ToolName = keyof typeof inputs;
const TERMINAL: ToolName[] = ["request_more_evidence", "propose_split"];

const DESCRIPTIONS: Record<ToolName, string> = {
  record_receipt: "Record what the receipt image says. Call this first; other checks use it.",
  check_math: "Check that line items (and tax) add up to the receipt total and that the total matches the claim.",
  check_dates: "Check the receipt date against when the problem was reported and the lease term.",
  check_duplicate: "Look for the same image or the same receipt (merchant, date, total) in other claims on this lease.",
  assess_photos: "Record whether the before/after photos match the problem and the work on the receipt.",
  estimate_price: "Get a rough local reference range for a kind of repair. It's an estimate only; never reject a claim on price alone.",
  request_more_evidence: "Finish the review by asking one person for specific missing evidence. Ends this review until they upload it.",
  propose_split: "Finish the review by proposing who pays what share, citing the lease. Both people must still approve.",
};

const tools: Anthropic.Beta.BetaTool[] = (Object.keys(inputs) as ToolName[]).map((name) => {
  const { $schema: _ignored, ...input_schema } = z.toJSONSchema(inputs[name]) as Record<string, unknown>;
  return { name, description: DESCRIPTIONS[name], input_schema: input_schema as Anthropic.Beta.BetaTool.InputSchema };
});

const SYSTEM = `You are EvenTally's repair-claim reviewer, an AI assistant. A landlord and a tenant both read everything you write, so stay neutral and write plain, friendly English for both of them. Never pretend to be a person.

Your job for each claim:
1. Read the receipt image and call record_receipt.
2. Run check_math, check_dates and check_duplicate. Call assess_photos after looking at the before/after photos. Use estimate_price when a reference range would help either side judge the amount.
3. Finish with exactly one of:
   - request_more_evidence, when something needed to decide fairly is missing or unreadable (for example, no photo of the finished repair, or an unreadable receipt). Ask the person who can provide it.
   - propose_split, when the evidence is enough. Base the split on the lease's repair clause and say which part of it applies.

Ground rules:
- Checks are hints, not verdicts. You don't decide whether a receipt is genuine, and you don't give legal advice.
- Every dollar amount you write, including in "why", must come from the receipt, the claim, or a tool result; otherwise the app sends it back. Don't compute new totals yourself; the app computes each side's share from your percentage.
- Keep each "why" to one sentence.`;

// ---- entry point ---------------------------------------------------------------------------

export type ReviewOutcome = "proposed" | "needs_evidence" | "incomplete" | "busy" | "error";

/** Run one review of a claim that is in the "reviewing" state. Safe to call repeatedly. */
export async function runReview(claimId: string): Promise<ReviewOutcome> {
  const [locked] = await db()
    .update(schema.claims)
    .set({ reviewStartedAt: new Date() })
    .where(
      and(
        eq(schema.claims.id, claimId),
        eq(schema.claims.status, "reviewing"),
        or(isNull(schema.claims.reviewStartedAt), lt(schema.claims.reviewStartedAt, sql`now() - make_interval(mins => ${LOCK_MINUTES})`)),
      ),
    )
    .returning();
  if (!locked) return "busy";

  const [lease] = await db().select().from(schema.leases).where(eq(schema.leases.id, locked.leaseId));
  const log = (type: string, data: Record<string, unknown>) =>
    db().insert(schema.events).values({ leaseId: lease.id, claimId, actor: "agent", type, data });

  try {
    await log("agent.review_started", { note: "EvenTally AI started reviewing this claim." });
    const outcome = await reviewLoop(locked, lease, log);
    if (outcome === "incomplete") await log("agent.review_incomplete", { note: "The AI review ended without a decision. Either of you can propose a split." });
    return outcome;
  } catch (err) {
    console.error("review failed", err);
    await log("agent.error", { note: "The AI review hit an error. Either of you can still propose a split.", error: err instanceof Error ? err.message : String(err) });
    return "error";
  } finally {
    await db().update(schema.claims).set({ reviewStartedAt: null }).where(eq(schema.claims.id, claimId));
  }
}

type Log = (type: string, data: Record<string, unknown>) => Promise<unknown>;

async function reviewLoop(claim: Claim, lease: Lease, log: Log): Promise<ReviewOutcome> {
  const ctx = await loadContext(claim, lease);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: ctx.prompt }];
  let nudged = false;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: SYSTEM,
      tools,
      messages,
    });

    if (response.stop_reason === "refusal") {
      await log("agent.refused", { note: "The AI declined to review this claim. Either of you can propose a split." });
      return "incomplete";
    }
    messages.push({ role: "assistant", content: response.content });

    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (calls.length === 0) {
      if (nudged || response.stop_reason === "max_tokens") return "incomplete";
      nudged = true;
      messages.push({ role: "user", content: "Please finish by calling request_more_evidence or propose_split." });
      continue;
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    let finished: ReviewOutcome | null = null;
    for (const call of calls) {
      const { content, isError, outcome } = await runTool(call, ctx, log);
      results.push({ type: "tool_result", tool_use_id: call.id, content, is_error: isError });
      if (outcome) finished = outcome;
    }
    if (finished) return finished;
    messages.push({ role: "user", content: results });
  }
  return "incomplete";
}

// ---- context -------------------------------------------------------------------------------

type Context = Awaited<ReturnType<typeof loadContext>>;

async function loadContext(claim: Claim, lease: Lease) {
  const [evidence, people] = await Promise.all([
    db().select().from(schema.evidence).where(eq(schema.evidence.claimId, claim.id)).orderBy(schema.evidence.createdAt),
    db().select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, [lease.landlordId, lease.tenantId ?? lease.landlordId])),
  ]);
  const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? "Unknown";
  const submitterRole: Role = claim.submittedBy === lease.landlordId ? "landlord" : "tenant";

  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    {
      type: "text",
      text: [
        `Claim: ${claim.title}`,
        `Submitted by ${name(claim.submittedBy)} (the ${submitterRole}), who paid ${formatUsd(claim.amountCents ?? 0)} and is asking to be reimbursed.`,
        `Problem reported on: ${claim.issueReportedAt.toISOString().slice(0, 10)}`,
        `Description: ${claim.description}`,
        "",
        `Property: ${lease.propertyName}. Landlord: ${name(lease.landlordId)}. Tenant: ${name(lease.tenantId)}.`,
        `Lease term: ${formatLeaseTerm(lease.startDate, lease.endDate)}. Rent: ${formatUsd(lease.rentCents)}/month.`,
        `Repair clause from the lease:\n${lease.repairClause}`,
        "",
        evidence.length ? "Evidence images follow, each labelled with its ID and kind." : "No evidence images were uploaded.",
      ].join("\n"),
    },
  ];
  for (const e of evidence) {
    const mediaType = e.mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mediaType)) continue;
    content.push({ type: "text", text: `Evidence ${e.id} (${e.kind}, uploaded by ${name(e.uploadedBy)}):` });
    content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: e.data.toString("base64") } });
  }

  return {
    claim,
    lease,
    submitterRole,
    evidence: evidence.map(({ data: _data, ...rest }) => rest),
    prompt: content,
    receipt: null as (Receipt & { evidenceId: string }) | null,
    /** Every amount the agent may mention: receipt fields, claim, reference ranges, shares. */
    knownAmounts: new Set<Cents>([claim.amountCents ?? 0, lease.rentCents]),
  };
}

// ---- tools ---------------------------------------------------------------------------------

async function runTool(
  call: Anthropic.Beta.BetaToolUseBlock,
  ctx: Context,
  log: Log,
): Promise<{ content: string; isError?: boolean; outcome?: ReviewOutcome }> {
  const name = call.name as ToolName;
  const schemaFor = inputs[name];
  if (!schemaFor) return { content: `Unknown tool ${call.name}`, isError: true };
  const parsed = schemaFor.safeParse(call.input);
  if (!parsed.success) return { content: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, isError: true };

  try {
    const { why: reason, ...input } = parsed.data as { why: string } & Record<string, unknown>;
    // Guard free text both parties will read. The finishing tools also check their messages
    // in their handlers, where the computed shares are known.
    const shown = [reason, typeof input.summary === "string" ? input.summary : ""].join(" ");
    const unknown = unknownAmounts(shown, ctx.knownAmounts);
    if (unknown.length) throw new Error(`These amounts don't match the receipt or ledger: ${unknown.join(", ")}. Rewrite without them.`);
    const { result, outcome } = await TOOL_HANDLERS[name](input as never, ctx);
    await log(`agent.${name}`, { why: reason, input, result });
    return { content: JSON.stringify(result), outcome };
  } catch (err) {
    // Expected refusals (guard, bad references) go back to the agent to fix; they aren't logged as steps.
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}

type Handler<N extends ToolName> = (
  input: Omit<z.infer<(typeof inputs)[N]>, "why">,
  ctx: Context,
) => Promise<{ result: CheckResult | Record<string, unknown>; outcome?: ReviewOutcome }>;

const TOOL_HANDLERS: { [N in ToolName]: Handler<N> } = {
  async record_receipt(input, ctx) {
    const evidence = ctx.evidence.find((e) => e.id === input.evidence_id);
    if (!evidence) throw new Error(`No evidence with ID ${input.evidence_id} on this claim`);
    const receipt: Receipt = {
      merchant: input.merchant,
      date: input.date,
      lineItems: input.line_items.map((i) => ({ description: i.description, amountCents: parseUsd(i.amount) })),
      taxCents: input.tax ? parseUsd(input.tax) : null,
      totalCents: parseUsd(input.total),
    };
    ctx.receipt = { ...receipt, evidenceId: evidence.id };
    for (const c of [receipt.totalCents, receipt.taxCents ?? 0, ...receipt.lineItems.map((i) => i.amountCents), ...input.other_amounts.map(parseUsd)]) {
      ctx.knownAmounts.add(c);
    }
    await db()
      .update(schema.evidence)
      .set({ extracted: { ...receipt, legible: input.legible } })
      .where(eq(schema.evidence.id, evidence.id));
    return {
      result: {
        status: input.legible ? "pass" : "warn",
        summary: `Read a receipt from ${receipt.merchant}${receipt.date ? ` dated ${receipt.date}` : ""} for ${formatUsd(receipt.totalCents)}${input.legible ? "." : ", but parts were hard to read."}`,
      },
    };
  },

  async check_math(_input, ctx) {
    if (!ctx.receipt) throw new Error("Call record_receipt first");
    return { result: checkMath(ctx.receipt, ctx.claim.amountCents ?? 0) };
  },

  async check_dates(_input, ctx) {
    if (!ctx.receipt) throw new Error("Call record_receipt first");
    const today = new Date().toISOString().slice(0, 10);
    return { result: checkDates(ctx.receipt.date, ctx.claim.issueReportedAt.toISOString().slice(0, 10), ctx.lease, today) };
  },

  async check_duplicate(_input, ctx) {
    // Same image bytes anywhere else on this lease (including twice in this claim).
    const hashes = ctx.evidence.map((e) => e.sha256);
    const sameImage = hashes.length
      ? await db()
          .select({ claimId: schema.evidence.claimId, title: schema.claims.title, id: schema.evidence.id })
          .from(schema.evidence)
          .innerJoin(schema.claims, eq(schema.evidence.claimId, schema.claims.id))
          .where(and(eq(schema.claims.leaseId, ctx.lease.id), inArray(schema.evidence.sha256, hashes)))
      : [];
    const ownIds = new Set(ctx.evidence.map((e) => e.id));
    const repeatedHere = hashes.length !== new Set(hashes).size;
    const elsewhere = sameImage.filter((r) => !ownIds.has(r.id) && r.claimId !== ctx.claim.id);

    // Same receipt (merchant + date + total) read on another claim.
    const sameReceipt: string[] = [];
    if (ctx.receipt) {
      const others = await db()
        .select({ title: schema.claims.title, extracted: schema.evidence.extracted })
        .from(schema.evidence)
        .innerJoin(schema.claims, eq(schema.evidence.claimId, schema.claims.id))
        .where(and(eq(schema.claims.leaseId, ctx.lease.id), ne(schema.claims.id, ctx.claim.id), ne(schema.claims.status, "withdrawn"), eq(schema.evidence.kind, "receipt")));
      for (const o of others) {
        const r = o.extracted as Receipt | null;
        if (r && r.totalCents === ctx.receipt.totalCents && r.date === ctx.receipt.date && r.merchant.trim().toLowerCase() === ctx.receipt.merchant.trim().toLowerCase()) {
          sameReceipt.push(o.title);
        }
      }
    }

    const titles = [...new Set([...elsewhere.map((r) => r.title), ...sameReceipt])];
    if (titles.length) return { result: { status: "fail", summary: `This looks like the same receipt or photo already used in: ${titles.join(", ")}.` } };
    if (repeatedHere) return { result: { status: "warn", summary: "The same photo was uploaded more than once in this claim." } };
    return { result: { status: "pass", summary: "No matching receipt or photo found in other claims on this lease." } };
  },

  async assess_photos(input) {
    return { result: { status: input.status, summary: input.summary } };
  },

  async estimate_price(input, ctx) {
    const range = PRICE_CATEGORIES[input.category];
    ctx.knownAmounts.add(range.lowCents).add(range.highCents);
    return {
      result: {
        status: "pass",
        summary: `Estimate only: ${range.label} usually runs ${formatUsd(range.lowCents)}–${formatUsd(range.highCents)} around San Jose.`,
        estimate: true,
      },
    };
  },

  async request_more_evidence(input, ctx) {
    const unknown = unknownAmounts(input.message, ctx.knownAmounts);
    if (unknown.length) throw new Error(`These amounts don't match the receipt or ledger: ${unknown.join(", ")}. Restate the message using only known amounts.`);
    await db()
      .update(schema.claims)
      .set({ status: "needs_evidence", updatedAt: new Date() })
      .where(and(eq(schema.claims.id, ctx.claim.id), eq(schema.claims.status, "reviewing")));
    return { result: { status: "warn", summary: input.message, from: input.from, kinds: input.kinds }, outcome: "needs_evidence" };
  },

  async propose_split(input, ctx) {
    const total = ctx.claim.amountCents ?? 0;
    const { landlord, tenant } = splitByShare(total, Math.round(input.landlord_percent * 100));
    const known = new Set(ctx.knownAmounts).add(landlord).add(tenant);
    const unknown = unknownAmounts(`${input.rationale} ${input.lease_citation}`, known);
    if (unknown.length) throw new Error(`These amounts don't match the receipt or ledger: ${unknown.join(", ")}. Restate without them; the app shows each side's share.`);

    const [updated] = await db()
      .update(schema.claims)
      .set({
        status: "awaiting_approval",
        landlordShareCents: landlord,
        tenantShareCents: tenant,
        splitRationale: `${input.rationale}\n\nLease: ${input.lease_citation}`,
        landlordApprovedAt: null,
        tenantApprovedAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.claims.id, ctx.claim.id), eq(schema.claims.status, "reviewing")))
      .returning({ id: schema.claims.id });
    if (!updated) return { result: { status: "warn", summary: "The claim changed while the review ran; no proposal was saved." }, outcome: "incomplete" };

    return {
      result: {
        status: "pass",
        summary: `Proposed: landlord pays ${formatUsd(landlord)}, tenant pays ${formatUsd(tenant)}.`,
        landlordShareCents: landlord,
        tenantShareCents: tenant,
        rationale: input.rationale,
        leaseCitation: input.lease_citation,
      },
      outcome: "proposed",
    };
  },
};
