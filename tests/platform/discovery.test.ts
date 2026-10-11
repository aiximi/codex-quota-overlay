import assert from 'node:assert/strict';
import { mkdtemp, chmod, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  discoveryCandidates,
  isNativeHeader,
  validateExecutable,
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
  assert.ok(
    candidates.includes(
      'C:\\Roaming\\npm\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\codex\\codex.exe',
    ),
  );
  assert.equal(candidates.filter((candidate) => candidate === 'C:\\Tools\\codex.exe').length, 1);
  assert.ok(candidates.every((candidate) => candidate.endsWith('.exe')));
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
