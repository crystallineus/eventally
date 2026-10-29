import { redirect } from "next/navigation";
import { switchUser } from "@/app/actions";
import { AuntTallyAvatar } from "@/app/components/aunt-tally";
import { ASSISTANT } from "@/lib/persona";
import { getCurrentUser, getDemoUsers } from "@/lib/session";

export default async function Home() {
  if (await getCurrentUser()) redirect("/ledger");
  const users = await getDemoUsers();

  return (
    <div className="mx-auto max-w-xl py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Repairs, settled on the next rent.</h1>
      <p className="mt-3 text-stone-600">
        A tenant or landlord fronts a repair, uploads the receipt, and Aunt Tally, our AI assistant, checks the evidence against the
        lease. Once both sides agree, the amount lands on next month&apos;s PayPal rent invoice.
      </p>
      <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <AuntTallyAvatar size={52} label />
        <div className="text-sm text-stone-700">
          <p className="font-semibold text-stone-900">
            Meet {ASSISTANT.name} <span className="font-normal text-stone-500">({ASSISTANT.fullName})</span>
          </p>
          <p className="mt-1">
            She reads receipts, checks the math and dates, looks at the photos, and suggests who pays what based on your
            lease. She can also explain your bill and keep track of what&apos;s waiting on you.
          </p>
          <p className="mt-1 text-stone-500">She&apos;s an AI assistant, not a person, and she&apos;s on nobody&apos;s side. You two always make the final call.</p>
        </div>
      </div>
      <p className="mt-8 text-sm font-medium text-stone-500">This is a demo. Pick who you are:</p>
      <form action={switchUser} className="mt-3 grid gap-3 sm:grid-cols-2">
        {users.map((u) => (
          <button
            key={u.id}
            name="userId"
            value={u.id}
            className="rounded-2xl bg-white shadow-card p-4 text-left shadow-sm hover:border-stone-400"
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
