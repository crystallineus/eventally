import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// Evidence files live in Postgres (bytea) for now. This module is the only code that reads or
// writes file bytes, so moving to R2/S3 later means changing just these two functions.

type Executor = Pick<ReturnType<typeof db>, "insert" | "select">;

export const MAX_FILE_BYTES = 2 * 1024 * 1024; // after client-side resizing to ~1600px JPEG
export const EVIDENCE_KINDS = ["before", "after", "receipt"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export async function putEvidence(
  tx: Executor,
  input: { claimId: string; kind: EvidenceKind; uploadedBy: string; file: File },
) {
  const { file } = input;
  if (!file.type.startsWith("image/")) throw new Error(`${file.name || "File"} is not an image`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name || "File"} is larger than 2 MB`);

  const data = Buffer.from(await file.arrayBuffer());
  const [row] = await tx
    .insert(schema.evidence)
    .values({
      claimId: input.claimId,
      kind: input.kind,
      uploadedBy: input.uploadedBy,
      mimeType: file.type,
      data,
      sha256: createHash("sha256").update(data).digest("hex"),
    })
    .returning({ id: schema.evidence.id, kind: schema.evidence.kind, sha256: schema.evidence.sha256 });
  return row;
}

export async function getEvidenceFile(id: string) {
  const [row] = await db()
    .select({ claimId: schema.evidence.claimId, mimeType: schema.evidence.mimeType, data: schema.evidence.data })
    .from(schema.evidence)
    .where(eq(schema.evidence.id, id));
  return row ?? null;
}
