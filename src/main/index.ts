import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  Tray,
} from 'electron';
import { join, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { Store } from '../core/storage';
import { QuotaApplication } from './application';
import { WindowTracker, type Frame } from './platform/tracker';
import { DEFAULT_SETTINGS } from './settings';

const preview = process.argv.includes('--preview') || process.argv.includes('--smoke-test');
const readOnly = preview || process.argv.includes('--read-only');
if (process.env.QUOTA_USER_DATA_DIR)
  app.setPath('userData', resolve(process.env.QUOTA_USER_DATA_DIR));
app.setName('Codex Quota Overlay');
let overlay: BrowserWindow | null = null;
let settings: BrowserWindow | null = null;
let tracker: WindowTracker | null = null;
let quota: QuotaApplication;
let tray: Tray | null = null;
let host: Frame | null = null;
let quitting = false;
let interval: ReturnType<typeof setInterval> | undefined;
let positionSaveTimer: ReturnType<typeof setTimeout> | undefined;
let positionSavePending = false;
let ready = false;
let lastBroadcast = '';
const projectURL = 'https://github.com/aiximi/codex-quota-overlay';

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => openSettings());
  app
    .whenReady()
    .then(start)
    .catch(() => {
      dialog.showErrorBox(
        'Codex Quota Overlay',
        'The app could not start. Check the installation and local settings file.',
      );
      app.quit();
    });
}

function protect(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
}

function rendererFile(name: string): string {
  return join(__dirname, '../renderer', name);
}

function flushWindowsPosition(): void {
  clearTimeout(positionSaveTimer);
  positionSaveTimer = undefined;
  if (!positionSavePending) return;
  positionSavePending = false;
  // Read the latest offset so a position reset cannot be overwritten by an
  // older drag. saveOffset retains the existing storage error reporting.
  const { x, y } = quota.state.settings.offset;
  quota.saveOffset(x, y);
}

function createOverlay(): BrowserWindow {
  const window = new BrowserWindow({
    width: 276,
    height: 42,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    // Windows needs a focusable HWND for native mouse/keyboard input. Keep the
    // macOS nonactivating panel unchanged; showInactive still avoids stealing
    // focus when the Windows overlay first appears.
    focusable: process.platform === 'win32',
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    ...(process.platform === 'darwin' ? { type: 'panel' as const, acceptFirstMouse: true } : {}),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  protect(window);
  if (process.platform === 'darwin')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.on('ready-to-show', () => {
    ready = true;
    render();
  });
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on('will-move', (_event, bounds) => {
    if (!host) return;
    const x = host.bounds.x + host.bounds.width - bounds.x - bounds.width;
    const y = bounds.y - host.bounds.y;
    if (process.platform === 'win32') {
      // Keep tracking aligned during a drag without fsync/rename on every
      // mouse move, which blocks Electron's main thread on Windows.
      quota.state.settings = { ...quota.state.settings, offset: { x, y } };
      positionSavePending = true;
      clearTimeout(positionSaveTimer);
      positionSaveTimer = setTimeout(flushWindowsPosition, 400);
      positionSaveTimer.unref();
    } else {
      quota.saveOffset(x, y);
    }
  });
  if (process.platform === 'win32') window.on('moved', flushWindowsPosition);
  void window.loadFile(rendererFile('index.html'));
  return window;
}

function render(): void {
  if (!quota || !overlay || overlay.isDestroyed()) return;
  const serialized = JSON.stringify(quota.state);
  if (serialized !== lastBroadcast) {
    lastBroadcast = serialized;
    for (const window of [overlay, settings]) {
      if (window && !window.isDestroyed() && !window.webContents.isLoading())
        window.webContents.send('quota:updated', quota.state);
    }
  }
  if (!ready) return;
  const anchor = preview ? screen.getPrimaryDisplay().workArea : host?.bounds;
  if (!anchor) {
    overlay.hide();
    return;
  }
  const display = screen.getDisplayMatching(anchor).workArea;
  const left = Math.max(anchor.x, display.x),
    top = Math.max(anchor.y, display.y);
  const right = Math.min(anchor.x + anchor.width, display.x + display.width);
  const bottom = Math.min(anchor.y + anchor.height, display.y + display.height);
  const width = Math.min(quota.state.expanded ? 328 : 276, right - left - 16);
  const height = Math.min(quota.state.expanded ? 560 : 42, bottom - top - 16);
  if (width < 180 || height < 42) {
    overlay.hide();
    return;
  }
  const offset = quota.state.settings.offset;
  const x = Math.max(
    left + 8,
    Math.min(right - width - 8, anchor.x + anchor.width - width - offset.x),
  );
  const y = Math.max(top + 8, Math.min(bottom - height - 8, anchor.y + offset.y));
  const bounds = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
  const old = overlay.getBounds();
  if (
    Object.keys(bounds).some(
      (key) => old[key as keyof typeof old] !== bounds[key as keyof typeof bounds],
    )
  )
    overlay.setBounds(bounds);
  if (!overlay.isVisible()) overlay.showInactive();
}

function openSettings(): void {
  if (!quota) return;
  if (settings && !settings.isDestroyed()) {
    settings.show();
    settings.focus();
    return;
  }
  settings = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 430,
    minHeight: 520,
    show: false,
    title: 'Codex Quota Overlay',
    backgroundColor: '#171b1a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  protect(settings);
  settings.once('ready-to-show', () => settings?.show());
  settings.once('closed', () => {
    settings = null;
  });
  void settings.loadFile(rendererFile('settings.html'));
}

function registerIPC(): void {
  const handle = (channel: string, action: (...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const allowed = [overlay, settings].some(
        (window) => window && !window.isDestroyed() && window.webContents.id === event.sender.id,
      );
      if (!allowed || event.senderFrame !== event.sender.mainFrame)
        throw new Error('Unauthorized window');
      return action(...args);
    });
  };
  handle('quota:state', () => quota.state);
  handle('quota:refresh', () => quota.refresh(true));
  handle('quota:toggle', () => {
    quota.state.expanded = !quota.state.expanded;
    quota.publish();
  });
  handle('quota:reset', (id) => quota.requestReset(id));
  handle('quota:settings', () => openSettings());
  handle('quota:save-settings', (patch) => {
    if (!app.isPackaged && (patch as Record<string, unknown>)?.autoStart === true)
      throw new Error(
        quota.text(
          '开机启动需使用安装后的应用。',
          'Login startup is available in the installed app.',
        ),
      );
    const applied = quota.saveSettings(patch);
    if (applied.autoStart !== undefined && app.isPackaged)
      app.setLoginItemSettings({ openAtLogin: applied.autoStart });
    updateMenu();
  });
  handle('quota:subscription', (value) => quota.setManualSubscription(value));
  handle('quota:position', () => {
    quota.saveOffset(DEFAULT_SETTINGS.offset.x, DEFAULT_SETTINGS.offset.y);
    quota.publish();
  });
  handle('quota:project', () => shell.openExternal(projectURL));
  handle('quota:quit', () => app.quit());
}

function trayIcon(): Electron.NativeImage {
  const size = 32,
    pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot(x - 15.5, y - 15.5);
      if (radius > 10 && radius < 14) {
        const offset = (y * size + x) * 4;
        pixels[offset] = 160;
        pixels[offset + 1] = 191;
        pixels[offset + 2] = 43;
        pixels[offset + 3] = 255;
      }
    }
  const image = nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: 2 });
  if (process.platform === 'darwin') image.setTemplateImage(true);
  return image;
}

