import { redirect } from "next/navigation";
import { switchUser } from "@/app/actions";
import { AuntTallyAvatar } from "@/app/components/aunt-tally";
import { FormBusy, PostForm } from "@/app/components/busy";
import { DEMO_DAYS } from "@/lib/demo";
import { ASSISTANT } from "@/lib/persona";
import { getCurrentUser, getDemoUsers } from "@/lib/session";

export default async function Home({ searchParams }: PageProps<"/">) {
  if (await getCurrentUser()) redirect("/ledger");
  const [users, { demo }] = await Promise.all([getDemoUsers(), searchParams]);

  const tom = users.find((u) => u.role === "landlord");

  return (
    <div className="mx-auto max-w-2xl py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Eventually, everyone gets paid back fairly.</h1>
      <p className="mt-3 text-stone-600">
        EvenTally settles repair costs between landlords and tenants, in either direction. Whoever pays for a repair submits the
        receipt and photos; {ASSISTANT.name}, our AI assistant, checks them against the lease and proposes a fair split. Once both
        sides approve, it lands on the next PayPal rent invoice.
      </p>

      <ul className="mt-8 grid gap-3 sm:grid-cols-3">
        <Person
          avatar={<AuntTallyAvatar size={44} />}
          name={ASSISTANT.name}
          role="AI assistant"
          about="Reviews receipts, photos and the lease, then proposes who pays what. She can act for you, but only after you confirm."
        />
        <Person
          avatar={<Initials text="TB" className="bg-ink text-white" />}
          name="Tom Becker"
          role="Landlord · SJ Rentals"
          about="Bills rent through PayPal invoices. Maya's sink repair is waiting for his approval."
        />
        <Person
          avatar={<Initials text="MC" className="bg-sky-200 text-sky-900" />}
          name="Maya Chen"
          role="Tenant"
          about="Paid a plumber when the kitchen sink leaked, and wants it credited on her next rent."
        />
      </ul>

      <p className="mt-8 text-stone-600">
        You&apos;ll start as Tom, the landlord. Switch between Tom and Maya at the top right to see both sides. Your demo is private
        to this browser and resets after {DEMO_DAYS} days.
      </p>
      {tom ? (
        // Came back after picking someone else on a demo that still exists: open it as Tom.
        <form action={switchUser} className="mt-5">
          <input type="hidden" name="userId" value={tom.id} />
          <StartButton />
          <FormBusy message="Opening your demo…" />
        </form>
      ) : (
        // First visit: each visitor gets their own copy of the demo, so nobody steps on anyone else.
        <PostForm action="/api/demo/start" message="Setting up your demo…" className="mt-5">
          <input type="hidden" name="role" value="landlord" />
          <StartButton />
        </PostForm>
      )}
      {demo === "failed" && <p className="mt-3 text-sm text-red-700">The demo couldn&apos;t start. Please try again in a moment.</p>}
      <p className="mt-4 text-xs text-stone-500">Fictional people and data · PayPal sandbox, no real money moves.</p>
    </div>
  );
}

function Person({ avatar, name, role, about }: { avatar: React.ReactNode; name: string; role: string; about: string }) {
  return (
    <li className="rounded-2xl bg-white p-4 shadow-card">
      {avatar}
      <p className="mt-3 font-semibold text-stone-900">{name}</p>
      <p className="text-xs font-medium text-sky-700">{role}</p>
      <p className="mt-2 text-sm text-stone-600">{about}</p>
    </li>
  );
}

function Initials({ text, className }: { text: string; className: string }) {
  return <span className={`grid size-11 place-items-center rounded-full text-sm font-semibold ${className}`}>{text}</span>;
}

function StartButton() {
  return <button className="rounded-full bg-sky-600 px-6 py-2.5 font-medium text-white shadow-card hover:bg-sky-700">Start as Tom</button>;
}
