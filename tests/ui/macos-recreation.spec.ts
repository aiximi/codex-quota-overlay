import { test, expect, _electron as electron } from '@playwright/test';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';

test('production main replaces a stuck native panel, rebinds tracking and preserves UI state', async () => {
  test.skip(process.platform !== 'darwin', 'Exercises macOS native surface recovery.');
  test.setTimeout(60_000);
  const directory = await mkdtemp(resolve(tmpdir(), 'quota-main-recreation-'));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const mainDirectory = resolve(directory, 'dist/main');
    await mkdir(mainDirectory, { recursive: true });
    await cp(resolve('dist/renderer'), resolve(directory, 'dist/renderer'), { recursive: true });
    await cp(resolve('dist/main/preload.cjs'), resolve(mainDirectory, 'preload.cjs'));
    const entry = resolve(mainDirectory, 'index.cjs');
    const productionIndex = resolve('src/main/index.ts');
    const productionApplication = resolve('src/main/application.ts');
    // Bundle the real window owner. Only the account mode and OS observation
    // boundary are substituted; the recreation and lifecycle code is unchanged.
    await build({
      entryPoints: [productionIndex],
      outfile: entry,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      plugins: [
        {
          name: 'offline-main-fixture',
          setup(builder) {
            builder.onResolve({ filter: /^\.\/application$/ }, (args) =>
              args.importer === productionIndex
                ? { path: 'application', namespace: 'fixture' }
                : undefined,
            );
            builder.onResolve({ filter: /^\.\/platform\/tracker$/ }, (args) =>
              args.importer === productionIndex
                ? { path: 'tracker', namespace: 'fixture' }
                : undefined,
            );
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
              resolveDir: process.cwd(),
              contents:
                path === 'application'
                  ? `
import { QuotaApplication as RealApplication } from ${JSON.stringify(productionApplication)};
export class QuotaApplication extends RealApplication {
  constructor(store, version, _preview, _readOnly, changed) {
    super(store, version, true, true, changed);
    globalThis.fixtureApplication = this;
  }
}
`
                  : `
import { screen } from 'electron';
export class WindowTracker {
  constructor(_root, onFrame, _onError, id) {
    this.onFrame = onFrame;
    this.id = id;
    this.replacements = [];
    globalThis.fixtureTracker = this;
  }
  // A newly created production window starts hidden. Subsequent observations
  // come from the real window-server probe, including after recreation.
  start() { this.emit(false); }
  stop() { this.onFrame(null); }
  emit(nativeVisible) {
    this.onFrame(nativeVisible === null ? null : {
      bounds: screen.getPrimaryDisplay().workArea,
      overlayVisible: nativeVisible,
    });
  }
  replaceOverlayWindow(id) {
    this.stop();
    this.id = id;
    this.replacements.push(id);
    this.start();
  }
}
`,
            }));
          },
        },
      ],
    });
    const source = await readFile(resolve('native/macos/WindowTracker.swift'), 'utf8');
    const probeSource = resolve(directory, 'probe.swift');
    const probe = resolve(directory, 'probe');
    await writeFile(
      probeSource,
      source.slice(0, source.indexOf('\nsignal(SIGPIPE')) +
        `
let windows = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let visible = isOverlayOnScreen(windows, windowID: UInt32(CommandLine.arguments[1])!, ownerPID: Int32(CommandLine.arguments[2])!)
print(visible ? "true" : "false")
`,
    );
    await promisify(execFile)('xcrun', ['swiftc', probeSource, '-o', probe], { timeout: 30_000 });
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined,
      ),
    ) as Record<string, string>;
    environment.QUOTA_USER_DATA_DIR = resolve(directory, 'profile');
    // No --preview: production main must start tracking and own its real
    // recovery path. The substituted Application is forced fully offline.
    app = await electron.launch({ args: [entry], env: environment });
    const original = await app.firstWindow();
    await expect(original.locator('#toggle-expanded')).toBeVisible();
    await original.locator('#toggle-expanded').click();
    await app.evaluate(() => {
      const quota = (
        globalThis as unknown as {
          fixtureApplication: { saveOffset(x: number, y: number): void; publish(): void };
        }
      ).fixtureApplication;
      quota.saveOffset(37, 91);
      quota.publish();
    });
    await expect(original.locator('#toggle-expanded')).toHaveAttribute('aria-expanded', 'true');
    await expect(original.locator('.reset-button').first()).toBeDisabled();
    const before = await original.evaluate(() => window.quota.getState());
    expect(before.preview).toBe(true);
    const originalId = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('/index.html'))!
        .getMediaSourceId(),
    );
    const pid = String(app.process().pid);
    const nativeVisible = async (id: string) =>
      (await promisify(execFile)(probe, [id.split(':')[1], pid])).stdout.trim() === 'true';
    const observeAndTrack = async (id: string) => {
      const visible = await nativeVisible(id);
      await app!.evaluate(
        (_electron, observation) => {
          const tracker = (
            globalThis as unknown as {
              fixtureTracker: { id: number; emit(value: boolean): void };
            }
          ).fixtureTracker;
          if (tracker.id === observation.id) tracker.emit(observation.visible);
        },
        { id: Number(id.split(':')[1]), visible },
      );
      return visible;
    };
    await expect.poll(() => observeAndTrack(originalId)).toBe(true);
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('/index.html'),
      )!;
      window.hide();
      window.showInactive = () => {};
    });
    await expect.poll(() => nativeVisible(originalId)).toBe(false);
    const created = app.waitForEvent('window');
    await expect
      .poll(
        async () => {
          // Keep supplying fresh native observations, as the real helper does.
          // Reporting unconditional success after rebinding would strand a
          // surface if the desktop happens to be transitioning during this test.
          const id = await app!.evaluate(
            () => (globalThis as unknown as { fixtureTracker: { id: number } }).fixtureTracker.id,
          );
          await observeAndTrack(`window:${id}:0`);
          return app!.evaluate(() => {
            const tracker = (
              globalThis as unknown as {
                fixtureTracker: { replacements: number[] };
              }
            ).fixtureTracker;
            return tracker.replacements.length;
          });
        },
        { timeout: 15_000, intervals: [250] },
      )
      .toBe(1);
    const replacement = await created;
    await expect(replacement.locator('#toggle-expanded')).toHaveAttribute('aria-expanded', 'true');
    expect(original.isClosed()).toBe(true);
    const after = await replacement.evaluate(() => window.quota.getState());
    expect(after.settings).toEqual(before.settings);
    expect(after.expanded).toBe(true);
    expect(after.preview).toBe(true);
    await expect(replacement.locator('.reset-button').first()).toBeDisabled();
    const rebound = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('/index.html'),
      )!;
      const tracker = (
        globalThis as unknown as {
          fixtureTracker: { id: number; replacements: number[] };
        }
      ).fixtureTracker;
      return {
        sourceId: window.getMediaSourceId(),
        trackerId: tracker.id,
        replacements: tracker.replacements,
        focused: window.isFocused(),
      };
    });
    expect(rebound.sourceId).not.toBe(originalId);
    expect(rebound.trackerId).toBe(Number(rebound.sourceId.split(':')[1]));
    expect(rebound.replacements).toEqual([rebound.trackerId]);
    expect(rebound.focused).toBe(false);
    await expect.poll(() => observeAndTrack(rebound.sourceId)).toBe(true);
    await app.evaluate(() => {
      (
        globalThis as unknown as { fixtureTracker: { emit(value: null): void } }
      ).fixtureTracker.emit(null);
    });
    await expect.poll(() => nativeVisible(rebound.sourceId)).toBe(false);
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
