import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

test('Windows native tracker emits a JSON heartbeat without a Codex account', async () => {
  test.skip(
    process.platform !== 'win32',
    'Runs the real PowerShell/User32 helper on Windows only.',
  );
  test.setTimeout(30_000);

  const sourceRoot = resolve(__dirname, '../..');
  const script = resolve(sourceRoot, 'native/windows/WindowTracker.ps1');
  const powershell = resolve(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
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
