import { redirect } from "next/navigation";
import { switchUser } from "@/app/actions";
import { getCurrentUser, getDemoUsers } from "@/lib/session";

export default async function Home() {
  if (await getCurrentUser()) redirect("/ledger");
  const users = await getDemoUsers();

  return (
    <div className="mx-auto max-w-xl py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Repairs, settled on the next rent.</h1>
      <p className="mt-3 text-stone-600">
        A tenant or landlord fronts a repair, uploads the receipt, and an AI agent checks the evidence against the
        lease. Once both sides agree, the amount lands on next month&apos;s PayPal rent invoice.
      </p>
      <p className="mt-8 text-sm font-medium text-stone-500">This is a demo. Pick who you are:</p>
      <form action={switchUser} className="mt-3 grid gap-3 sm:grid-cols-2">
        {users.map((u) => (
          <button
            key={u.id}
            name="userId"
            value={u.id}
            className="rounded-xl border border-stone-200 bg-white p-4 text-left shadow-sm hover:border-stone-400"
          >
            <span className="block font-medium">{u.name}</span>
            <span className="block text-sm capitalize text-stone-500">
              {u.role}
              {u.businessName ? ` · ${u.businessName}` : ""}
            </span>
          </button>
        ))}
      </form>
    </div>
  );
}
