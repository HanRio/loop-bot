// Ranking periods run on Korean time: weeks start Monday 00:00 KST, months on the 1st. KST has no DST.
const KST_OFFSET_SEC = 9 * 3600;
export const RANKING_LIMIT = 10;

export type Period = "week" | "month";

export const isPeriod = (value: unknown): value is Period => value === "week" || value === "month";

/** The UTC instant where the current KST week or month began. */
export function periodStart(period: Period, nowSec: number): Date {
  // Read the UTC fields of a shifted date as the KST wall clock.
  const kst = new Date((nowSec + KST_OFFSET_SEC) * 1000);
  const day = period === "month" ? 1 : kst.getUTCDate() - ((kst.getUTCDay() + 6) % 7);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), day) - KST_OFFSET_SEC * 1000);
}
