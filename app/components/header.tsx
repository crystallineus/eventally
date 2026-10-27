import Link from "next/link";
import { switchUser } from "@/app/actions";
import { getCurrentUser, getDemoUsers } from "@/lib/session";

export async function Header() {
  const [current, users] = await Promise.all([getCurrentUser(), getDemoUsers()]);
  const isLandlord = users.find((u) => u.id === current?.id)?.role === "landlord";

  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight text-stone-900">
          EvenTally
        </Link>
        {current && (
          <nav className="flex gap-4 text-sm text-stone-600">
            <Link href="/ledger" className="hover:text-stone-900">
              Ledger
            </Link>
            {isLandlord && (
              <Link href="/properties" className="hover:text-stone-900">
                Properties
              </Link>
            )}
          </nav>
        )}
        <form action={switchUser} className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-stone-500">Demo view as</span>
          {users.map((u) => (
            <button
              key={u.id}
              name="userId"
              value={u.id}
              aria-pressed={u.id === current?.id}
              className="rounded-full border border-stone-300 px-3 py-1 text-stone-700 hover:bg-stone-100 aria-pressed:border-stone-900 aria-pressed:bg-stone-900 aria-pressed:text-white"
            >
              {u.name.split(" ")[0]} <span className="opacity-70">({u.role})</span>
            </button>
          ))}
        </form>
      </div>
    </header>
  );
}
