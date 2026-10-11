import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  SyncEngine,
  acquireLock,
  command,
  findNpmCLI,
  isAllowedPath,
  repositoryPaths,
  sanitizedRemote,
  secretReason,
} from '../../scripts/git-sync.mjs';
import {
  launchAgentXML,
  servicePath,
  serviceRunnerSource,
  windowsArgument,
  windowsTaskScript,
} from '../../scripts/install-sync.mjs';

const runGit = async (repo, ...args) =>
  (await command('git', args, repo)).stdout.toString('utf8').trim();
const save = async (repo, file, value) => {
  await mkdir(path.dirname(path.join(repo, file)), { recursive: true });
  await writeFile(path.join(repo, file), value);
};

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'quota-sync-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git');
  const local = path.join(root, 'local');
  await mkdir(local);
  await runGit(root, 'init', '--bare', '--initial-branch=main', remote);
  await runGit(local, 'init', '--initial-branch=main');
  for (const [key, value] of [
    ['user.name', 'Sync Test'],
    ['user.email', 'sync@example.invalid'],
    ['core.autocrlf', 'false'],
  ])
    await runGit(local, 'config', key, value);
  await runGit(local, 'remote', 'add', 'origin', remote);
  await save(local, '.gitignore', '.env\nnode_modules/\n');
  await save(
    local,
    'package.json',
    JSON.stringify({
      name: 'sync-fixture',
      private: true,
      scripts: { check: 'node scripts/check.mjs' },
    }),
  );
  await save(local, 'scripts/check.mjs', 'process.exit(0);\n');
  await save(local, 'src/value.ts', 'export const value = 1;\n');
  await save(local, 'README.md', '# Sync fixture\n');
  await runGit(local, 'add', '.');
  await runGit(local, 'commit', '-m', 'Initial fixture');
  await runGit(local, 'push', '-u', 'origin', 'main');
  const { metadata } = await repositoryPaths(local);
  const engine = new SyncEngine(local, metadata);
  await engine.initialize();
  const other = async () => {
    const location = path.join(root, 'other');
    await runGit(root, 'clone', remote, location);
    await runGit(location, 'config', 'user.name', 'Remote Test');
    await runGit(location, 'config', 'user.email', 'remote@example.invalid');
    await runGit(location, 'config', 'core.autocrlf', 'false');
    return location;
  };
  const remoteCommit = async (repo, file, value) => {
    await save(repo, file, value);
    await runGit(repo, 'add', '--', file);
    await runGit(repo, 'commit', '-m', 'Remote fixture change');
    await runGit(repo, 'push', 'origin', 'main');
  };
  return { local, remote, metadata, engine, other, remoteCommit };
}

test('source allowlist excludes credentials, generated output, executables and unrelated files', () => {
  for (const file of [
    'src/main/app.ts',
    'native/macos/WindowTracker.swift',
    'scripts/git-sync.mjs',
    'README.zh-CN.md',
    '.github/workflows/release.yml',
    'assets/icon.png',
  ])
    assert.ok(isAllowedPath(file), file);
  for (const file of [
    '.env',
    '.env.example',
    'auth.json',
    'docs/credentials.json',
    'native/macos/window-tracker',
    'assets/program.exe',
    'dist/app.js',
    'src/node_modules/a.js',
    '../src/a.ts',
    'notes.txt',
    '.git/config',
  ])
    assert.ok(!isAllowedPath(file), file);
});

test('secret scanner and remote output expose categories, not matching credentials', () => {
  const token = ['sk', 'proj', 'x'.repeat(40)].join('-');
  assert.equal(
    secretReason('src/example.ts', Buffer.from(`const token = "${token}";`)),
    'OpenAI token',
  );
  assert.equal(
    secretReason('docs/key.txt', Buffer.from(['-----BEGIN ', 'PRIVATE KEY-----'].join(''))),
    'private key',
  );
  assert.equal(
    secretReason('src/example.ts', Buffer.from('const token = process.env.TOKEN;')),
    null,
  );
  assert.equal(
    sanitizedRemote('https://user:secret@example.invalid/owner/repo.git?token=hidden'),
    'https://example.invalid/owner/repo.git',
  );
  assert.equal(
    sanitizedRemote('git@example.invalid:owner/repo.git'),
    'example.invalid:owner/repo.git',
  );
});

test('exclusive lock rejects a second live process and allows clean release', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'quota-sync-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const release = await acquireLock(root);
  await assert.rejects(acquireLock(root), /Another sync process/u);
  await release();
  const releaseAgain = await acquireLock(root);
  await releaseAgain();
});

