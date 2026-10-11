import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHelperFrame } from '../../src/main/platform/frame.js';

test('hidden heartbeat clears a previously visible overlay', () => {
  assert.deepEqual(parseHelperFrame('{"visible":false}'), { visible: false });
});

test('preserves top-left global coordinates, including a monitor left of primary', () => {
  const frame = {
    visible: true,
    bounds: { x: -1920, y: 20, width: 1200, height: 900 },
    appPath: '/Applications/Codex.app',
  };
  assert.deepEqual(parseHelperFrame(JSON.stringify(frame)), frame);
});

test('rejects malformed payloads instead of retaining stale geometry', () => {
  for (const line of [
    'not json',
    'null',
    '{}',
    '{"visible":"true"}',
    '{"visible":true,"bounds":{"x":0,"y":0,"width":-1,"height":400}}',
    '{"visible":true,"bounds":{"x":1e100,"y":0,"width":500,"height":400}}',
    '{"visible":true,"bounds":{"x":0,"y":0,"width":500,"height":400},"appPath":42}',
  ])
    assert.equal(parseHelperFrame(line), undefined);
});
