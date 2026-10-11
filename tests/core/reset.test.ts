import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { ResetManager } from '../../src/core/reset.js';
import { Store } from '../../src/core/storage.js';
import { credit, snapshot, temporaryDirectory } from './helpers.js';

test('opening/cancelling never submits; a confirmed success cannot be repeated', async (t) => {
  let calls = 0;
  const store = new Store(join(temporaryDirectory(t), 'settings.json'));
  const manager = new ResetManager(
    store,
    async () => 'account',
    async () => {
      calls++;
      return 'reset';
    },
  );
  assert.equal(manager.availability(credit(), 'account').enabled, true);
  assert.equal(await manager.execute(credit(), 'account', false), undefined);
  assert.equal(calls, 0);
  assert.equal(await manager.execute(credit(), 'account', true), 'reset');
  assert.equal(calls, 1);
  await assert.rejects(manager.execute(credit(), 'account', true), /already been processed/);
  assert.equal(calls, 1);
});

test('ambiguous failure keeps the UUID across restart and blocks a different credit', async (t) => {
  const file = join(temporaryDirectory(t), 'settings.json');
  let firstKey = '';
  const manager = new ResetManager(
    new Store(file),
    async () => 'account',
    async (request) => {
      firstKey = request.idempotencyKey;
      throw new Error('Connection lost');
    },
  );
  await assert.rejects(manager.execute(credit('first'), 'account', true), /Connection lost/);
  const restarted = new ResetManager(
    new Store(file),
    async () => 'account',
    async (request) => {
      assert.equal(request.idempotencyKey, firstKey);
      assert.equal(request.creditID, 'first');
      return 'alreadyRedeemed';
    },
  );
  assert.equal(restarted.availability(credit('first'), 'account').retry, true);
  await assert.rejects(restarted.execute(credit('second'), 'account', true), /unresolved/);
  assert.equal(await restarted.execute(credit('first'), 'account', true), 'alreadyRedeemed');
});

test('account switching and simultaneous clicks cannot start a reset', async (t) => {
  const store = new Store(join(temporaryDirectory(t), 'settings.json'));
  const switched = new ResetManager(
    store,
    async () => 'other-account',
    async () => assert.fail('Must not submit'),
  );
  await assert.rejects(switched.execute(credit(), 'account', true), /account changed/);
  assert.equal(store.get('reset.pending.account'), undefined);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const manager = new ResetManager(
    store,
    async () => 'account',
    async () => {
      calls++;
      await pending;
      return 'reset';
    },
  );
  const first = manager.execute(credit(), 'account', true);
  await assert.rejects(manager.execute(credit(), 'account', true), /already in progress/);
  release();
  await first;
  assert.equal(calls, 1);
});

test('expired, unknown expiry, wrong type, and malformed IDs are disabled', (t) => {
  const manager = new ResetManager(
    new Store(join(temporaryDirectory(t), 'settings.json')),
    async () => 'account',
    async () => assert.fail('Must not submit'),
  );
  for (const patch of [
    { expiresAt: Date.now() - 1 },
    { expiresAt: null },
    { resetType: 'other' },
    { id: null },
    { id: ' bad ' },
    { id: 'bad\nvalue' },
    { status: 'redeeming' },
  ]) {
    assert.equal(manager.availability({ ...credit(), ...patch }, 'account').enabled, false);
  }
  assert.equal(
    manager.availability({ ...credit(), expiresAt: null, hasNoExpiration: true }, 'account')
      .enabled,
    true,
  );
});

test('reconcile preserves missing/capped/redeeming detail receipts and only clears complete evidence', async (t) => {
  const store = new Store(join(temporaryDirectory(t), 'settings.json'));
  const manager = new ResetManager(
    store,
    async () => 'account',
    async () => {
      throw new Error('Unknown result');
    },
  );
  await assert.rejects(manager.execute(credit('first'), 'account', true));
  for (const state of [
    snapshot(null),
    snapshot([credit('second')], 2),
    snapshot([{ ...credit('first'), status: 'redeeming' }], 0),
    snapshot([{ ...credit('first'), status: 'unknown' }], 0),
    snapshot([{ ...credit('second'), id: null }], 1),
  ]) {
    await manager.reconcile(state, 'account');
    assert.equal(manager.availability(credit('first'), 'account').retry, true);
  }
  await manager.reconcile(snapshot([credit('second')], 1), 'account');
  assert.equal(manager.availability(credit('first'), 'account').retry, false);
  assert.match(manager.availability(credit('first'), 'account').reason!, /already been processed/);
});

test('nothingToReset leaves the same credit available for a later explicit confirmation', async (t) => {
  const store = new Store(join(temporaryDirectory(t), 'settings.json'));
  const manager = new ResetManager(
    store,
    async () => 'account',
    async () => 'nothingToReset',
  );
  assert.equal(await manager.execute(credit(), 'account', true), 'nothingToReset');
  assert.equal(store.get('reset.pending.account'), undefined);
  assert.equal(manager.availability(credit(), 'account').enabled, true);
});

test('a failed receipt write stops submission', async (t) => {
  const store = new Store(join(temporaryDirectory(t), 'settings.json'));
  store.set = () => {
    throw new Error('Disk full');
  };
  const manager = new ResetManager(
    store,
    async () => 'account',
    async () => assert.fail('Must not submit'),
  );
  await assert.rejects(manager.execute(credit(), 'account', true), /Disk full/);
  assert.equal(manager.busy, false);
});

test('failure to save a successful result retains the original retry identity', async (t) => {
  const store = new Store(join(temporaryDirectory(t), 'settings.json'));
  const originalSet = store.set.bind(store);
  store.set = (key, value) => {
    if (key.startsWith('reset.completed.')) throw new Error('Disk full');
    originalSet(key, value);
  };
  const keys: string[] = [];
  const manager = new ResetManager(
    store,
    async () => 'account',
    async (request) => {
      keys.push(request.idempotencyKey);
      return keys.length === 1 ? 'reset' : 'alreadyRedeemed';
    },
  );
  await assert.rejects(manager.execute(credit(), 'account', true), /Disk full/);
  assert.equal(manager.availability(credit(), 'account').retry, true);
  store.set = originalSet;
  assert.equal(await manager.execute(credit(), 'account', true), 'alreadyRedeemed');
  assert.equal(keys[0], keys[1]);
});

test('a corrupt pending receipt disables resets instead of generating a new UUID', async (t) => {
  const store = new Store(join(temporaryDirectory(t), 'settings.json'));
  store.set('reset.pending.account', { creditID: 'test-credit', idempotencyKey: 'corrupt' });
  const manager = new ResetManager(
    store,
    async () => 'account',
    async () => assert.fail('Must not submit'),
  );
  await assert.rejects(manager.execute(credit(), 'account', true), /receipt is invalid/);
});
