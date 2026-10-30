import { startDemo } from "@/lib/demo-session";
import { publicOrigin } from "@/lib/origin";

// "I'm Maya" / "I'm Tom" on the home page: make this visitor their own demo and open the ledger.
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const role = form?.get("role") === "landlord" ? "landlord" : "tenant";
  const origin = publicOrigin(request);
  try {
    await startDemo(role);
  } catch (err) {
    console.error("demo start failed", err);
    return Response.redirect(new URL("/?demo=failed", origin), 303);
  }
  return Response.redirect(new URL("/ledger", origin), 303);
}