function updateMenu(): void {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Codex Quota Overlay', enabled: false },
      { label: quota.text('设置与说明…', 'Settings…'), click: openSettings },
      { label: quota.text('立即刷新', 'Refresh now'), click: () => void quota.refresh(true) },
      {
        label: quota.text('恢复浮层位置', 'Reset overlay position'),
        click: () => {
          quota.saveOffset(16, 64);
          quota.publish();
        },
      },
      { type: 'separator' },
      { label: 'GitHub', click: () => void shell.openExternal(projectURL) },
      { label: quota.text('退出', 'Quit'), click: () => app.quit() },
    ]),
  );
}

async function start(): Promise<void> {
  if (process.platform === 'darwin') app.dock?.hide();
  // Per-session proxy only, using an existing HTTP(S) proxy without credentials.
  const proxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (proxy) {
    try {
      const url = new URL(proxy);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password)
        await session.defaultSession.setProxy({ proxyRules: url.href });
    } catch {
      /* Preserve the OS proxy when an environment value is unsupported. */
    }
  }
  quota = new QuotaApplication(
    new Store(join(app.getPath('userData'), 'settings.json')),
    app.getVersion(),
    preview,
    readOnly,
    render,
  );
  overlay = createOverlay();
  registerIPC();
  tray = new Tray(trayIcon());
  tray.setToolTip('Codex Quota Overlay');
  updateMenu();
  tray.on('click', () => openSettings());
  if (!preview) {
    tracker = new WindowTracker(
      app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'build'),
      (frame) => {
        host = frame;
        if (frame?.appPath) quota.appPath = frame.appPath;
        render();
        void quota.tick(!!frame);
      },
      (error) => {
        quota.state.trackerError = error || null;
        quota.publish();
      },
    );
    tracker.start();
  }
  interval = setInterval(() => void quota.tick(!!host), 1_000);
  void quota.refresh();
  if (process.argv.includes('--smoke-test')) {
    const outputIndex = process.argv.indexOf('--screenshot');
    setTimeout(async () => {
      try {
        quota.state.expanded = true;
        quota.publish();
        await new Promise((done) => setTimeout(done, 250));
        if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
          const output = resolve(process.argv[outputIndex + 1]);
          await mkdir(resolve(output, '..'), { recursive: true });
          await writeFile(output, (await overlay!.webContents.capturePage()).toPNG());
        }
        console.log('Offline preview smoke test completed; no account or reset requests.');
        app.quit();
      } catch {
        app.exit(1);
      }
    }, 1_500);
  }
}

app.on('window-all-closed', () => {
  /* The tray owns the app lifecycle. */
});
app.on('before-quit', () => {
  quitting = true;
  clearInterval(interval);
  if (process.platform === 'win32') flushWindowsPosition();
  tracker?.stop();
  quota?.close();
  tray?.destroy();
});
