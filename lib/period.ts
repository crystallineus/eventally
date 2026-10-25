// Rent periods are "YYYY-MM" strings.

const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/;

function parse(period: string): [number, number] {
  const match = PERIOD.exec(period);
  if (!match) throw new Error(`Not a period: "${period}"`);
  return [Number(match[1]), Number(match[2])];
}

export function nextPeriod(period: string): string {
  const [year, month] = parse(period);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** "2026-12" -> "December 2026" */
export function formatPeriod(period: string): string {
  const [year, month] = parse(period);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Period containing a "YYYY-MM-DD" date. */
export function periodOf(isoDate: string): string {
  const period = isoDate.slice(0, 7);
  parse(period);
  return period;
}
