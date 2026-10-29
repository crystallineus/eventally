import { eq } from "drizzle-orm";
import { performAction, type Action } from "@/lib/assistant/actions";
import { db, schema } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { EVIDENCE_KINDS, type EvidenceKind } from "@/lib/storage";

const MAX_FILES = 12;

// The person pressed Confirm on a card Aunt Tally prepared. Multipart: leaseId, action (JSON), and
// photos under before/after/receipt. performAction goes through the same lib code as the regular
// pages, so permissions and claim state are checked again there.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const form = await request.formData().catch(() => null);
  const leaseId = form?.get("leaseId");
  let action: Action | null = null;
  try {
    action = JSON.parse(String(form?.get("action") ?? "null"));
  } catch {}
  if (!user || !form || typeof leaseId !== "string" || !action?.kind) return Response.json({ error: "Bad request" }, { status: 400 });

  const [lease] = await db().select().from(schema.leases).where(eq(schema.leases.id, leaseId));
  if (!lease || (lease.landlordId !== user.id && lease.tenantId !== user.id)) return Response.json({ error: "Not found" }, { status: 404 });

  const photos = EVIDENCE_KINDS.flatMap((kind) =>
    form
      .getAll(kind)
      .filter((v): v is File => v instanceof File && v.size > 0)
      .map((file) => ({ kind: kind as EvidenceKind, file })),
  );
  if (photos.length > MAX_FILES) return Response.json({ error: `Attach at most ${MAX_FILES} photos at a time` }, { status: 400 });

  try {
    return Response.json({ ok: true, ...(await performAction(user, lease, action, photos)) });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : "That didn't go through" }, { status: 400 });
  }
}
