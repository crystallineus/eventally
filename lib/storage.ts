import { createHash } from "node:crypto";
import { and, asc, eq, getTableColumns, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// Evidence files live in Postgres (bytea) for now. This module is the only code that reads or
// writes file bytes, so moving to R2/S3 later means changing just this file. A demo's starting
// claims point at shared sample photos (demo_photos) instead of carrying their own copy.

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

/** Attach a shared sample photo to a claim (demo starting data); no bytes are copied. */
export async function putSampleEvidence(
  tx: Executor,
  input: { claimId: string; kind: EvidenceKind; uploadedBy: string; photo: string; extracted?: unknown; createdAt: Date },
) {
  const [photo] = await tx.select({ mimeType: schema.demoPhotos.mimeType, sha256: schema.demoPhotos.sha256 }).from(schema.demoPhotos).where(eq(schema.demoPhotos.name, input.photo));
  if (!photo) throw new Error(`Sample photo ${input.photo} is missing; run npm run db:seed`);
  const [row] = await tx
    .insert(schema.evidence)
    .values({ claimId: input.claimId, kind: input.kind, uploadedBy: input.uploadedBy, mimeType: photo.mimeType, demoPhoto: input.photo, sha256: photo.sha256, extracted: input.extracted ?? null, createdAt: input.createdAt })
    .returning({ id: schema.evidence.id });
  return row;
}

const fileOf = (row: { data: Buffer | null; sampleData: Buffer | null }) => (row.data ?? row.sampleData)!;

export async function getEvidenceFile(id: string) {
  const [row] = await db()
    .select({ claimId: schema.evidence.claimId, mimeType: schema.evidence.mimeType, data: schema.evidence.data, sampleData: schema.demoPhotos.data })
    .from(schema.evidence)
    .leftJoin(schema.demoPhotos, eq(schema.evidence.demoPhoto, schema.demoPhotos.name))
    .where(eq(schema.evidence.id, id));
  return row ? { claimId: row.claimId, mimeType: row.mimeType, data: fileOf(row) } : null;
}

/** A claim's evidence with each file's bytes, oldest first (for the review). */
export async function getClaimEvidence(claimId: string) {
  const rows = await db()
    .select({ ...getTableColumns(schema.evidence), sampleData: schema.demoPhotos.data })
    .from(schema.evidence)
    .leftJoin(schema.demoPhotos, eq(schema.evidence.demoPhoto, schema.demoPhotos.name))
    .where(and(eq(schema.evidence.claimId, claimId), isNull(schema.evidence.removedAt)))
    .orderBy(asc(schema.evidence.createdAt));
  return rows.map(({ sampleData, ...row }) => ({ ...row, data: fileOf({ data: row.data, sampleData }) }));
}
