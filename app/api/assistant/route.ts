import { eq } from "drizzle-orm";
import type { Attachment } from "@/lib/assistant/actions";
import { chat, type ChatMessage } from "@/lib/assistant/chat";
import { db, schema } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { EVIDENCE_KINDS } from "@/lib/storage";

export const maxDuration = 60;

// One turn of a conversation with Aunt Tally about a lease the caller is on.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const body = (await request.json().catch(() => null)) as { leaseId?: string; messages?: ChatMessage[]; attachments?: Attachment[] } | null;
  if (!user || !body?.leaseId || !Array.isArray(body.messages)) return Response.json({ error: "Bad request" }, { status: 400 });

  const [lease] = await db().select().from(schema.leases).where(eq(schema.leases.id, body.leaseId));
  if (!lease || (lease.landlordId !== user.id && lease.tenantId !== user.id)) return Response.json({ error: "Not found" }, { status: 404 });

  const messages = body.messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && m.text.trim())
    .slice(-20);
  if (messages.at(-1)?.role !== "user") return Response.json({ error: "Ask a question first" }, { status: 400 });
  // The API needs the conversation to start with the person, so drop any greeting before that.
  while (messages[0]?.role === "assistant") messages.shift();

  try {
    // Photos waiting in the chat box; only their names and kinds, the files come with the Confirm.
    const attachments = (Array.isArray(body.attachments) ? body.attachments : [])
      .filter((a) => EVIDENCE_KINDS.includes(a?.kind) && typeof a.name === "string")
      .slice(0, 12)
      .map((a) => ({ kind: a.kind, name: a.name.slice(0, 80) }));
    return Response.json(await chat(user, lease, messages, attachments));
  } catch (err) {
    console.error("assistant failed", err);
    return Response.json({ text: "Sorry, I lost my place there. Could you ask again?" });
  }
}
