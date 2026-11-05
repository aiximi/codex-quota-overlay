import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { resolve, join } from 'node:path';
import { Store } from '../../src/core/storage';
import { credentials, snapshot, credit, temporaryDirectory } from '../core/helpers';
import type { Credentials } from '../../src/core/auth';
import type { QuotaSnapshot, SubscriptionInfo } from '../../src/shared/contracts';
import type { QuotaApplication } from '../../src/main/application';

function deferred<T>() {
  let resolveValue!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });
  return { promise, resolve: resolveValue };
}

interface Environment {
  credentials: Credentials;
  limits: (id: string) => Promise<QuotaSnapshot>;
  subscription: () => Promise<SubscriptionInfo>;
}

async function fixture() {
  const mocks: Record<string, string> = {
    electron:
      'export const dialog = {showMessageBox: async () => {throw new Error("Unexpected reset dialog");}}; export const net = {fetch: async () => {throw new Error("Unexpected network request");}};',
    environment: 'export const environment = {};',
    '../core/auth':
      'import {environment} from "environment"; export const getAccountKey = async () => environment.credentials?.accountKey ?? null; export const readCredentials = async () => environment.credentials;',
    '../core/rpc':
      'import {environment} from "environment"; export class CodexClient { readLimits(id) {return environment.limits(id);} close() {} consumeReset() {throw new Error("Unexpected reset");} }',
    '../core/subscription':
      'import {environment} from "environment"; export const readSubscription = async () => environment.subscription();',
    './platform/discovery': 'export const discoverCLI = async () => "/fixture/codex";',
  };
  const result = await build({
    stdin: {
      contents: `export {QuotaApplication} from ${JSON.stringify(resolve('src/main/application.ts'))}; export {environment} from 'environment';`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    plugins: [
      {
        name: 'offline-application-fixture',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) =>
            Object.hasOwn(mocks, args.path)
              ? { path: args.path, namespace: 'test-mock' }
              : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: 'test-mock' }, (args) => ({
            contents: mocks[args.path],
            loader: 'js',
          }));
        },
      },
    ],
  });
  return (await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  )) as {
    QuotaApplication: typeof QuotaApplication;
    environment: Environment;
  };
}

const flush = () => new Promise<void>((done) => setImmediate(done));

test('quota publication never waits for subscription and manual references do not replace official dates', async (t) => {
  const { QuotaApplication: Application, environment } = await fixture();
  const store = new Store(join(temporaryDirectory(t), 'settings.json'));
  environment.credentials = credentials();
  const pending = deferred<SubscriptionInfo>();
  const value = snapshot([credit()]);
  environment.limits = async (id) => {
    assert.equal(id, environment.credentials.accountID);
    return value;
  };
  environment.subscription = () => pending.promise;
  const app = new Application(store, 'test', false, false, () => {});
  t.after(() => app.close());
  await app.refresh();
  assert.equal(app.state.loading, false);
  assert.equal(app.state.snapshot, value);
  assert.equal(app.state.subscriptionLoading, true);
  await app.setManualSubscription({ activeUntil: Date.now() + 1_000_000, willRenew: true });
  assert.equal(app.state.subscription, null);
  assert.equal(app.state.manualSubscription?.source, 'manual');
  const official: SubscriptionInfo = {
    activeUntil: Date.now() + 2_000_000,
    willRenew: false,
    checkedAt: Date.now(),
    source: 'official',
  };
  pending.resolve(official);
  await flush();
  assert.equal(app.state.subscription, official);
  assert.notEqual(app.state.manualSubscription?.activeUntil, official.activeUntil);
  await app.refresh();
  assert.equal((app.state.subscription as SubscriptionInfo | null)?.source, 'official');
  await app.setManualSubscription(null);
  assert.equal(app.state.subscription, official);
  assert.equal(app.state.manualSubscription, null);
});

test('account changes clear old quota during an in-flight read and reject late billing data', async (t) => {
  const { QuotaApplication: Application, environment } = await fixture();
  const store = new Store(join(temporaryDirectory(t), 'settings.json'));
  const oldLimits = deferred<QuotaSnapshot>();
  const oldSubscription = deferred<SubscriptionInfo>();
  environment.credentials = credentials('first');
  environment.limits = () => oldLimits.promise;
  environment.subscription = () => oldSubscription.promise;
  const app = new Application(store, 'test', false, false, () => {});
  t.after(() => app.close());
  const reading = app.refresh();
  await flush();
  assert.equal(app.state.loading, true);
  environment.credentials = credentials('second');
  await app.tick(true);
  assert.equal(app.state.snapshot, null);
  oldLimits.resolve(snapshot([credit('old-credit')]));
  oldSubscription.resolve({
    activeUntil: Date.now() + 10_000,
    willRenew: true,
    checkedAt: Date.now(),
    source: 'official',
  });
  await reading;
  await flush();
  assert.equal(app.state.snapshot, null);
  assert.equal(app.state.subscription, null);
  const next = snapshot([credit('new-credit')]);
  environment.limits = async () => next;
  environment.subscription = async () => {
    throw new Error('unavailable');
  };
  await app.refresh();
  assert.equal(app.state.snapshot, next);
  assert.equal(app.state.error, null);
});

test('default migration preserves explicit alternatives and stale quota disables spending controls', async (t) => {
  const { QuotaApplication: Application, environment } = await fixture();
  const store = new Store(join(temporaryDirectory(t), 'settings.json'));
  store.set('settings', { refreshSeconds: 60 });
  environment.credentials = credentials();
  environment.limits = async () => snapshot([credit()]);
  environment.subscription = async () => {
    throw new Error('unavailable');
  };
  const app = new Application(store, 'test', false, false, () => {});
  t.after(() => app.close());
  assert.equal(app.state.settings.refreshSeconds, 15);
  await app.refresh();
  app.publish();
  assert.equal(app.state.resetAvailability[0].enabled, true);
  app.state.snapshot!.capturedAt -= 46_000;
  app.publish();
  assert.equal(app.state.resetAvailability[0].enabled, false);
  app.saveSettings({ refreshSeconds: 120 });
  assert.equal(app.state.settings.refreshSeconds, 120);
  app.close();
  const reopened = new Application(store, 'test', false, false, () => {});
  t.after(() => reopened.close());
  assert.equal(reopened.state.settings.refreshSeconds, 120);
});
