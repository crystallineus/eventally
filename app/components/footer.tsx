import Link from "next/link";
import { ASSISTANT } from "@/lib/persona";

// Site footer: brand on the left, links in the middle, copyright on the right (stacks on mobile).
export function Footer() {
  return (
    <footer className="mt-20 border-t border-stone-200">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row">
        <Link href="/" className="text-sm font-semibold text-stone-900">
          EvenTally
        </Link>
        <nav className="flex flex-col items-center gap-1 text-center">
          <Link href="/about" className="text-sm text-stone-600 transition-opacity hover:opacity-70">
            About {ASSISTANT.name}
          </Link>
          <span className="text-xs text-stone-400">Demo · PayPal sandbox · fictional data</span>
        </nav>
        <p className="text-xs text-stone-500">© 2026 EvenTally</p>
      </div>
    </footer>
  );
}
