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
