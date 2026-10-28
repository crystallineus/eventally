import type { Metadata } from "next";
import Link from "next/link";
import { AuntTallyAvatar } from "@/app/components/aunt-tally";
import { ASSISTANT } from "@/lib/persona";

export const metadata: Metadata = {
  title: "About · EvenTally",
  description: "Meet Aunt Tally, EvenTally's AI assistant, and how she helps landlords and tenants settle repairs fairly.",
};

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-10 py-6">
      <header className="flex flex-col items-center text-center">
        <AuntTallyAvatar size={140} label />
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{ASSISTANT.name}</h1>
        <p className="mt-1 text-stone-500">
          {ASSISTANT.fullName} · Elephant auntie · {ASSISTANT.disclosure}
        </p>
      </header>

      <section className="space-y-4 text-lg leading-relaxed text-stone-800">
        <p>Hello, dear. I&apos;m Aunt Tally.</p>
        <p>
          In an elephant family, the older females help raise every calf, not only their own. Scientists call them allomothers.
          Everyone else calls them aunties. I come from a long line of aunties.
        </p>
        <p>
          You may have heard that an elephant never forgets. I keep every receipt, every photo, every offer and every
          &ldquo;yes&rdquo; in one ledger that both of you can read. I keep the tally so nobody has to keep score.
        </p>
        <p>
          When a pipe leaks and one of you pays the plumber, I read the receipt, check the math and the dates, look at the
          photos and open the lease. Then I suggest who pays what, and I say why.
        </p>
        <p>
          My family settled dessert the old way: one person cuts, the other person chooses. I&apos;ll suggest where to cut. You
          two decide who gets which slice. Once you both say yes, it goes on next month&apos;s rent invoice through PayPal, or the
          landlord pays it back right away.
        </p>
        <p>I can also explain a bill line by line, and tell you what&apos;s waiting on you.</p>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <h2 className="font-semibold">What I won&apos;t do</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-stone-700">
          <li>Decide for you. Nothing moves until both of you approve.</li>
          <li>Touch your money. I can suggest a split; only people send invoices or payouts.</li>
          <li>Judge whether a receipt is genuine. My checks are hints, not verdicts.</li>
          <li>Give legal advice or take sides.</li>
          <li>Pretend to be a person. I&apos;m an AI assistant, and I&apos;ll always say so.</li>
        </ul>
      </section>

      <footer className="space-y-6">
        <p className="text-right text-stone-600 italic">
          &mdash; {ASSISTANT.name} ({ASSISTANT.fullName}), {ASSISTANT.disclosure}, EvenTally
        </p>
        <p className="text-center">
          <Link href="/" className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700">
            Try the demo
          </Link>
        </p>
      </footer>
    </article>
  );
}
