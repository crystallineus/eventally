import { publicOrigin } from "@/lib/origin";
import { getCurrentUser } from "@/lib/session";
import { removeVault } from "@/lib/vault";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (user) await removeVault(user);
  return Response.redirect(new URL("/ledger?vault=removed", publicOrigin(request)), 303);
}
