import type { QuotaSnapshot, ResetCredit, UsageWindow } from '../shared/contracts.js';
import { isRecord } from './auth.js';

function timestamp(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 8_640_000_000_000
    ? value * 1_000
    : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function usageWindow(value: unknown): UsageWindow | null {
  if (
    !isRecord(value) ||
    typeof value.usedPercent !== 'number' ||
    !Number.isFinite(value.usedPercent)
  )
    return null;
  return {
    usedPercent: value.usedPercent,
    windowDurationMins:
      typeof value.windowDurationMins === 'number' &&
      Number.isInteger(value.windowDurationMins) &&
      value.windowDurationMins > 0
        ? value.windowDurationMins
        : null,
    resetsAt: timestamp(value.resetsAt),
  };
}

function resetCredit(value: unknown): ResetCredit {
  const row = isRecord(value) ? value : {};
  return {
    id: typeof row.id === 'string' ? row.id : null,
    expiresAt: timestamp(row.expiresAt),
    hasNoExpiration: row.expiresAt === null,
    title: typeof row.title === 'string' ? row.title : null,
    status: typeof row.status === 'string' ? row.status : 'unknown',
    resetType: typeof row.resetType === 'string' ? row.resetType : 'unknown',
  };
}

/** Decode only the Codex bucket; do not mistake another product's quota for Codex. */
export function parseQuota(result: unknown, now = Date.now()): QuotaSnapshot {
  if (!isRecord(result)) throw new Error('The quota service returned unrecognized data.');
  const buckets = isRecord(result.rateLimitsByLimitId) ? result.rateLimitsByLimitId : null;
  const hasCodexBucket = buckets !== null && Object.hasOwn(buckets, 'codex');
  const bucket = hasCodexBucket ? buckets.codex : result.rateLimits;
  if (
    !isRecord(bucket) ||
    (bucket.limitId != null && bucket.limitId !== 'codex') ||
    // A populated map with no Codex entry makes an anonymous legacy bucket
    // ambiguous. Never label another product's quota as Codex.
    (!hasCodexBucket &&
      buckets !== null &&
      Object.keys(buckets).length > 0 &&
      bucket.limitId !== 'codex')
  )
    throw new Error('The quota service returned unrecognized Codex data.');
  const credits = isRecord(bucket.credits) ? bucket.credits : null;
  const resets = isRecord(result.rateLimitResetCredits) ? result.rateLimitResetCredits : null;
  return {
    capturedAt: now,
    windows: [usageWindow(bucket.primary), usageWindow(bucket.secondary)].filter(
      (window): window is UsageWindow => window !== null,
    ),
    planType: typeof bucket.planType === 'string' ? bucket.planType : null,
    ordinaryUsageAllowed: optionalBoolean(result.ordinaryUsageAllowed),
    rateLimitReachedType:
      typeof bucket.rateLimitReachedType === 'string' ? bucket.rateLimitReachedType : null,
    spendControlReached: optionalBoolean(bucket.spendControlReached),
    credits: credits
      ? {
          balance: typeof credits.balance === 'string' ? credits.balance : null,
          unlimited: optionalBoolean(credits.unlimited),
          hasCredits: optionalBoolean(credits.hasCredits),
        }
      : null,
    resetCredits:
      resets &&
      typeof resets.availableCount === 'number' &&
      Number.isSafeInteger(resets.availableCount) &&
      resets.availableCount >= 0
        ? {
            availableCount: resets.availableCount,
            // Missing/null means unknown; [] means fetched and empty. Details may be capped.
            credits: Array.isArray(resets.credits) ? resets.credits.map(resetCredit) : null,
          }
        : null,
  };
}
