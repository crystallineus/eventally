import { redirect } from "next/navigation";
import { getDemoUsers, requireUser } from "@/lib/session";

// Landlord-only pages: "landlord" means the user owns at least one lease. With demo identities
// every landlord is seeded with a lease; real sign-up will need an explicit landlord role.
export default async function LandlordLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const me = (await getDemoUsers()).find((u) => u.id === user.id);
  if (me?.role !== "landlord") redirect("/ledger");
  return children;
}
