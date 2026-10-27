import { getClaimForUser } from "@/lib/claims";
import { getCurrentUser } from "@/lib/session";
import { getEvidenceFile } from "@/lib/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Serves an evidence photo only to the landlord and tenant on that claim's lease.
export async function GET(_request: Request, ctx: RouteContext<"/api/evidence/[id]">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user || !UUID.test(id)) return new Response("Not found", { status: 404 });

  const file = await getEvidenceFile(id);
  if (!file || !(await getClaimForUser(file.claimId, user.id))) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
