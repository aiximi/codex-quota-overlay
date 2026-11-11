import assert from 'node:assert/strict';
import test from 'node:test';
import { OverlayVisibility, overlayWindowId } from '../../src/main/platform/visibility.js';

function panel() {
  const calls: string[] = [];
  return {
    calls,
    visible: true,
    isVisible() {
      return this.visible;
    },
    hide() {
      calls.push('hide');
    },
    setVisibleOnAllWorkspaces() {
      calls.push('workspaces');
    },
    showInactive() {
      calls.push('showInactive');
    },
    setBounds() {
      calls.push('setBounds');
    },
  };
}

test('repairs an off-Space panel even when Electron reports it visible', () => {
  const window = panel();
  const visibility = new OverlayVisibility(true);
  visibility.update(window, true, false, 0);
  assert.deepEqual(window.calls, ['hide', 'workspaces', 'showInactive']);
  window.calls.length = 0;
  visibility.update(window, true, false, 250);
  visibility.update(window, true, false, 999);
  assert.deepEqual(window.calls, []);
  visibility.update(window, true, false, 1_000);
  assert.deepEqual(window.calls, ['hide', 'workspaces', 'showInactive']);
  window.calls.length = 0;
  visibility.update(window, true, true, 2_000);
  visibility.update(window, true, true, 60_000);
  assert.deepEqual(window.calls, []);
});

test('native geometry failure reapplies intended placement before showing the panel', () => {
  const window = panel();
  const visibility = new OverlayVisibility(true);
  const bounds = { x: 1220, y: 98, width: 276, height: 42 };
  visibility.update(window, true, false, 0, bounds);
  assert.deepEqual(window.calls, ['hide', 'workspaces', 'setBounds', 'showInactive']);
  window.calls.length = 0;
  visibility.update(window, true, true, 1_000, bounds);
  assert.deepEqual(window.calls, []);
});

test('a hidden or unrelated host wins over stale visibility and clears the recovery delay', () => {
  const window = panel();
  const visibility = new OverlayVisibility(true);
  visibility.update(window, true, false, 0);
  window.calls.length = 0;
  visibility.update(window, false, true, 100);
  assert.deepEqual(window.calls, ['hide']);
  window.calls.length = 0;
  visibility.update(window, true, false, 200);
  assert.deepEqual(window.calls, ['hide', 'workspaces', 'showInactive']);
});

test('uses native confirmation when available and keeps Windows nonactivating behavior', () => {
  const window = panel();
  window.visible = false;
  new OverlayVisibility(true).update(window, true, true, 0);
  assert.deepEqual(window.calls, []);
  const visibility = new OverlayVisibility(false);
  visibility.update(window, true, undefined, 0);
  assert.deepEqual(window.calls, ['showInactive']);
  window.calls.length = 0;
  window.visible = true;
  visibility.update(window, true, undefined, 1_000);
  assert.deepEqual(window.calls, []);
});

test('extracts only a valid native window ID, never a pointer or another source type', () => {
  assert.equal(overlayWindowId('window:10594:0'), 10594);
  for (const value of ['screen:1:0', 'window:0:0', 'window:4294967296:0', '10594', 'window:1'])
    assert.equal(overlayWindowId(value), undefined);
});

test('sustained native absence recreates a macOS surface instead of showing the old one', () => {
  const window = panel();
  const visibility = new OverlayVisibility(true);
  const recreate = () => window.calls.push('recreate');
  for (const now of [0, 1_000, 2_000, 3_000, 4_000]) {
    visibility.update(window, true, false, now, undefined, recreate);
    assert.ok(!window.calls.includes('recreate'));
  }
  window.calls.length = 0;
  visibility.update(window, true, false, 5_000, undefined, recreate);
  assert.deepEqual(window.calls, ['recreate']);
});

test('UI renders, transient native absence and background transitions do not recreate', () => {
  const window = panel();
  window.visible = false;
  const visibility = new OverlayVisibility(true);
  let recreations = 0;
  const update = (eligible: boolean, native: boolean | undefined, now: number) =>
    visibility.update(window, eligible, native, now, undefined, () => recreations++);
  update(true, undefined, 0);
  update(true, undefined, 10_000);
  update(true, false, 11_000);
  update(true, undefined, 16_000);
  assert.equal(recreations, 0, 'a UI render cannot escalate an old native observation');
  update(true, true, 17_000);
  update(true, false, 20_000);
  update(true, false, 24_999);
  update(false, false, 25_000);
  update(true, false, 30_000);
  update(true, false, 34_999);
  update(true, true, 35_000);
  assert.equal(recreations, 0);
});

test('recreation cooldown survives tracking resets, backgrounding and recovery', () => {
  const window = panel();
  const visibility = new OverlayVisibility(true);
  const recreations: number[] = [];
  const update = (eligible: boolean, native: boolean | undefined, now: number) =>
    visibility.update(window, eligible, native, now, undefined, () => {
      recreations.push(now);
      // Mirror the synchronous tracking reset performed by the window owner.
      visibility.update(window, false, undefined, now);
    });
  update(true, false, 0);
  update(true, false, 5_000);
  update(true, false, 6_000);
  update(true, false, 11_000);
  update(false, false, 12_000);
  update(true, false, 13_000);
  update(true, false, 18_000);
  update(true, true, 19_000);
  update(true, false, 20_000);
  update(true, false, 34_999);
  assert.deepEqual(recreations, [5_000]);
  update(true, false, 35_000);
  assert.deepEqual(recreations, [5_000, 35_000]);
});

test('Windows never uses macOS surface recreation', () => {
  const window = panel();
  const visibility = new OverlayVisibility(false);
  let recreations = 0;
  for (const now of [0, 5_000, 30_000, 60_000])
    visibility.update(window, true, false, now, undefined, () => recreations++);
  assert.equal(recreations, 0);
});
