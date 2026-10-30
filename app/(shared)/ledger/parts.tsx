import Link from "next/link";
import { ClaimStatus } from "@/app/components/claim-status";
import type { LeaseWithParties, PeriodView } from "@/lib/ledger";
import { formatUsd } from "@/lib/money";
import type { schema } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { PayWithSavedButton, RefreshInvoiceButton } from "./invoice-controls";

// Pieces shared by the ledger, the rent history and a single month's page.

type Claim = typeof schema.claims.$inferSelect;

/** Claims that are done: nothing more will happen to them. */
export const CLOSED: Claim["status"][] = ["settled", "withdrawn", "paid_out"];

export function MoreLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mt-3 inline-block text-sm font-medium text-sky-700 hover:text-sky-900">
      {label} →
    </Link>
  );
}

/** One rent month: its lines, balance, and the invoice's pay or check buttons. */
export function MonthCard({
  p,
  lease,
  role,
  canPaySaved,
  link = true,
  pulse = false,
}: {
  p: PeriodView;
  lease: LeaseWithParties;
  role: "landlord" | "tenant";
  canPaySaved: boolean;
  link?: boolean;
  /** The trial checklist's next step is paying: make the main pay button glow. */
  pulse?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-white shadow-card p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="font-medium">
          {link ? (
            <Link href={`/ledger/${p.period}?lease=${lease.id}`} className="hover:underline">
              {p.label}
            </Link>
          ) : (
            p.label
          )}
        </h3>
        <StatusBadge invoiceStatus={p.invoice?.status ?? null} settled={p.balanceCents === 0} />
      </div>
      <Lines lines={p.entries.map((e) => ({ name: e.description, amountCents: e.amountCents }))} />
      <TotalRow label="Balance" cents={p.balanceCents} />
      {p.invoice?.status === "paid" && p.invoice.totalCents > 0 && (
        <p className="mt-3 text-sm text-stone-500">
          {role === "tenant"
            ? `Paid through PayPal${p.invoice.paidAt ? ` on ${formatDateTime(p.invoice.paidAt)}` : ""}. It may take a little while to show up in ${lease.landlord.name.split(" ")[0]}'s PayPal activity.`
            : `PayPal confirmed this payment${p.invoice.paidAt ? ` on ${formatDateTime(p.invoice.paidAt)}` : ""}. If it isn't in your PayPal activity yet, give it a few minutes; PayPal may also hold funds for a while on some accounts.`}
        </p>
      )}
      {p.invoice && p.invoice.status !== "paid" && (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {/* With a saved PayPal that's the one button; the invoice link stays as a quiet fallback (Venmo, card, a decline). */}
          {role === "tenant" && p.invoice.status === "sent" && canPaySaved && (
            <PayWithSavedButton leaseId={lease.id} invoiceId={p.invoice.id} label={`Pay ${formatUsd(p.invoice.totalCents)} with saved PayPal`} pulse={pulse} />
          )}
          {role === "tenant" && p.invoice.status === "sent" && p.invoice.payerUrl && (
            <a
              href={p.invoice.payerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={
                canPaySaved
                  ? "text-sm text-stone-600 underline hover:text-stone-900"
                  : `rounded-full bg-[#ffc439] px-4 py-2 text-sm font-semibold text-[#003087] hover:bg-[#f2ba36] ${pulse ? "tour-pulse" : ""}`
              }
            >
              {canPaySaved ? "Pay another way" : "Pay with PayPal"}
            </a>
          )}
          {role === "landlord" && <RefreshInvoiceButton invoiceId={p.invoice.id} draft={p.invoice.status === "draft"} />}
        </div>
      )}
    </div>
  );
}

export function ClaimList({ claims, lease }: { claims: Claim[]; lease: LeaseWithParties }) {
  return (
    <ul className="divide-y divide-stone-100 rounded-2xl bg-white shadow-card">
      {claims.map((c) => (
        <li key={c.id}>
          <Link href={`/claims/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-stone-50">
            <span>
              <span className="font-medium">{c.title}</span>
              <span className="ml-2 text-sm text-stone-500">
                {c.submittedBy === lease.landlordId ? "paid by landlord" : "paid by tenant"}
                {c.tenantWantsPayout && (c.status === "approved" || c.status === "awaiting_approval") && " · asked to be paid back now"}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <ClaimStatus status={c.status} />
              <span className="tabular-nums">{formatUsd(c.amountCents ?? 0)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Lines({ lines }: { lines: { name: string; amountCents: number }[] }) {
  return (
    <ul className="mt-3 divide-y divide-stone-100 text-sm">
      {lines.map((l, i) => (
        <li key={i} className="flex justify-between gap-4 py-2">
          <span>{l.name}</span>
          <span className={`tabular-nums ${l.amountCents < 0 ? "text-emerald-700" : ""}`}>{formatUsd(l.amountCents)}</span>
        </li>
      ))}
    </ul>
  );
}

export function TotalRow({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="mt-1 flex justify-between border-t border-stone-200 pt-2 text-sm font-semibold">
      <span>{label}</span>
      <span className="tabular-nums">{formatUsd(cents)}</span>
    </div>
  );
}

export function StatusBadge({ invoiceStatus, settled }: { invoiceStatus: "draft" | "sent" | "paid" | "cancelled" | null; settled: boolean }) {
  const [label, className] =
    invoiceStatus === "sent"
      ? ["Invoice sent · awaiting payment", "bg-sky-50 text-sky-700"]
      : invoiceStatus === "draft"
        ? ["Not sent yet", "bg-red-50 text-red-700"]
        : settled
          ? ["Paid", "bg-emerald-50 text-emerald-700"]
          : ["Open", "bg-amber-50 text-amber-700"];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{label}</span>;
}
