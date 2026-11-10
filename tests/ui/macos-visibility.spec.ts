import { test, expect, _electron as electron } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';

test('macOS repairs a native hidden panel despite a stale Electron visible flag without taking focus', async () => {
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
print(visible ? "true" : "false")
`,
    );
    await promisify(execFile)('xcrun', ['swiftc', probeSource, '-o', probe], { timeout: 30_000 });
    const entry = resolve(directory, 'main.cjs');
    await build({
      stdin: {
        contents: `
const { app, BrowserWindow } = require('electron');
const { OverlayVisibility } = require(${JSON.stringify(resolve('src/main/platform/visibility.ts'))});
app.whenReady().then(async () => {
  app.dock.hide();
  const window = new BrowserWindow({ width: 276, height: 42, show: false,
    frame: false, focusable: false, type: 'panel', alwaysOnTop: true });
  const visibility = new OverlayVisibility(true);
  globalThis.reconcileOverlay = (eligible, nativeVisible) => visibility.update(window, eligible, nativeVisible);
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
