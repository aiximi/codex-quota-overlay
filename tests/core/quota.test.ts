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

test('explicit other-product and ambiguous legacy buckets cannot become Codex usage', () => {
  for (const value of [
    { rateLimits: { limitId: 'anotherProduct', primary: { usedPercent: 42 } } },
    { rateLimitsByLimitId: { anotherProduct: {} }, rateLimits: { primary: { usedPercent: 42 } } },
    { rateLimitsByLimitId: { codex: { limitId: 'anotherProduct' } } },
    { rateLimitsByLimitId: { codex: null }, rateLimits: { limitId: 'codex' } },
  ])
    assert.throws(() => parseQuota(value), /unrecognized Codex/);
  assert.equal(
    parseQuota({
      rateLimitsByLimitId: { anotherProduct: {} },
      rateLimits: { limitId: 'codex', primary: { usedPercent: 19 } },
    }).windows[0].usedPercent,
    19,
  );
});

test('unknown permission, credit, and reset values are not converted into recovery or zero', () => {
  const unknown = parseQuota({ rateLimits: { credits: {} } });
  assert.deepEqual(unknown.credits, { balance: null, unlimited: null, hasCredits: null });
  assert.equal(unknown.ordinaryUsageAllowed, null);
  assert.equal(unknown.spendControlReached, null);
  assert.equal(unknown.rateLimitReachedType, null);
  for (const count of [-1, NaN, Infinity, 1.5, '2', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(
      parseQuota({ rateLimits: {}, rateLimitResetCredits: { availableCount: count } }).resetCredits,
      null,
    );
  }
  const blocked = parseQuota({
    ordinaryUsageAllowed: false,
    rateLimits: {
      primary: { usedPercent: 0, resetsAt: 1 },
      spendControlReached: true,
      rateLimitReachedType: 'rate_limit_reached',
    },
  });
  assert.equal(blocked.ordinaryUsageAllowed, false);
  assert.equal(blocked.spendControlReached, true);
  assert.equal(blocked.rateLimitReachedType, 'rate_limit_reached');
});

test('malformed reset timestamps remain unknown instead of no-expiration or invalid dates', () => {
  for (const expiresAt of [undefined, -1, 0, NaN, Infinity, '1800000000', 8_640_000_000_001]) {
    const result = parseQuota({
      rateLimits: { primary: { usedPercent: 20, resetsAt: expiresAt } },
      rateLimitResetCredits: { availableCount: 1, credits: [{ expiresAt }] },
    });
    assert.equal(result.windows[0].resetsAt, null);
    assert.equal(result.resetCredits?.credits?.[0].expiresAt, null);
    assert.equal(result.resetCredits?.credits?.[0].hasNoExpiration, false);
  }
});
