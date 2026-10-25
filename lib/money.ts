// All money is integer cents (USD). Never use floats for amounts.

export type Cents = number;

export function assertCents(value: number, label = "amount"): asserts value is Cents {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be an integer number of cents, got ${value}`);
}

/** Parse "1805", "1805.5", "1,805.00", "$1,805.00" or "-240.00" into cents without float math. */
export function parseUsd(input: string): Cents {
  const match = /^(-)?\$?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) throw new Error(`Not a USD amount: "${input}"`);
  const [, sign, dollars, fraction = ""] = match;
  const cents = Number(dollars.replaceAll(",", "")) * 100 + Number(fraction.padEnd(2, "0"));
  return sign ? -cents : cents;
}

/** PayPal API value string, e.g. 180500 -> "1805.00", -24000 -> "-240.00". */
export function toApiValue(cents: Cents): string {
  assertCents(cents);
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Display string, e.g. 180500 -> "$1,805.00", -24000 -> "-$240.00". */
export function formatUsd(cents: Cents): string {
  assertCents(cents);
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${cents < 0 ? "-" : ""}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

export function sum(values: Cents[]): Cents {
  return values.reduce((total, v) => {
    assertCents(v);
    return total + v;
  }, 0);
}

/**
 * Split a total by the landlord's share in basis points (10000 = 100%).
 * Rounds the landlord share half-up; the tenant gets the remainder so both always add up to the total.
 */
export function splitByShare(totalCents: Cents, landlordBasisPoints: number): { landlord: Cents; tenant: Cents } {
  assertCents(totalCents, "total");
  if (totalCents < 0) throw new Error("total must not be negative");
  if (!Number.isInteger(landlordBasisPoints) || landlordBasisPoints < 0 || landlordBasisPoints > 10000) {
    throw new Error(`landlord share must be 0–10000 basis points, got ${landlordBasisPoints}`);
  }
  const landlord = Math.floor((totalCents * landlordBasisPoints + 5000) / 10000);
  return { landlord, tenant: totalCents - landlord };
}

export type Adjustment = {
  kind: "credit" | "charge";
  /** Always positive; `kind` decides the sign. */
  amountCents: Cents;
  description: string;
  claimId?: string;
};

export type InvoiceLine = { name: string; amountCents: Cents; claimId?: string };

export type RentInvoice = {
  lines: InvoiceLine[];
  totalCents: Cents;
  /** Credit that didn't fit this period and must roll into the next one (0 if none). */
  carryOverCents: Cents;
};

/**
 * Build next period's rent invoice: rent, then charges, then credits as negative lines.
 * PayPal rejects invoices with a negative total, so excess credit becomes a positive
 * "carried over" line that brings the total to exactly $0 and is returned as carryOverCents.
 */
export function buildRentInvoice(rent: { name: string; amountCents: Cents }, adjustments: Adjustment[]): RentInvoice {
  assertCents(rent.amountCents, "rent");
  for (const a of adjustments) {
    assertCents(a.amountCents, a.description);
    if (a.amountCents <= 0) throw new Error(`Adjustment "${a.description}" must be positive; use kind for the sign`);
  }

  const lines: InvoiceLine[] = [
    { name: rent.name, amountCents: rent.amountCents },
    ...adjustments
      .filter((a) => a.kind === "charge")
      .map((a) => ({ name: a.description, amountCents: a.amountCents, claimId: a.claimId })),
    ...adjustments
      .filter((a) => a.kind === "credit")
      .map((a) => ({ name: a.description, amountCents: -a.amountCents, claimId: a.claimId })),
  ];

  const raw = sum(lines.map((l) => l.amountCents));
  if (raw >= 0) return { lines, totalCents: raw, carryOverCents: 0 };

  const carryOverCents = -raw;
  lines.push({ name: "Credit carried over to next period", amountCents: carryOverCents });
  return { lines, totalCents: 0, carryOverCents };
}
