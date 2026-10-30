"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { addEvidence, approveClaim, createClaim, getClaimForUser, proposeSplit, removeEvidence, requestReview, setPayoutPreference, updateClaimAmount, updateIssueDate, withdrawClaim } from "@/lib/claims";
import { db, schema } from "@/lib/db";
import { payClaimNow, syncPayout } from "@/lib/payouts";
import { parseUsd } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { EVIDENCE_KINDS, type EvidenceKind } from "@/lib/storage";

export type FormState = { error: string | null };

const MAX_FILES = 12;

/** Files arrive as form fields named "before", "after" and "receipt". */
function filesFrom(formData: FormData) {
  const files = EVIDENCE_KINDS.flatMap((kind) =>
    formData
      .getAll(kind)
      .filter((v): v is File => v instanceof File && v.size > 0)
      .map((file) => ({ kind: kind as EvidenceKind, file })),
  );
  if (files.length > MAX_FILES) throw new Error(`Upload at most ${MAX_FILES} photos at a time`);
  return files;
}

const NewClaimForm = z.object({
  leaseId: z.uuid(),
  title: z.string().trim().min(3, "Give the repair a short title"),
  description: z.string().trim().min(10, "Describe what broke and what was done"),
  issueDate: z.iso.date("Enter the date the problem was reported"),
  amount: z.string().trim().min(1, "Enter the receipt total"),
});

export async function submitClaim(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = NewClaimForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let claimId: string;
  try {
    const amountCents = parseUsd(parsed.data.amount);
    if (amountCents <= 0) return { error: "The receipt total must be more than $0" };
    const files = filesFrom(formData);
    if (!files.some((f) => f.kind === "receipt")) return { error: "Add at least one photo of the receipt" };
    claimId = await createClaim(user, {
      leaseId: parsed.data.leaseId,
      title: parsed.data.title,
      description: parsed.data.description,
      issueReportedAt: new Date(`${parsed.data.issueDate}T12:00:00Z`),
      amountCents,
      tenantWantsPayout: formData.get("wantsPayout") === "on",
      files,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong" };
  }
  redirect(`/claims/${claimId}`);
}

export async function uploadEvidence(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const claimId = String(formData.get("claimId"));
  try {
    const files = filesFrom(formData);
    if (files.length === 0) return { error: "Choose at least one photo" };
    await addEvidence(user, claimId, files);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Upload failed" };
  }
  revalidatePath(`/claims/${claimId}`);
  return { error: null };
}

const SplitForm = z.object({
  claimId: z.uuid(),
  landlordPercent: z.coerce.number().min(0, "0–100%").max(100, "0–100%"),
  rationale: z.string().trim().min(5, "Say briefly why this split is fair"),
});

export async function submitSplit(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = SplitForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    // Percent with up to two decimals -> basis points.
    await proposeSplit(user, parsed.data.claimId, Math.round(parsed.data.landlordPercent * 100), parsed.data.rationale);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save the proposal" };
  }
  revalidatePath(`/claims/${parsed.data.claimId}`);
  return { error: null };
}

export async function approve(formData: FormData) {
  const user = await requireUser();
  const claimId = String(formData.get("claimId"));
  await approveClaim(user, claimId);
  revalidatePath(`/claims/${claimId}`);
}

export async function withdraw(formData: FormData) {
  const user = await requireUser();
  const claimId = String(formData.get("claimId"));
  await withdrawClaim(user, claimId);
  revalidatePath(`/claims/${claimId}`);
}

export async function changeAmount(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const claimId = String(formData.get("claimId"));
  try {
    await updateClaimAmount(user, claimId, parseUsd(String(formData.get("amount") ?? "")));
  } catch (err) {
    return { error: err instanceof Error && !err.message.startsWith("Not a USD") ? err.message : "Enter a dollar amount like 45.00" };
  }
  revalidatePath(`/claims/${claimId}`);
  return { error: null };
}

export async function changeIssueDate(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const claimId = String(formData.get("claimId"));
  try {
    await updateIssueDate(user, claimId, String(formData.get("date") ?? ""));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not change the date" };
  }
  revalidatePath(`/claims/${claimId}`);
  return { error: null };
}

export async function reviewAgain(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const claimId = String(formData.get("claimId"));
  try {
    await requestReview(user, claimId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not start the review" };
  }
  revalidatePath(`/claims/${claimId}`);
  return { error: null };
}

export async function removePhoto(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const claimId = String(formData.get("claimId"));
  try {
    await removeEvidence(user, String(formData.get("evidenceId")));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not remove the photo" };
  }
  revalidatePath(`/claims/${claimId}`);
  return { error: null };
}

export async function payBackNow(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const claimId = String(formData.get("claimId"));
  try {
    await payClaimNow(user, claimId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not send the payout" };
  }
  revalidatePath(`/claims/${claimId}`);
  return { error: null };
}

/** Either party's page polls this while a payout is pending. */
export async function refreshPayout(claimId: string) {
  const user = await requireUser();
  if (!(await getClaimForUser(claimId, user.id))) return;
  const [payout] = await db().select().from(schema.payouts).where(eq(schema.payouts.claimId, claimId));
  if (payout?.status === "pending") await syncPayout(payout.id);
}

export async function changePayoutPreference(formData: FormData) {
  const user = await requireUser();
  const claimId = String(formData.get("claimId"));
  await setPayoutPreference(user, claimId, formData.get("wantsPayout") === "true");
  revalidatePath(`/claims/${claimId}`);
}
