import type { Metadata } from "next";
import { AuntTallyAvatar } from "@/app/components/aunt-tally";
import { ASSISTANT } from "@/lib/persona";

export const metadata: Metadata = {
  title: "About · EvenTally",
  description: "Meet Aunt Tally, EvenTally's AI assistant, and how she helps landlords and tenants settle repairs fairly.",
};

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-8 py-6">
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
          In an elephant family, the aunties help raise every calf, not only their own. And an elephant never forgets: I keep
          every receipt, photo and &ldquo;yes&rdquo; in one ledger you can both read.
        </p>
        <p>
          When one of you pays for a repair, I check the receipt and photos against the lease and suggest a fair split, with
          my reasons. Once you both agree, it goes on the next PayPal rent invoice. Eventually, everyone gets paid back fairly.
        </p>
      </section>

      <section className="rounded-2xl bg-white shadow-card p-6">
        <h2 className="text-lg font-semibold tracking-tight">What I can do for you</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-stone-700">
          <li>Review a repair claim and suggest who pays what.</li>
          <li>File a claim right from our chat. Tell me what broke and send a few photos.</li>
          <li>Explain a bill line by line, and tell you what&apos;s waiting on you.</li>
          <li>Send an invoice or a reminder, pay rent with your saved PayPal, or turn on autopay, but only after you confirm.</li>
        </ul>
      </section>

      <section className="rounded-2xl bg-white shadow-card p-6">
        <h2 className="text-lg font-semibold tracking-tight">What I won&apos;t do</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-stone-700">
          <li>Decide for either of you. A claim moves forward only when you both approve.</li>
          <li>Move money without asking. Autopay and auto-send follow the rules you set, not my judgment.</li>
          <li>Judge whether a receipt is genuine or give legal advice. My checks are hints, not verdicts.</li>
          <li>Take sides, or pretend to be a person. I&apos;m an AI assistant, and I&apos;ll always say so.</li>
        </ul>
      </section>
    </article>
  );
}
