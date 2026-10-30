import { deleteDemo } from "@/lib/demo";
import { startDemo } from "@/lib/demo-session";
import { publicOrigin } from "@/lib/origin";
import { getCurrentUser, getDemoId, getDemoUsers } from "@/lib/session";

// "Reset demo": throw away this visitor's demo and start a fresh one, keeping their view (Tom or Maya).
export async function POST(request: Request) {
  const origin = publicOrigin(request);
  const [demoId, user, people] = await Promise.all([getDemoId(), getCurrentUser(), getDemoUsers()]);
  const role = people.find((p) => p.id === user?.id)?.role ?? "tenant";
  try {
    await startDemo(role);
    if (demoId) await deleteDemo(demoId);
  } catch (err) {
    console.error("demo reset failed", err);
    return Response.redirect(new URL("/?demo=failed", origin), 303);
  }
  return Response.redirect(new URL("/ledger", origin), 303);
}