test('new source files are checked, committed and pushed only to a local bare fixture', async (t) => {
  const { local, remote, engine } = await fixture(t);
  await save(local, 'src/new.ts', 'export const added = true;\n');
  await save(local, '.env', 'PRIVATE_VALUE=example\n');
  await save(local, 'personal-notes.txt', 'not source\n');
  const result = await engine.once();
  assert.equal(result.paused, false, result.message);
  assert.equal(await runGit(remote, 'show', 'main:src/new.ts'), 'export const added = true;');
  assert.equal(await runGit(local, 'ls-files', '.env', 'personal-notes.txt'), '');
});

test('remote-only changes fast-forward into the local IDEA working directory', async (t) => {
  const { local, engine, other, remoteCommit } = await fixture(t);
  await remoteCommit(await other(), 'README.md', '# Remote update\n');
  const result = await engine.once();
  assert.equal(result.paused, false, result.message);
  assert.equal(await readFile(path.join(local, 'README.md'), 'utf8'), '# Remote update\n');
  assert.equal(await runGit(local, 'status', '--porcelain'), '');
});

test('nonconflicting divergence preserves both commits and publishes a checked merge', async (t) => {
  const { local, remote, engine, other, remoteCommit } = await fixture(t);
  await save(local, 'src/local.ts', 'export const localChange = true;\n');
  await remoteCommit(await other(), 'docs/remote.md', 'Remote documentation\n');
  const result = await engine.once();
  assert.equal(result.paused, false, result.message);
  assert.equal(
    await runGit(remote, 'show', 'main:src/local.ts'),
    'export const localChange = true;',
  );
  assert.equal(await runGit(remote, 'show', 'main:docs/remote.md'), 'Remote documentation');
  assert.equal(
    (await runGit(local, 'rev-list', '--parents', '-n', '1', 'HEAD')).split(' ').length,
    3,
  );
});

test('conflict detection leaves both histories and the working tree untouched by a merge', async (t) => {
  const { local, remote, engine, other, remoteCommit } = await fixture(t);
  await save(local, 'src/value.ts', 'export const value = 2;\n');
  await remoteCommit(await other(), 'src/value.ts', 'export const value = 3;\n');
  const result = await engine.once();
  assert.equal(result.paused, true);
  assert.match(result.message, /conflict/u);
  assert.equal(
    await readFile(path.join(local, 'src/value.ts'), 'utf8'),
    'export const value = 2;\n',
  );
  assert.equal(await runGit(remote, 'show', 'main:src/value.ts'), 'export const value = 3;');
  assert.equal(
    (
      await command('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], local, {
        allowFailure: true,
      })
    ).code,
    1,
  );
  assert.equal(await runGit(local, 'status', '--porcelain'), '');
});

test('secret-bearing pending content is paused without pushing or printing the value', async (t) => {
  const { local, remote, engine } = await fixture(t);
  const before = await runGit(remote, 'rev-parse', 'main');
  const token = ['ghp', 'A'.repeat(40)].join('_');
  await save(local, 'src/example.ts', `export const credential = "${token}";\n`);
  const result = await engine.once();
  assert.equal(result.paused, true);
  assert.match(result.message, /GitHub token/u);
  assert.ok(!result.message.includes(token));
  assert.equal(await runGit(remote, 'rev-parse', 'main'), before);
});

test('secrets removed in a later local commit still block publication of outgoing history', async (t) => {
  const { local, remote, engine } = await fixture(t);
  const before = await runGit(remote, 'rev-parse', 'main');
  const token = ['sk', 'x'.repeat(40)].join('-');
  await save(local, 'src/example.ts', `export const credential = "${token}";\n`);
  await runGit(local, 'add', 'src/example.ts');
  await runGit(local, 'commit', '-m', 'Fixture secret');
  await save(local, 'src/example.ts', 'export const credential = null;\n');
  await runGit(local, 'add', 'src/example.ts');
  await runGit(local, 'commit', '-m', 'Remove fixture secret');
  const result = await engine.once();
  assert.equal(result.paused, true);
  assert.match(result.message, /Outgoing history contains/u);
  assert.equal(await runGit(remote, 'rev-parse', 'main'), before);
});

