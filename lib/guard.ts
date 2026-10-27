import { formatUsd, parseUsd, type Cents } from "@/lib/money";

// Rule: every dollar amount in a message the agent writes for the landlord or tenant must match
// a number the program knows (receipt fields, claim amount, computed shares, rent, reference
// ranges). Anything else is blocked and sent back to the agent to restate.

const AMOUNT = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;

export function amountsIn(text: string): Cents[] {
  return [...text.matchAll(AMOUNT)].map((m) => parseUsd(`${m[1]}${m[2] ? `.${m[2]}` : ""}`));
}

/** Returns the amounts in `text` that aren't in `allowed`, formatted for an error message. */
export function unknownAmounts(text: string, allowed: Iterable<Cents>): string[] {
  const known = new Set(allowed);
  return [...new Set(amountsIn(text).filter((c) => !known.has(c)))].map(formatUsd);
}
