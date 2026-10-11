import assert from 'node:assert/strict';
import test from 'node:test';
import { parseQuota } from '../../src/core/quota.js';

test('Codex bucket takes precedence and timestamps become milliseconds', () => {
  const result = parseQuota(
    {
      rateLimits: { planType: 'legacy' },
      rateLimitsByLimitId: {
        codex: {
          planType: 'pro',
          primary: { usedPercent: 18, windowDurationMins: 10080, resetsAt: 1_800_000_000 },
          credits: { balance: '10.50', unlimited: false, hasCredits: true },
        },
      },
      rateLimitResetCredits: {
        availableCount: 2,
        credits: [
          { id: 'a', status: 'available', resetType: 'codexRateLimits', expiresAt: 1_900_000_000 },
          { id: 'b', status: 'available', resetType: 'codexRateLimits', expiresAt: null },
        ],
      },
    },
    123,
  );
  assert.equal(result.capturedAt, 123);
  assert.equal(result.planType, 'pro');
  assert.equal(result.windows[0].resetsAt, 1_800_000_000_000);
  assert.equal(result.resetCredits?.credits?.[0].expiresAt, 1_900_000_000_000);
  assert.equal(result.resetCredits?.credits?.[1].hasNoExpiration, true);
});

test('missing, empty, capped, and unknown expiry details remain distinct', () => {
  for (const rows of [null, [], [{ id: 'a' }]]) {
    const result = parseQuota({
      rateLimits: {},
      rateLimitResetCredits: { availableCount: 5, credits: rows },
    });
    assert.equal(result.resetCredits?.availableCount, 5);
    assert.equal(result.resetCredits?.credits?.length ?? null, rows?.length ?? null);
    if (rows?.length) assert.equal(result.resetCredits?.credits?.[0].hasNoExpiration, false);
  }
});

test('invalid numeric windows are ignored and other product buckets are not used', () => {
  assert.equal(parseQuota({ rateLimits: { primary: { usedPercent: NaN } } }).windows.length, 0);
  assert.throws(() => parseQuota({ rateLimitsByLimitId: { anotherProduct: {} } }), /unrecognized/);
});
