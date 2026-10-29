import { cookies } from "next/headers";
import { publicOrigin } from "@/lib/origin";
import { getCurrentUser } from "@/lib/session";
import { startVaultSetup, VAULT_SETUP_COOKIE } from "@/lib/vault";

// Tenant pressed "Save my PayPal": send them to PayPal to approve. The setup token goes in a cookie
// so the return can only finish a setup this browser started.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.redirect(new URL("/", publicOrigin(request)), 303);
  try {
    const { setupToken, approveUrl } = await startVaultSetup(user, publicOrigin(request));
    (await cookies()).set(VAULT_SETUP_COOKIE, `${user.id}:${setupToken}`, { httpOnly: true, sameSite: "lax", secure: true, maxAge: 30 * 60, path: "/api/vault" });
    return Response.redirect(approveUrl, 303);
  } catch (err) {
    console.error("vault setup failed", err);
    return Response.redirect(new URL("/ledger?vault=failed", publicOrigin(request)), 303);
  }
}