test('failed checks pause and preserve edits; explicit resume rechecks them', async (t) => {
  const { local, remote, engine } = await fixture(t);
  const before = await runGit(remote, 'rev-parse', 'main');
  await save(local, 'scripts/check.mjs', 'process.exit(1);\n');
  const result = await engine.once();
  assert.equal(result.paused, true);
  assert.match(result.message, /npm run check failed/u);
  assert.equal(await runGit(remote, 'rev-parse', 'main'), before);
  await save(local, 'scripts/check.mjs', 'process.exit(0);\n');
  await save(local, 'src/fixed.ts', 'export const fixed = true;\n');
  await engine.resume();
  const resumed = await engine.once();
  assert.equal(resumed.paused, false, resumed.message);
  assert.equal(await runGit(remote, 'show', 'main:src/fixed.ts'), 'export const fixed = true;');
});

test('edits arriving during checks are deferred rather than committed unchecked', async (t) => {
  const { local, remote, engine } = await fixture(t);
  const before = await runGit(local, 'rev-parse', 'HEAD');
  await save(
    local,
    'scripts/check.mjs',
    `import { existsSync, writeFileSync } from 'node:fs';
if (!existsSync('.git/check-ran')) {
  writeFileSync('.git/check-ran', 'yes');
  writeFileSync('src/value.ts', 'export const value = 9;\\n');
}
`,
  );
  const result = await engine.once();
  assert.equal(result.paused, false);
  assert.match(result.message, /changed during checks/u);
  assert.equal(await runGit(local, 'rev-parse', 'HEAD'), before);
  assert.equal(await runGit(remote, 'rev-parse', 'main'), before);
  const retried = await engine.once();
  assert.equal(retried.paused, false, retried.message);
  assert.equal(await runGit(remote, 'show', 'main:src/value.ts'), 'export const value = 9;');
});

test('network failure backs off without permanently pausing', async (t) => {
  const { local, engine } = await fixture(t);
  await runGit(local, 'remote', 'set-url', 'origin', path.join(local, 'missing.git'));
  const result = await engine.once();
  assert.equal(result.paused, false);
  assert.ok(engine.state.nextNetworkAt >= Date.now() + 28_000);
  assert.equal(engine.state.networkFailures, 1);
});

test('installer quoting preserves spaces and metacharacters without shell execution', () => {
  assert.equal(windowsArgument('C:\\A B\\sync.mjs'), '"C:\\A B\\sync.mjs"');
  assert.equal(windowsArgument('C:\\A\\'), '"C:\\A\\\\"');
  const task = windowsTaskScript({
    label: 'fixture',
    repo: "C:\\O'Brien & Co",
    node: 'C:\\Node\\node.exe',
    script: "C:\\O'Brien & Co\\sync.mjs",
    uninstall: false,
  });
  assert.ok(task.includes("O''Brien & Co"));
  assert.ok(task.includes('-RunLevel Limited'));
  const plist = launchAgentXML({
    label: 'fixture',
    repo: '/example/A&B',
    metadata: '/example/meta',
    node: '/example/node',
    script: '/example/script.mjs',
  });
  assert.ok(plist.includes('/example/A&amp;B'));
  assert.ok(plist.includes('<string>--watch</string>'));
});

test('service tool path restores Node and ignores relative/project dependency directories', () => {
  assert.equal(
    servicePath(
      '/tools/node/bin/node',
      '/project/node_modules/.bin:/usr/bin:.:/tools/node/bin',
      'darwin',
    ),
    '/tools/node/bin:/usr/bin',
  );
  assert.equal(
    servicePath(
      'C:\\Node\\node.exe',
      'C:\\Git\\cmd;.;C:\\Project\\node_modules\\.bin;C:\\Node',
      'win32',
    ),
    'C:\\Node;C:\\Git\\cmd',
  );
});

test('installed runner works with a minimal login-service PATH and still runs real npm checks', async (t) => {
  const { local, remote, metadata } = await fixture(t);
  const configuration = {
    npmCLI: await findNpmCLI(),
    node: process.execPath,
    path: servicePath(process.execPath, process.env.PATH || ''),
  };
  await writeFile(path.join(metadata, 'service-config.json'), JSON.stringify(configuration));
  const runner = path.join(metadata, 'service-runner.mjs');
  const script = fileURLToPath(new URL('../../scripts/git-sync.mjs', import.meta.url));
  await writeFile(runner, serviceRunnerSource(script));
  await save(local, 'src/from-service.ts', 'export const service = true;\n');
  const minimalPath =
    process.platform === 'win32'
      ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
      : '/usr/bin:/bin';
  const result = await command(process.execPath, [runner, '--once'], local, {
    env: { PATH: minimalPath, npm_execpath: '', QUOTA_SYNC_NPM_CLI: '' },
  });
  assert.match(result.stdout.toString(), /pushed to GitHub/u);
  assert.equal(
    await runGit(remote, 'show', 'main:src/from-service.ts'),
    'export const service = true;',
  );
});
