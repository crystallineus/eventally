import { redirect } from "next/navigation";
import { switchUser } from "@/app/actions";
import { AuntTallyAvatar } from "@/app/components/aunt-tally";
import { DEMO_DAYS } from "@/lib/demo";
import { ASSISTANT } from "@/lib/persona";
import { getCurrentUser, getDemoUsers } from "@/lib/session";

export default async function Home({ searchParams }: PageProps<"/">) {
  if (await getCurrentUser()) redirect("/ledger");
  const [users, { demo }] = await Promise.all([getDemoUsers(), searchParams]);

  return (
    <div className="mx-auto max-w-xl py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Repairs, settled on the next rent.</h1>
      <p className="mt-3 text-stone-600">
        A tenant or landlord fronts a repair, uploads the receipt, and Aunt Tally, our AI assistant, checks the evidence against the
        lease. Once both sides agree, the amount lands on next month&apos;s PayPal rent invoice.
      </p>
      <div className="mt-6 flex items-start gap-3 rounded-2xl bg-sky-50 p-4 ring-1 ring-sky-100">
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
      <p className="mt-8 text-sm font-medium text-stone-500">This is a demo with fictional people and PayPal sandbox money. Pick who you are:</p>
      {users.length ? (
        <form action={switchUser} className="mt-3 grid gap-3 sm:grid-cols-2">
          {users.map((u) => (
            <PersonButton key={u.id} name="userId" value={u.id} title={u.name} subtitle={`${u.role}${u.businessName ? ` · ${u.businessName}` : ""}`} />
          ))}
        </form>
      ) : (
        // First visit: each visitor gets their own copy of the demo, so nobody steps on anyone else.
        <form action="/api/demo/start" method="post" className="mt-3 grid gap-3 sm:grid-cols-2">
          <PersonButton name="role" value="tenant" title="Maya Chen" subtitle="tenant · paid a plumber, waiting on Tom" />
          <PersonButton name="role" value="landlord" title="Tom Becker" subtitle="landlord · SJ Rentals · a claim is waiting on you" />
        </form>
      )}
      {demo === "failed" && <p className="mt-3 text-sm text-red-700">The demo couldn&apos;t start. Please try again in a moment.</p>}
      <p className="mt-4 text-sm text-stone-500">Your demo is private to this browser and resets after {DEMO_DAYS} days. You can switch between Tom and Maya at the top.</p>
    </div>
  );
}

function PersonButton({ name, value, title, subtitle }: { name: string; value: string; title: string; subtitle: string }) {
  return (
    <button name={name} value={value} className="rounded-2xl bg-white p-4 text-left shadow-card ring-1 ring-transparent hover:ring-sky-300">
      <span className="block font-medium">{title}</span>
      <span className="block text-sm text-stone-500 first-letter:uppercase">{subtitle}</span>
    </button>
  );
}
