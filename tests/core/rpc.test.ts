import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import test from 'node:test';
import { childEnvironment, CodexClient, type ClientOptions } from '../../src/core/rpc.js';

interface Message {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  error?: unknown;
}

function fakeServer(handler: (message: Message, respond: (value: unknown) => void) => void): {
  spawn: NonNullable<ClientOptions['spawn']>;
  messages: Message[];
} {
  const messages: Message[] = [];
  return {
    messages,
    spawn: (_file, args) => {
      assert.deepEqual(args, ['app-server', '--stdio']);
      const emitter = new EventEmitter();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(emitter, {
        stdout,
        stderr,
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        stdin: new Writable({
          write(chunk: Buffer, _encoding, callback) {
            for (const line of chunk.toString('utf8').trim().split('\n')) {
              const message: Message = JSON.parse(line);
              messages.push(message);
              handler(message, (value) => stdout.write(JSON.stringify(value) + '\n'));
            }
            callback();
          },
        }),
        kill(signal: NodeJS.Signals) {
          child.signalCode = signal;
          queueMicrotask(() => emitter.emit('close', null, signal));
          return true;
        },
      });
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  };
}

test('read handshake enables current protocol capabilities and never sends a mutation', async () => {
  const server = fakeServer((message, respond) => {
    if (message.id === 1) respond({ id: 1, result: {} });
    if (message.id === 2) respond({ id: 2, result: { rateLimits: { planType: 'test' } } });
  });
  const client = new CodexClient('fake', { spawn: server.spawn });
  assert.equal((await client.readLimits()).planType, 'test');
  assert.deepEqual(
    server.messages.map((message) => message.method),
    ['initialize', 'initialized', 'account/rateLimits/read'],
  );
  assert.deepEqual(server.messages[0].params?.capabilities, {
    experimentalApi: true,
    requestAttestation: false,
    explicitGatewayOauth: true,
  });
  assert.deepEqual(server.messages[2].params, { excludeResetCreditDetails: false });
  client.close();
});

test('reset submits exactly the selected ID and UUID once after two account checks', async () => {
  const server = fakeServer((message, respond) => {
    if (message.id === 1) respond({ id: 1, result: {} });
    if (message.id === 2) respond({ id: 2, result: { outcome: 'reset' } });
  });
  const client = new CodexClient('fake', { spawn: server.spawn });
  const key = randomUUID();
  let checks = 0;
  assert.equal(
    await client.consumeReset({
      creditID: 'selected-credit',
      idempotencyKey: key,
      expectedAccountKey: 'expected',
      currentAccountKey: async () => {
        checks++;
        return 'expected';
      },
    }),
    'reset',
  );
  assert.equal(checks, 2);
  const mutations = server.messages.filter(
    (message) => message.method === 'account/rateLimitResetCredit/consume',
  );
  assert.equal(mutations.length, 1);
  assert.deepEqual(mutations[0].params, { creditId: 'selected-credit', idempotencyKey: key });
});

test('switching accounts during initialization blocks mutation', async () => {
  const server = fakeServer((message, respond) => {
    if (message.id === 1) respond({ id: 1, result: {} });
  });
  const client = new CodexClient('fake', { spawn: server.spawn });
  let checks = 0;
  await assert.rejects(
    client.consumeReset({
      creditID: 'selected-credit',
      idempotencyKey: randomUUID(),
      expectedAccountKey: 'expected',
      currentAccountKey: async () => (++checks === 1 ? 'expected' : 'changed'),
    }),
    /account changed/,
  );
  assert.equal(
    server.messages.some((message) => message.id === 2),
    false,
  );
});

test('timeouts and concurrent requests do not retry', async () => {
  const server = fakeServer(() => {});
  let spawns = 0;
  const client = new CodexClient('fake', {
    timeoutMs: 30,
    spawn: (...args) => {
      spawns++;
      return server.spawn(...args);
    },
  });
  const first = client.readLimits();
  await assert.rejects(client.readLimits(), /in progress/);
  await assert.rejects(first, /timed out/);
  assert.equal(spawns, 1);
  assert.equal(server.messages.length, 1);
});

test('close cancels active requests and raw service errors are not exposed', async () => {
  const waiting = fakeServer(() => {});
  const client = new CodexClient('fake', { spawn: waiting.spawn });
  const request = client.readLimits();
  // Allow the async pre-launch identity boundary to finish before cancellation.
  await Promise.resolve();
  client.close();
  await assert.rejects(request, /stopped|closed/);
  await assert.rejects(client.readLimits(), /closed/);
  const rejecting = fakeServer((_message, respond) =>
    respond({ id: 1, error: { message: 'private diagnostic' } }),
  );
  await assert.rejects(
    new CodexClient('fake', { spawn: rejecting.spawn }).readLimits(),
    (error: Error) => !error.message.includes('private'),
  );
});

test('proxy compatibility is scoped to the child environment', () => {
  const input = {
    HTTPS_PROXY: 'http://localhost:8080',
    ALL_PROXY: 'socks5h://localhost:1080',
    OTHER: 'kept',
  };
  const env = childEnvironment(input);
  assert.equal(env.ALL_PROXY, undefined);
  assert.equal(env.HTTPS_PROXY, input.HTTPS_PROXY);
  assert.equal(input.ALL_PROXY, 'socks5h://localhost:1080');
  assert.equal(childEnvironment({ ALL_PROXY: input.ALL_PROXY }).ALL_PROXY, input.ALL_PROXY);
});
