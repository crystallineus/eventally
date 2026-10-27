import { formatUsd, sum, type Cents } from "@/lib/money";
import { formatDate } from "@/lib/period";

// Deterministic checks the agent calls as tools. Results are hints for both parties, not verdicts.

export type CheckStatus = "pass" | "warn" | "fail";
export type CheckResult = { status: CheckStatus; summary: string };

export type Receipt = {
  merchant: string;
  date: string | null; // YYYY-MM-DD
  lineItems: { description: string; amountCents: Cents }[];
  taxCents: Cents | null;
  totalCents: Cents;
};

export function checkMath(receipt: Receipt, claimedCents: Cents): CheckResult {
  const itemsCents = sum(receipt.lineItems.map((i) => i.amountCents)) + (receipt.taxCents ?? 0);
  if (receipt.lineItems.length > 0 && itemsCents !== receipt.totalCents) {
    return {
      status: "fail",
      summary: `Line items${receipt.taxCents ? " plus tax" : ""} add up to ${formatUsd(itemsCents)}, but the receipt total says ${formatUsd(receipt.totalCents)}.`,
    };
  }
  if (receipt.totalCents !== claimedCents) {
    return {
      status: "warn",
      summary: `The receipt total is ${formatUsd(receipt.totalCents)}, but the claim asks for ${formatUsd(claimedCents)}.`,
    };
  }
  return {
    status: "pass",
    summary:
      receipt.lineItems.length > 0
        ? `Line items add up to the receipt total of ${formatUsd(receipt.totalCents)}, which matches the claim.`
        : `The receipt total of ${formatUsd(receipt.totalCents)} matches the claim (no itemized lines to add up).`,
  };
}

export function checkDates(
  receiptDate: string | null,
  issueReportedOn: string, // YYYY-MM-DD
  lease: { startDate: string; endDate: string | null },
  today: string,
): CheckResult {
  if (!receiptDate) return { status: "warn", summary: "The receipt has no readable date." };
  if (receiptDate > today) return { status: "fail", summary: `The receipt is dated ${formatDate(receiptDate)}, which is in the future.` };
  if (receiptDate < lease.startDate || (lease.endDate && receiptDate > lease.endDate)) {
    return { status: "fail", summary: `The receipt date ${formatDate(receiptDate)} is outside the lease term.` };
  }
  if (receiptDate < issueReportedOn) {
    return {
      status: "warn",
      summary: `The receipt (${formatDate(receiptDate)}) is dated before the problem was reported (${formatDate(issueReportedOn)}).`,
    };
  }
  return {
    status: "pass",
    summary: `The receipt (${formatDate(receiptDate)}) is on or after the day the problem was reported and within the lease term.`,
  };
}
