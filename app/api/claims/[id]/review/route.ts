import { runReview } from "@/lib/agent/review";
import { getClaimForUser } from "@/lib/claims";
import { getCurrentUser } from "@/lib/session";

// A review makes several model calls; give it room on Vercel.
export const maxDuration = 300;

// Starts the AI review of a claim that is waiting for one. Either party can trigger it;
// the review lock in runReview makes repeat calls harmless.
export async function POST(_request: Request, ctx: RouteContext<"/api/claims/[id]/review">) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const found = user && (await getClaimForUser(id, user.id));
  if (!found) return Response.json({ error: "Not found" }, { status: 404 });
  if (found.claim.status !== "reviewing") return Response.json({ outcome: "not_reviewing" });

  return Response.json({ outcome: await runReview(id) });
}
