import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSubscription, readSubscription } from '../../src/core/subscription.js';
import { credentials } from './helpers.js';

test('subscription uses only the fixed official endpoint with redirect/cookie protections', async () => {
  const auth = credentials();
  let calls = 0;
  const result = await readSubscription(auth, async (input, init) => {
    calls++;
    const url = new URL(input);
    assert.equal(url.origin, 'https://chatgpt.com');
    assert.equal(url.pathname, '/backend-api/subscriptions');
    assert.equal(url.searchParams.get('account_id'), auth.accountID);
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${auth.token}`);
    return Response.json({
      account_id: auth.accountID,
      active_until: '2030-01-01T00:00:00Z',
      will_renew: false,
    });
  });
  assert.equal(calls, 1);
  assert.equal(result.activeUntil, Date.parse('2030-01-01T00:00:00Z'));
  assert.equal(result.willRenew, false);
  assert.equal(result.source, 'official');
});

test('subscription rejects mismatched identity, nested dates, and malformed dates', () => {
  assert.throws(() =>
    parseSubscription({ account_id: 'other', active_until: '2030-01-01T00:00:00Z' }, 'expected'),
  );
  assert.throws(() =>
    parseSubscription({ accounts: [{ active_until: '2030-01-01T00:00:00Z' }] }, 'expected'),
  );
  assert.throws(() => parseSubscription({ active_until: 'tomorrow' }, 'expected'));
});

test('subscription never retries and does not expose transport errors', async () => {
  let calls = 0;
  await assert.rejects(
    readSubscription(credentials(), async () => {
      calls++;
      throw new Error('private transport information');
    }),
    (error: Error) => !error.message.includes('private'),
  );
  assert.equal(calls, 1);
});

test('invalid credentials are rejected before any request', async () => {
  const auth = { ...credentials(), accountID: 'other-account' };
  await assert.rejects(
    readSubscription(auth, async () => {
      assert.fail('Network must not be called');
    }),
    /Sign in/,
  );
});
