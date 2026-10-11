import type { QuotaSnapshot, SubscriptionInfo } from '../shared/contracts';

/** Synthetic data only. Preview never reads credentials or contacts Codex. */
export function previewData(): { snapshot: QuotaSnapshot; subscription: SubscriptionInfo } {
  const now = Date.now();
  return {
    snapshot: {
      capturedAt: now,
      windows: [{ usedPercent: 28, windowDurationMins: 10080, resetsAt: now + 3 * 86400000 }],
      planType: 'plus',
      credits: { balance: '120', unlimited: false, hasCredits: true },
      resetCredits: {
        availableCount: 2,
        credits: [
          {
            id: 'demo-credit-1',
            status: 'available',
            resetType: 'codexRateLimits',
            expiresAt: now + 5 * 86400000,
            hasNoExpiration: false,
            title: null,
          },
          {
            id: 'demo-credit-2',
            status: 'available',
            resetType: 'codexRateLimits',
            expiresAt: now + 12 * 86400000,
            hasNoExpiration: false,
            title: null,
          },
        ],
      },
    },
    subscription: {
      activeUntil: now + 22 * 86400000,
      willRenew: true,
      checkedAt: now,
      source: 'manual',
    },
  };
}
