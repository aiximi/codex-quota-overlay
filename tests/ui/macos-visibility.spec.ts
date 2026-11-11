import { test, expect, _electron as electron } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';

test('macOS repairs hidden and clipped panels despite stale Electron state without taking focus', async () => {
  test.skip(process.platform !== 'darwin', 'Uses the macOS window server.');
  test.setTimeout(60_000);
  const directory = await mkdtemp(resolve(tmpdir(), 'quota-native-visibility-'));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    // Compile the production native predicate into a read-only probe. No
    // production test mode, Codex UI control or account requests are involved.
    const source = await readFile(resolve('native/macos/WindowTracker.swift'), 'utf8');
    const probeSource = resolve(directory, 'probe.swift');
    const probe = resolve(directory, 'probe');
    await writeFile(
      probeSource,
      source.slice(0, source.indexOf('\nsignal(SIGPIPE')) +
        `
let windows = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let visible = isOverlayOnScreen(windows, windowID: UInt32(CommandLine.arguments[1])!, ownerPID: Int32(CommandLine.arguments[2])!)
if CommandLine.arguments.last == "bounds" {
    let match = windows.first { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == UInt32(CommandLine.arguments[1])! }
    let bounds = match?[kCGWindowBounds as String] as? [String: Any] ?? [:]
    print(String(decoding: try JSONSerialization.data(withJSONObject: bounds), as: UTF8.self))
} else {
    print(visible ? "true" : "false")
}
`,
    );
    await promisify(execFile)('xcrun', ['swiftc', probeSource, '-o', probe], { timeout: 30_000 });
    const entry = resolve(directory, 'main.cjs');
    await build({
      stdin: {
        contents: `
const { app, BrowserWindow, screen } = require('electron');
const { OverlayVisibility } = require(${JSON.stringify(resolve('src/main/platform/visibility.ts'))});
app.whenReady().then(async () => {
  app.dock.hide();
  const area = screen.getPrimaryDisplay().workArea;
  const desired = { x: area.x + area.width - 292, y: area.y + 64, width: 276, height: 42 };
  const window = new BrowserWindow({ ...desired, show: false,
    frame: false, focusable: false, type: 'panel', alwaysOnTop: true });
  const visibility = new OverlayVisibility(true);
  globalThis.reconcileOverlay = (eligible, nativeVisible) => visibility.update(window, eligible, nativeVisible, Date.now(), desired);
  globalThis.misplaceOverlay = () => {
    window.setBounds({ ...desired, x: area.x - desired.width + 40 });
    window.getBounds = () => ({ ...desired });
    return desired;
  };
  await window.loadURL('data:text/html,<body>Offline visibility test</body>');
});
`,
        resolveDir: process.cwd(),
      },
      outfile: entry,
      platform: 'node',
      format: 'cjs',
      bundle: true,
      external: ['electron'],
    });
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined,
      ),
    ) as Record<string, string>;
    app = await electron.launch({
      args: [entry, `--user-data-dir=${directory}/profile`],
      env: environment,
    });
    await app.firstWindow();
    const sourceId = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getMediaSourceId(),
    );
    const id = sourceId.split(':')[1];
    const pid = String(app.process().pid);
    const observed = async () =>
      (await promisify(execFile)(probe, [id, pid])).stdout.trim() === 'true';
    const reconcile = async (eligible: boolean, nativeVisible: boolean) =>
      app!.evaluate(
        (_electron, state) => {
          (
            globalThis as unknown as { reconcileOverlay(eligible: boolean, visible: boolean): void }
          ).reconcileOverlay(state.eligible, state.nativeVisible);
        },
        { eligible, nativeVisible },
      );

    expect(await observed()).toBe(false);
    await reconcile(true, false);
    await expect.poll(observed).toBe(true);
    expect((await promisify(execFile)(probe, [id, String(Number(pid) + 1)])).stdout.trim()).toBe(
      'false',
    );
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.hide();
      // Reproduce the observed failure: framework state says visible, the
      // actual window server says absent from the current desktop.
      window.isVisible = () => true;
    });
    await expect.poll(observed).toBe(false);
    await expect
      .poll(async () => {
        const visible = await observed();
        await reconcile(true, visible);
        return visible;
      })
      .toBe(true);
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()),
    ).toBe(false);

    // Native placement and cached framework geometry can disagree after a
    // desktop transition. Simulate that disagreement on this test panel only.
    // A 40 px visible sliver must not count as a usable foreground overlay.
    const desired = await app.evaluate(() =>
      (
        globalThis as unknown as {
          misplaceOverlay(): { x: number; y: number; width: number; height: number };
        }
      ).misplaceOverlay(),
    );
    await expect.poll(observed).toBe(false);
    await expect
      .poll(async () => {
        const visible = await observed();
        await reconcile(true, visible);
        return visible;
      })
      .toBe(true);
    await expect
      .poll(async () => JSON.parse((await promisify(execFile)(probe, [id, pid, 'bounds'])).stdout))
      .toEqual({ X: desired.x, Y: desired.y, Width: desired.width, Height: desired.height });
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()),
    ).toBe(false);

    await reconcile(false, true);
    await expect.poll(observed).toBe(false);
    await reconcile(true, false);
    await expect.poll(observed).toBe(true);
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()),
    ).toBe(false);
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('macOS native visibility rejects off-display and clipped rectangles despite onscreen flags', async () => {
  test.skip(process.platform !== 'darwin', 'Compiles the production native visibility predicate.');
  const directory = await mkdtemp(resolve(tmpdir(), 'quota-native-geometry-'));
  try {
    const source = await readFile(resolve('native/macos/WindowTracker.swift'), 'utf8');
    const fixture = resolve(directory, 'geometry.swift');
    const executable = resolve(directory, 'geometry');
    await writeFile(
      fixture,
      source.slice(0, source.indexOf('\nsignal(SIGPIPE')) +
        `
let physicalDisplay = CGRect(x: 0, y: 0, width: 1512, height: 982)
let host = CGRect(x: 100, y: 100, width: 1100, height: 750)
let region = physicalDisplay.intersection(host)
func observed(_ rect: CGRect, onscreen: Bool = true, regions: [CGRect] = [region]) -> Bool {
    let window: [String: Any] = [
        kCGWindowNumber as String: NSNumber(value: 11),
        kCGWindowOwnerPID as String: NSNumber(value: 42),
        kCGWindowIsOnscreen as String: NSNumber(value: onscreen),
        kCGWindowAlpha as String: NSNumber(value: 1),
        kCGWindowBounds as String: rect.dictionaryRepresentation
    ]
    return isOverlayOnScreen([window], windowID: 11, ownerPID: 42, visibleRegions: regions)
}
let results = [
    "inside": observed(CGRect(x: 110, y: 120, width: 276, height: 42)),
    "falseOnscreenFlag": observed(CGRect(x: 110, y: 120, width: 276, height: 42), onscreen: false),
    "spaceTranslation": observed(CGRect(x: 14000, y: 120, width: 276, height: 42)),
    "sliver": observed(CGRect(x: -236, y: 120, width: 276, height: 42), regions: [physicalDisplay]),
    "outsideHost": observed(CGRect(x: 0, y: 120, width: 276, height: 42)),
    "roundingTolerance": observed(CGRect(x: 98, y: 120, width: 276, height: 42)),
    "beyondTolerance": observed(CGRect(x: 97, y: 120, width: 276, height: 42)),
    "noVisibleRegion": observed(CGRect(x: 110, y: 120, width: 276, height: 42), regions: []),
    "leftMonitor": observed(CGRect(x: -1200, y: 100, width: 276, height: 42), regions: [CGRect(x: -1512, y: 0, width: 1512, height: 982)])
]
print(String(decoding: try JSONSerialization.data(withJSONObject: results), as: UTF8.self))
`,
    );
    await promisify(execFile)('xcrun', ['swiftc', fixture, '-o', executable], { timeout: 30_000 });
    const { stdout } = await promisify(execFile)(executable);
    expect(JSON.parse(stdout)).toEqual({
      inside: true,
      falseOnscreenFlag: false,
      spaceTranslation: false,
      sliver: false,
      outsideHost: false,
      roundingTolerance: true,
      beyondTolerance: false,
      noVisibleRegion: false,
      leftMonitor: true,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
