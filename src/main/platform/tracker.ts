import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { screen } from 'electron';
import { parseHelperFrame, type Frame } from './frame.js';

export type { Frame } from './frame.js';

/** Supervised geometry-only helper, with capped backoff rather than permanent failure. */
export class WindowTracker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stopped = true;
  private failures = 0;
  private lastHeartbeat = 0;
  private receivedHeartbeat = false;
  private reportedError = false;
  private healthySince = 0;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly resourceRoot: string,
    private readonly onFrame: (frame: Frame | null) => void,
    private readonly onError: (message: string) => void,
    private overlayWindowId?: number,
  ) {}

  replaceOverlayWindow(windowId: number | undefined): void {
    const wasRunning = !this.stopped;
    this.stop();
    this.overlayWindowId = windowId;
    if (wasRunning) this.start();
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.failures = 0;
    this.launch();
    this.watchdog = setInterval(() => {
      const deadline = this.receivedHeartbeat ? 5_000 : 15_000;
      if (this.child && Date.now() - this.lastHeartbeat > deadline) {
        this.fail(
          this.child,
          'Window tracking stopped responding. Restart the app if this persists.',
        );
      }
    }, 1_000);
    this.watchdog.unref();
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.watchdog);
    clearTimeout(this.retryTimer);
    this.watchdog = undefined;
    this.retryTimer = undefined;
    const child = this.child;
    this.child = null;
    child?.kill();
    this.onFrame(null);
  }

  private launch(): void {
    if (this.stopped) return;
    let command: string;
    let args: string[];
    if (process.platform === 'darwin') {
      command = path.join(this.resourceRoot, 'native', 'macos', 'window-tracker');
      args = this.overlayWindowId === undefined ? [] : [String(this.overlayWindowId)];
    } else if (process.platform === 'win32') {
      command = path.join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      );
      // The process-only policy applies to this bundled helper, not the user's
      // system policy. Organization Group Policy still takes precedence.
      args = [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(this.resourceRoot, 'native', 'windows', 'WindowTracker.ps1'),
        '-ParentProcessId',
        String(process.pid),
      ];
    } else {
      this.onFrame(null);
      this.onError('Window tracking is supported on macOS and Windows.');
      return;
    }

    const child = spawn(command, args, { stdio: 'pipe', windowsHide: true, shell: false });
    this.child = child;
    this.lastHeartbeat = Date.now();
    this.receivedHeartbeat = false;
    this.healthySince = 0;
    let buffered = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child || this.stopped) return;
      buffered += chunk;
      if (buffered.length > 65_536) {
        this.fail(child, 'Window tracking returned invalid data.');
        return;
      }
      let newline: number;
      while ((newline = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (!line) continue;
        const message = parseHelperFrame(line);
        if (!message) {
          this.fail(child, 'Window tracking returned invalid data.');
          return;
        }
        this.lastHeartbeat = Date.now();
        if (!this.healthySince) this.healthySince = this.lastHeartbeat;
        if (this.lastHeartbeat - this.healthySince >= 10_000) this.failures = 0;
        this.receivedHeartbeat = true;
        if (this.reportedError) {
          this.reportedError = false;
          this.onError('');
        }
        if (!message.visible) {
          this.onFrame(null);
          continue;
        }
        try {
          const bounds =
            process.platform === 'win32'
              ? screen.screenToDipRect(null, message.bounds)
              : message.bounds;
          this.onFrame({
            bounds,
            ...(message.appPath ? { appPath: message.appPath } : {}),
            ...(message.overlayVisible !== undefined
              ? { overlayVisible: message.overlayVisible }
              : {}),
          });
        } catch {
          this.onFrame(null);
        }
      }
    });
    // Never forward process stderr: it can contain machine-specific paths.
    child.stderr.resume();
    child.on('error', () =>
      this.fail(child, 'Could not start window tracking. Check the helper installation.'),
    );
    child.on('exit', () =>
      this.fail(child, 'Window tracking exited. Restart the app if this persists.'),
    );
  }

  private fail(child: ChildProcessWithoutNullStreams, message: string): void {
    if (this.child !== child || this.stopped) return;
    this.child = null;
    child.kill();
    this.onFrame(null);
    this.reportedError = true;
    this.onError(message);
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.failures++, 6));
    this.retryTimer = setTimeout(() => this.launch(), delay);
    this.retryTimer.unref();
  }
}
