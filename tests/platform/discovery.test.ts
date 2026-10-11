import assert from 'node:assert/strict';
import { mkdtemp, chmod, mkdir, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  discoveryCandidates,
  isNativeHeader,
  validateExecutable,
  windowsDesktopCandidates,
} from '../../src/main/platform/discovery.js';

test('macOS searches foreground app resources before standard installations', () => {
  const candidates = discoveryCandidates({
    platform: 'darwin',
    architecture: 'arm64',
    home: '/Users/example',
    env: { PATH: ':/opt/tools/bin:relative' },
    appPath: '/Applications/Custom Codex.app',
  });
  assert.equal(candidates[0], '/Applications/Custom Codex.app/Contents/Resources/codex');
  assert.ok(
    candidates.includes(
      '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    ),
  );
  assert.ok(
    candidates.includes(
      '/opt/tools/lib/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex',
    ),
  );
  assert.ok(!candidates.some((candidate) => candidate.startsWith('relative/')));
});

test('Windows follows the app path and finds native npm packages, never .cmd wrappers', () => {
  const candidates = discoveryCandidates({
    platform: 'win32',
    architecture: 'x64',
    home: 'C:\\Users\\example',
    env: { LOCALAPPDATA: 'C:\\Local', APPDATA: 'C:\\Roaming', Path: 'C:\\Tools;C:\\Tools;.' },
    appPath: 'C:\\Apps\\Codex\\Codex.exe',
  });
  assert.equal(candidates[0], 'C:\\Apps\\Codex\\resources\\codex.exe');
  assert.ok(candidates.includes('C:\\Local\\OpenAI\\Codex\\bin\\codex.exe'));
  assert.ok(
    candidates.includes(
      'C:\\Roaming\\npm\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\codex\\codex.exe',
    ),
  );
  assert.equal(candidates.filter((candidate) => candidate === 'C:\\Tools\\codex.exe').length, 1);
  assert.ok(candidates.every((candidate) => candidate.endsWith('.exe')));
});

test('Windows desktop discovery follows updated version folders before the stale fallback', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'quota-desktop-discovery-'));
  const bin = path.join(directory, 'OpenAI', 'Codex', 'bin');
  const older = path.join(bin, 'c60635126245daef', 'codex.exe');
  const current = path.join(bin, '8e5b6932251c2c1c', 'codex.exe');
  const fallback = path.join(bin, 'codex.exe');
  try {
    for (const file of [older, current, fallback]) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, Buffer.from('4d5a9000', 'hex'));
    }
    await utimes(older, 1_000, 1_000);
    await utimes(current, 2_000, 2_000);
    // Even a touched fallback must not mask the desktop app's current version.
    await utimes(fallback, 3_000, 3_000);
    await mkdir(path.join(bin, 'incomplete-download'));
    await writeFile(path.join(bin, 'unrelated.txt'), 'ignored');
    assert.deepEqual(await windowsDesktopCandidates(directory), [current, older, fallback]);

    const updated = path.join(bin, 'next-version', 'codex.exe');
    await mkdir(path.dirname(updated));
    await writeFile(updated, Buffer.from('4d5a9000', 'hex'));
    assert.equal((await windowsDesktopCandidates(directory))[0], updated);
    assert.equal(await validateExecutable(updated, 'win32'), await realpath(updated));

    await rm(current);
    assert.deepEqual(await windowsDesktopCandidates(directory), [updated, older, fallback]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Windows MSIX app hints never replace the runnable desktop CLI with protected package assets', () => {
  const options = {
    platform: 'win32' as const,
    architecture: 'x64',
    home: 'C:\\Users\\example',
    env: { LOCALAPPDATA: 'C:\\Local' },
  };
  const withoutHint = discoveryCandidates(options);
  for (const appPath of [
    'C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.0.0_x64__example\\app\\ChatGPT.exe',
    'D:/WINDOWSAPPS/OpenAI.Codex_1.0.0_x64__example/app/ChatGPT.exe',
  ]) {
    const withHint = discoveryCandidates({ ...options, appPath });
    assert.deepEqual(withHint, withoutHint);
    assert.ok(withHint.includes('C:\\Local\\OpenAI\\Codex\\bin\\codex.exe'));
    assert.ok(!withHint.some((candidate) => /WindowsApps/iu.test(candidate)));
  }
});

test('Windows desktop discovery tolerates a missing installation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'quota-no-desktop-'));
  try {
    assert.deepEqual(await windowsDesktopCandidates(directory), [
      path.join(directory, 'OpenAI', 'Codex', 'bin', 'codex.exe'),
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('native file signatures reject shell and JavaScript wrappers', () => {
  assert.ok(isNativeHeader(Buffer.from('cffaedfe', 'hex'), 'darwin'));
  assert.ok(isNativeHeader(Buffer.from('cafebabe', 'hex'), 'darwin'));
  assert.ok(isNativeHeader(Buffer.from('4d5a9000', 'hex'), 'win32'));
  assert.ok(!isNativeHeader(Buffer.from('#!/u'), 'darwin'));
  assert.ok(!isNativeHeader(Buffer.from('@ech'), 'win32'));
});

test('discovery validates real files without executing them', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'quota-discovery-'));
  try {
    const binary = path.join(directory, 'codex');
    const wrapper = path.join(directory, 'codex-wrapper');
    const linked = path.join(directory, 'codex-link');
    await writeFile(binary, Buffer.from('cffaedfe00000000', 'hex'));
    await chmod(binary, 0o755);
    await writeFile(wrapper, '#!/bin/sh\nexit 99\n', { mode: 0o755 });
    const resolvedBinary = await realpath(binary);
    assert.equal(await validateExecutable(binary, 'darwin'), resolvedBinary);
    assert.equal(await validateExecutable(wrapper, 'darwin'), null);
    assert.equal(await validateExecutable(directory, 'darwin'), null);
    assert.equal(await validateExecutable(path.join(directory, 'missing'), 'darwin'), null);
    assert.equal(await validateExecutable('relative/codex', 'darwin'), null);
    if (process.platform !== 'win32') {
      await symlink(binary, linked);
      assert.equal(await validateExecutable(linked, 'darwin'), resolvedBinary);
      await chmod(binary, 0o644);
      assert.equal(await validateExecutable(binary, 'darwin'), null);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
