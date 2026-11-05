import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  crossedQuotaBoundary,
  isQuotaCurrent,
  shouldRefreshQuota,
} from '../../src/shared/freshness';
import { DEFAULT_SETTINGS, validateSettings } from '../../src/main/settings';
import { snapshot, credit } from '../core/helpers';

test('stale readings and crossed server dates cannot be presented as current quota', () => {
  const value = snapshot([credit()]);
  const now = value.capturedAt;
  value.windows = [{ usedPercent: 100, windowDurationMins: 300, resetsAt: now + 10_000 }];
  assert.equal(isQuotaCurrent(value, now + 9_999), true);
  assert.equal(isQuotaCurrent(value, now + 10_000), false);
  assert.equal(value.windows[0].usedPercent, 100);
  assert.equal(crossedQuotaBoundary(value, now + 10_000), true);
  value.capturedAt = now + 10_001;
  assert.equal(isQuotaCurrent(value, now + 10_001), true);
  assert.equal(isQuotaCurrent(value, now + 60_000), false);
  assert.equal(isQuotaCurrent(value, now - 1), false);
});

test('foreground return and reset expiry trigger reads but respect a five second gap', () => {
  const value = snapshot([credit()]);
  const now = value.capturedAt;
  value.resetCredits!.credits![0].expiresAt = now + 6_000;
  assert.equal(shouldRefreshQuota(value, now, 900, true, now + 4_999), false);
  assert.equal(shouldRefreshQuota(value, now, 900, true, now + 5_000), true);
  assert.equal(shouldRefreshQuota(value, now, 900, false, now + 6_000), true);
  value.capturedAt = now + 6_001;
  assert.equal(shouldRefreshQuota(value, now + 6_001, 900, false, now + 12_000), false);
  assert.equal(shouldRefreshQuota(value, now, 15, false, now + 15_000), true);
});

test('new installs poll every fifteen seconds and explicit slower preferences remain supported', () => {
  assert.equal(DEFAULT_SETTINGS.refreshSeconds, 15);
  assert.equal(validateSettings({ refreshSeconds: 5 }).refreshSeconds, 5);
  assert.equal(validateSettings({ refreshSeconds: 900 }).refreshSeconds, 900);
  assert.throws(() => validateSettings({ refreshSeconds: 4 }));
});
