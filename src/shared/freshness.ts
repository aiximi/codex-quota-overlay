import type { QuotaSnapshot } from './contracts';

export const QUOTA_FRESHNESS_MS = 45_000;
export const MIN_REFRESH_GAP_MS = 5_000;
export const SUBSCRIPTION_REFRESH_MS = 60_000;

/** A local clock crossing a server date asks for a read; it never proves a reset. */
export function crossedQuotaBoundary(snapshot: QuotaSnapshot, now: number): boolean {
  const dates = [
    ...snapshot.windows.map((window) => window.resetsAt),
    ...(snapshot.resetCredits?.credits ?? [])
      .filter((credit) => credit.status === 'available')
      .map((credit) => credit.expiresAt),
  ];
  return dates.some((date) => date !== null && date > snapshot.capturedAt && date <= now);
}

export function isQuotaCurrent(snapshot: QuotaSnapshot | null, now = Date.now()): boolean {
  return (
    !!snapshot &&
    Number.isFinite(snapshot.capturedAt) &&
    now >= snapshot.capturedAt &&
    now - snapshot.capturedAt <= QUOTA_FRESHNESS_MS &&
    !crossedQuotaBoundary(snapshot, now)
  );
}

export function shouldRefreshQuota(
  snapshot: QuotaSnapshot | null,
  lastRead: number,
  refreshSeconds: number,
  foregroundPending: boolean,
  now: number,
): boolean {
  if (lastRead !== 0 && now - lastRead < MIN_REFRESH_GAP_MS) return false;
  return (
    lastRead === 0 ||
    foregroundPending ||
    now - lastRead >= refreshSeconds * 1_000 ||
    (!!snapshot && crossedQuotaBoundary(snapshot, now))
  );
}
