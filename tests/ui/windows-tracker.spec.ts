import { test, expect } from '@playwright/test';
import { execFile, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const powershell = resolve(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe',
);
const sourceRoot = resolve(__dirname, '../..');
const script = resolve(sourceRoot, 'native/windows/WindowTracker.ps1');

test('Windows tracking survives overlay focus and drops unrelated or unavailable hosts', async () => {
  test.skip(process.platform !== 'win32', 'Runs the Windows helper selection policy.');

  // Load the actual helper functions without the polling loop. Substitute only
  // OS observations, so the focus/visibility policy is deterministic and never
  // steals focus from the user or needs their Codex account.
  const { stdout } = await promisify(execFile)(
    powershell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `
. $env:QUOTA_TRACKER_TEST_SOURCE -ParentProcessId 1234
$script:Owners = @{ 11 = 42; 22 = 1234; 33 = 99; 0 = 0 }
$script:Frames = @{
    11 = @{ visible = $true; bounds = @{ x = 10; y = 20; width = 900; height = 700 }; appPath = 'C:\\Codex\\ChatGPT.exe' }
}
function Get-WindowProcessId {
    param([IntPtr]$Window)
    return $script:Owners[$Window.ToInt32()]
}
function Get-CodexWindowFrame {
    param([IntPtr]$Window)
    if ($script:Frames.ContainsKey($Window.ToInt32())) {
        return $script:Frames[$Window.ToInt32()]
    }
    return @{ visible = $false }
}
$results = [System.Collections.Generic.List[object]]::new()
$results.Add((Get-CodexFrame -ForegroundWindow ([IntPtr]22)))
$results.Add((Get-CodexFrame -ForegroundWindow ([IntPtr]11)))
$results.Add((Get-CodexFrame -ForegroundWindow ([IntPtr]22)))
# The host can move while an overlay/settings window owns foreground.
$script:Frames[11] = @{ visible = $true; bounds = @{ x = -1400; y = 80; width = 900; height = 700 }; appPath = 'C:\\Codex\\ChatGPT.exe' }
$results.Add((Get-CodexFrame -ForegroundWindow ([IntPtr]22)))
$results.Add((Get-CodexFrame -ForegroundWindow ([IntPtr]33)))
$results.Add((Get-CodexFrame -ForegroundWindow ([IntPtr]22)))
$results.Add((Get-CodexFrame -ForegroundWindow ([IntPtr]11)))
# Minimized hosts must disappear even when the overlay remains foreground.
$script:Frames[11] = @{ visible = $false }
$results.Add((Get-CodexFrame -ForegroundWindow ([IntPtr]22)))
$script:Frames[11] = @{ visible = $true; bounds = @{ x = 10; y = 20; width = 900; height = 700 } }
$results.Add((Get-CodexFrame -ForegroundWindow ([IntPtr]11)))
# Closed/reused HWNDs fail the same native identity/visibility validation.
$script:Frames.Remove(11)
$results.Add((Get-CodexFrame -ForegroundWindow ([IntPtr]22)))
ConvertTo-Json -InputObject $results.ToArray() -Compress -Depth 5
`,
    ],
    {
      cwd: sourceRoot,
      windowsHide: true,
      timeout: 20_000,
      env: { ...process.env, QUOTA_TRACKER_TEST_SOURCE: script },
    },
  );
  const frames = JSON.parse(stdout) as Array<{
    visible: boolean;
    bounds?: { x: number; y: number; width: number; height: number };
  }>;
  expect(frames.map((frame) => frame.visible)).toEqual([
    false, // Opening our settings without an active Codex host must not show an overlay.
    true, // Codex becomes foreground.
    true, // Clicking the overlay preserves its verified host.
    true, // Geometry is refreshed while our own UI remains foreground.
    false, // Switching to an unrelated app hides the overlay.
    false, // Refocusing our settings cannot revive a stale host.
    true, // Activating Codex establishes the host again.
    false, // Minimizing Codex clears the association.
    true, // Restoring/activating Codex establishes it again.
    false, // Closing Codex clears the association.
  ]);
  expect(frames[3].bounds).toEqual({ x: -1400, y: 80, width: 900, height: 700 });
});

test('Windows native tracker emits a JSON heartbeat without a Codex account', async () => {
  test.skip(
    process.platform !== 'win32',
    'Runs the real PowerShell/User32 helper on Windows only.',
  );
  test.setTimeout(30_000);

  // Use the same native helper as the app. The test runner is a live parent;
  // no Codex process, credentials, account requests, or reset APIs are needed.
  const child = spawn(
    powershell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-ParentProcessId',
      String(process.pid),
    ],
    { cwd: sourceRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let closed = false;
  let stderr = '';
  child.once('close', () => {
    closed = true;
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-4096);
  });

  try {
    const heartbeat = await new Promise<unknown>((accept, reject) => {
      let output = '';
      let settled = false;
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.stdout.off('data', onData);
        child.off('close', onClose);
        child.off('error', onError);
        if (error) reject(error);
        else accept(value);
      };
      const onData = (chunk: string) => {
        output += chunk;
        const newline = output.indexOf('\n');
        if (newline < 0) return;
        const firstLine = output.slice(0, newline).trim();
        try {
          finish(undefined, JSON.parse(firstLine));
        } catch {
          finish(new Error('The native tracker did not emit JSON as its first heartbeat.'));
        }
      };
      const onError = (error: Error) => finish(error);
      const onClose = (code: number | null) =>
        finish(new Error(`Native tracker exited before its heartbeat (code ${code}). ${stderr}`));
      const timeout = setTimeout(
        () =>
          finish(new Error(`Native tracker produced no heartbeat within 20 seconds. ${stderr}`)),
        20_000,
      );
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', onData);
      child.once('error', onError);
      child.once('close', onClose);
    });
    expect(heartbeat).toEqual(expect.objectContaining({ visible: expect.any(Boolean) }));
    expect(closed).toBe(false);
  } finally {
    if (!closed) {
      child.kill();
      await new Promise<void>((done, reject) => {
        const timeout = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('Native tracker did not terminate after the test.'));
        }, 5_000);
        child.once('close', () => {
          clearTimeout(timeout);
          done();
        });
      });
    }
  }
});
