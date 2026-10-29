import { cookies } from "next/headers";
import { publicOrigin } from "@/lib/origin";
import { getCurrentUser } from "@/lib/session";
import { finishVaultSetup, VAULT_SETUP_COOKIE } from "@/lib/vault";

// PayPal sends the tenant back here after they approve saving their PayPal.
export async function GET(request: Request) {
  const back = (state: string) => Response.redirect(new URL(`/ledger?vault=${state}`, publicOrigin(request)), 303);
  const user = await getCurrentUser();
  const jar = await cookies();
  const [userId, setupToken] = (jar.get(VAULT_SETUP_COOKIE)?.value ?? "").split(":");
  jar.delete({ name: VAULT_SETUP_COOKIE, path: "/api/vault" });
  const returned = new URL(request.url).searchParams.get("approval_token_id");
  if (!user || userId !== user.id || !setupToken || (returned && returned !== setupToken)) return back("failed");
  try {
    await finishVaultSetup(user, setupToken);
    return back("saved");
  } catch (err) {
    console.error("vault finish failed", err);
    return back("failed");
  }
}
