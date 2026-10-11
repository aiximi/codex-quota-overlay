import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import type { QuotaSnapshot, ResetCredit } from '../../src/shared/contracts.js';
import { accountKey, type Credentials } from '../../src/core/auth.js';

export function temporaryDirectory(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'codex-quota-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

export function credentials(account = 'test-account'): Credentials {
  const payload = Buffer.from(
    JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: account },
    }),
  ).toString('base64url');
  return { accountID: account, accountKey: accountKey(account), token: `test.${payload}.fixture` };
}

export function credit(id = 'test-credit'): ResetCredit {
  return {
    id,
    status: 'available',
    resetType: 'codexRateLimits',
    title: null,
    expiresAt: Date.now() + 86_400_000,
    hasNoExpiration: false,
  };
}

export function snapshot(rows: ResetCredit[] | null, count = 2): QuotaSnapshot {
  return {
    capturedAt: Date.now(),
    windows: [],
    credits: null,
    planType: 'test',
    resetCredits: { availableCount: count, credits: rows },
  };
}
