import Link from "next/link";
import { condenseReviews } from "@/app/components/event-label";
import { listClaims } from "@/lib/claims";
import { getLedger, getLeasesForUser, roleIn, type LeaseWithParties } from "@/lib/ledger";
import { formatUsd } from "@/lib/money";
import { formatDate, formatLeaseTerm } from "@/lib/period";
import { requireUser } from "@/lib/session";
import { FastForwardButton, PaymentWatcher, SendInvoiceButton } from "./invoice-controls";
import { toggleAutoInvoice, toggleAutopay } from "./actions";
import { SubmitButton } from "@/app/components/submit-button";
import { PostForm } from "@/app/components/busy";
import { AUTO_INVOICE_DAYS, describeLimit, nextDueDate } from "@/lib/schedule";
import { ClaimList, CLOSED, Lines, MonthCard, MoreLink, TotalRow } from "./parts";
import { ASSISTANT } from "@/lib/persona";
import { ActivityList } from "@/app/components/activity-list";
import { Assistant } from "@/app/components/assistant";
import { getTour, nextHrefFor, pulses } from "@/lib/tour";

export default async function LedgerPage({ searchParams }: PageProps<"/ledger">) {
  const user = await requireUser();
  const leases = await getLeasesForUser(user.id);
  const { lease: leaseParam, vault } = await searchParams;
  const lease = leases.find((l) => l.id === leaseParam) ?? leases[0];

  if (!lease) {
    return <p className="text-stone-600">No leases yet. A landlord can add one from Properties.</p>;
  }

  const [ledger, claims, tour] = await Promise.all([getLedger(lease), listClaims(lease.id), getTour(user)]);
  const role = roleIn(lease, user.id);

  const openClaims = claims.filter((c) => !CLOSED.includes(c.status));
  const recentMonths = ledger.periods.filter((p, i) => i === 0 || (p.invoice && p.invoice.status !== "paid"));
  const awaitingPayment = ledger.periods.find((p) => p.invoice?.status === "sent")?.invoice;
  const outstanding = ledger.periods.find((p) => p.invoice?.status === "sent" || p.invoice?.status === "draft");

  return (
    <div className="space-y-10">
      {awaitingPayment && <PaymentWatcher invoiceId={awaitingPayment.id} />}
      <Assistant leaseId={lease.id} role={role} firstName={user.name.split(" ")[0]} pulse={pulses(tour, "aunt_claim")} />
      {leases.length > 1 && (
        <nav className="flex flex-wrap gap-2 text-sm">
          {leases.map((l) => (
            <Link
              key={l.id}
              href={`/ledger?lease=${l.id}`}
              aria-current={l.id === lease.id ? "page" : undefined}
              className="rounded-full border border-stone-300 px-3 py-1 aria-[current=page]:border-stone-900 aria-[current=page]:bg-stone-900 aria-[current=page]:text-white"
            >
              {l.propertyName}
            </Link>
          ))}
        </nav>
      )}

      <LeaseSummary lease={lease} role={role} balanceCents={ledger.balanceCents} />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Repair claims</h2>
          <Link
            href={`/claims/new?lease=${lease.id}`}
            className="rounded-full border border-stone-300 bg-white px-3.5 py-1.5 text-sm font-medium text-stone-800 hover:bg-stone-100"
          >
            New claim
          </Link>
        </div>
        {openClaims.length === 0 ? (
          <p className="rounded-2xl bg-white shadow-card p-5 text-sm text-stone-600">
            {claims.length ? "No open claims." : "No claims yet."} Paid for a repair? Submit the receipt and photos here.
          </p>
        ) : (
          <ClaimList claims={openClaims} lease={lease} pulseHref={nextHrefFor(tour)} />
        )}
        {claims.length > openClaims.length && (
          <MoreLink href={`/claims?lease=${lease.id}`} label={`Show all ${claims.length} claims (${claims.length - openClaims.length} closed)`} />
        )}
      </section>

      <section id="next-invoice" className="scroll-mt-24 rounded-2xl border border-dashed border-stone-300 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Next invoice · {ledger.upcoming.label}</h2>
          <span className="text-sm text-stone-500">Preview — sent via PayPal before rent is due</span>
        </div>
        <Lines lines={ledger.upcoming.invoice.lines} />
        <TotalRow label="Total due" cents={ledger.upcoming.invoice.totalCents} />
        {ledger.upcoming.invoice.carryOverCents > 0 && (
          <p className="mt-2 text-sm text-stone-600">
            {formatUsd(ledger.upcoming.invoice.carryOverCents)} of credit carries over to the following month.
          </p>
        )}
        {role === "landlord" && outstanding ? (
          <p className="mt-3 text-sm text-stone-500">You can send this after the {outstanding.label} invoice is paid.</p>
        ) : role === "landlord" ? (
          <SendInvoiceButton leaseId={lease.id} pulse={pulses(tour, "send_invoice")} />
        ) : (
          <p className="mt-3 text-sm text-stone-500">{lease.landlord.name} sends this as a PayPal invoice before rent is due.</p>
        )}
        <AutoSendRow lease={lease} role={role} />
      </section>

      {user.demoId && (lease.autoInvoiceDays !== null || lease.autopay) && (
        <section className="rounded-2xl bg-sky-50 p-4 ring-1 ring-sky-100">
          <p className="mb-2 text-sm text-sky-900">
            <span className="font-medium">Demo shortcut.</span> The schedule really runs once a day; skip ahead to the next due date and run it now.
          </p>
          <FastForwardButton leaseId={lease.id} dueLabel={formatDate(await nextDueDate(lease))} />
        </section>
      )}

      {role === "tenant" && (
        <SavedPayPal
          email={user.paypalVaultId ? (user.paypalVaultEmail ?? "your PayPal") : null}
          notice={typeof vault === "string" ? vault : null}
          lease={lease}
        />
      )}

      <section id="rent" className="scroll-mt-24">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Rent</h2>
        <div className="space-y-4">
          {/* Anything not paid yet, plus the latest month; older months are on the history page. */}
          {recentMonths.map((p) => (
            <MonthCard key={p.period} p={p} lease={lease} role={role} canPaySaved={!!user.paypalVaultId} pulse={pulses(tour, "pay")} />
          ))}
        </div>
        {ledger.periods.length > recentMonths.length && (
          <MoreLink href={`/ledger/history?lease=${lease.id}`} label={`Show all ${ledger.periods.length} months`} />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Activity log</h2>
        <p className="mb-3 text-sm text-stone-500">
          Every step — agent checks and reasoning, approvals, payments — is recorded here and visible to both of you.
        </p>
        <ActivityList events={condenseReviews(ledger.events)} />
      </section>
    </div>
  );
}

const VAULT_NOTICE: Record<string, string> = {
  saved: "Saved. You can now pay rent with one press of Confirm.",
  cancelled: "Nothing was saved.",
  failed: "PayPal couldn't save it. Try again in a moment.",
  removed: "Removed. Rent is paid with the invoice link again.",
};

/** Tenant: save a PayPal once (PayPal Vault) so rent can be paid without logging in each month. */
/** Landlord's switch for sending the next invoice automatically; the tenant just sees whether it's on. */
function AutoSendRow({ lease, role }: { lease: LeaseWithParties; role: "landlord" | "tenant" }) {
  const on = lease.autoInvoiceDays !== null;
  if (role === "tenant") {
    return on ? <p className="mt-2 text-sm text-stone-500">It goes out automatically {lease.autoInvoiceDays} days before rent is due.</p> : null;
  }
  return (
    <form action={toggleAutoInvoice} className="mt-4 flex flex-wrap items-center gap-3 border-t border-stone-100 pt-3 text-sm">
      <input type="hidden" name="leaseId" value={lease.id} />
      <input type="hidden" name="on" value={on ? "0" : "1"} />
      <span className="text-stone-700">
        {on ? `✓ Sent automatically ${lease.autoInvoiceDays} days before rent is due, with any approved repairs.` : `Send it automatically ${AUTO_INVOICE_DAYS} days before rent is due, every month.`}
      </span>
      <SubmitButton pendingLabel="Saving…" className={on ? "text-stone-500 underline hover:text-stone-800" : "rounded-full border border-stone-300 bg-white px-3 py-1 font-medium text-stone-800 hover:bg-stone-100"}>
        {on ? "Turn off" : "Turn on"}
      </SubmitButton>
    </form>
  );
}

function SavedPayPal({ email, notice, lease }: { email: string | null; notice: string | null; lease: LeaseWithParties }) {
  return (
    <section className="rounded-2xl bg-white shadow-card p-5">
      <h2 className="text-lg font-semibold tracking-tight">Saved PayPal for rent</h2>
      {email ? (
        <p className="mt-1 text-sm text-stone-600">
          {email} is saved. When a rent invoice arrives, you or {ASSISTANT.name} can pay it with one press of Confirm; nothing is charged without it.
        </p>
      ) : (
        <p className="mt-1 text-sm text-stone-600">
          Save your PayPal once, and paying each month&apos;s invoice becomes one press of Confirm, here or in a chat with {ASSISTANT.name}. You approve it on PayPal and can remove it any time.
        </p>
      )}
      <PostForm
        action={email ? "/api/vault/remove" : "/api/vault/start"}
        message={email ? "Removing your saved PayPal…" : "Opening PayPal…"}
        className="mt-3 flex flex-wrap items-center gap-3"
      >
        {email ? (
          <button className="text-sm text-stone-600 underline hover:text-stone-900">Remove saved PayPal</button>
        ) : (
          <button className="rounded-full bg-[#ffc439] px-4 py-2 text-sm font-semibold text-[#003087] hover:bg-[#f2ba36]">Save</button>
        )}
        {notice && VAULT_NOTICE[notice] && <span className="text-sm text-stone-500">{VAULT_NOTICE[notice]}</span>}
      </PostForm>
      {email && (
        <form action={toggleAutopay} className="mt-4 flex flex-wrap items-center gap-3 border-t border-stone-100 pt-3 text-sm">
          <input type="hidden" name="leaseId" value={lease.id} />
          <input type="hidden" name="on" value={lease.autopay ? "0" : "1"} />
          <span className="text-stone-700">
            {lease.autopay
              ? `✓ Autopay is on: invoices up to ${describeLimit(lease)} are paid on the due date. A bigger one waits for you.`
              : `Autopay: pay each invoice on its due date with this PayPal (up to ${describeLimit(lease)}; a bigger one waits for you).`}
          </span>
          <SubmitButton pendingLabel="Saving…" className={lease.autopay ? "text-stone-500 underline hover:text-stone-800" : "rounded-full border border-stone-300 bg-white px-3 py-1 font-medium text-stone-800 hover:bg-stone-100"}>
            {lease.autopay ? "Turn off" : "Turn on"}
          </SubmitButton>
        </form>
      )}
    </section>
  );
}

function LeaseSummary({ lease, role, balanceCents }: { lease: LeaseWithParties; role: "landlord" | "tenant"; balanceCents: number }) {
  const landlord = lease.landlord.businessName ? `${lease.landlord.name} · ${lease.landlord.businessName}` : lease.landlord.name;
  return (
    <section className="grid gap-4 rounded-2xl bg-white shadow-card p-5 sm:grid-cols-[1fr_auto]">
      <div>
        <p className="text-sm text-stone-500">You are the {role}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{lease.propertyName}</h1>
        <p className="text-stone-600">{lease.address}</p>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Field label="Landlord" value={landlord} />
          <Field label="Tenant" value={lease.tenant?.name ?? "Invite pending"} />
          <Field label="Rent" value={`${formatUsd(lease.rentCents)} / month`} />
          <Field label="Due" value={`Day ${lease.dueDay} of each month`} />
          <Field label="Lease term" value={formatLeaseTerm(lease.startDate, lease.endDate)} />
        </dl>
      </div>
      <div className="rounded-xl bg-sky-50 p-4 sm:min-w-48 sm:text-right">
        <p className="text-sm text-sky-700">Balance owed</p>
        <p className="text-2xl font-semibold tabular-nums">{formatUsd(balanceCents)}</p>
        <p className="text-sm text-stone-500">{balanceCents === 0 ? "All settled" : "Outstanding"}</p>
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-stone-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
