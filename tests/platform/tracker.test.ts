import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import type { WindowTracker as TrackerType } from '../../src/main/platform/tracker.js';
import type { Frame } from '../../src/main/platform/frame.js';

test('tracker recovers after repeated failures, resets backoff after health, and stops cleanly', async (t) => {
  if (!['darwin', 'win32'].includes(process.platform)) return t.skip('Desktop platforms only.');
  const directory = await mkdtemp(resolve(tmpdir(), 'quota-tracker-test-'));
  const output = resolve(directory, 'tracker.cjs');
  await build({
    entryPoints: [resolve('src/main/platform/tracker.ts')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'electron-screen',
        setup(builder) {
          builder.onResolve({ filter: /^electron$/ }, () => ({
            path: 'electron',
            namespace: 'test',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
            contents: 'exports.screen = { screenToDipRect: (_, bounds) => bounds };',
          }));
        },
      },
    ],
  });
  const require = createRequire(import.meta.url);
  const children: Array<EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill(): void }> =
    [];
  const argumentsUsed: string[][] = [];
  t.mock.method(require('node:child_process'), 'spawn', (_command: string, args: string[]) => {
    argumentsUsed.push(args);
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill() {},
    });
    children.push(child);
    return child;
  });
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1 });
  const { WindowTracker } = require(output) as { WindowTracker: typeof TrackerType };
  const frames: Array<Frame | null> = [];
  const errors: string[] = [];
  const tracker = new WindowTracker(
    directory,
    (frame) => frames.push(frame),
    (error) => errors.push(error),
    123,
  );
  try {
    tracker.start();
    for (const delay of [500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      const count = children.length;
      children.at(-1)!.emit('exit', 1);
      assert.equal(frames.at(-1), null);
      t.mock.timers.tick(delay);
      assert.equal(children.length, count + 1, 'retries must not permanently stop');
    }
    const frame = { bounds: { x: 0, y: 0, width: 900, height: 600 }, overlayVisible: false };
    for (let second = 0; second <= 10; second += 1) {
      children.at(-1)!.stdout.emit('data', JSON.stringify({ visible: true, ...frame }) + '\n');
      t.mock.timers.tick(1_000);
    }
    assert.deepEqual(frames.at(-1), frame);
    assert.equal(errors.at(-1), '');
    const count = children.length;
    children.at(-1)!.emit('exit', 1);
    t.mock.timers.tick(500);
    assert.equal(children.length, count + 1, 'a healthy helper resets the backoff');
    const oldChild = children.at(-1)!;
    tracker.replaceOverlayWindow(456);
    assert.equal(children.length, count + 2, 'a new native surface restarts its tracker');
    assert.equal(frames.at(-1), null);
    if (process.platform === 'darwin') assert.deepEqual(argumentsUsed.at(-1), ['456']);
    oldChild.stdout.emit('data', JSON.stringify({ visible: true, ...frame }) + '\n');
    assert.equal(frames.at(-1), null, 'old helper messages cannot revive the old surface');
    children.at(-1)!.stdout.emit('data', JSON.stringify({ visible: true, ...frame }) + '\n');
    assert.deepEqual(frames.at(-1), frame);
    tracker.stop();
    tracker.replaceOverlayWindow(789);
    t.mock.timers.tick(60_000);
    assert.equal(children.length, count + 2, 'replacing a stopped tracker does not start it');
    assert.equal(frames.at(-1), null);
  } finally {
    tracker.stop();
    t.mock.restoreAll();
    t.mock.timers.reset();
    await rm(directory, { recursive: true, force: true });
  }
});
