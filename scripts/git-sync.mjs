#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  appendFile,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_DIRECTORIES = new Set([
  'src',
  'native',
  'scripts',
  'tests',
  'docs',
  '.github',
  '.run',
  'assets',
]);
const ROOT_FILES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'LICENSE',
  'NOTICE',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.prettierignore',
  '.prettierrc.json',
  '.nvmrc',
  '.node-version',
  '.npmrc',
  'tsconfig.json',
  'playwright.config.ts',
  'eslint.config.mjs',
  'electron-builder.yml',
  'electron-builder.yaml',
]);
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.txt',
  '.html',
  '.css',
  '.scss',
  '.svg',
  '.xml',
  '.yml',
  '.yaml',
  '.swift',
  '.ps1',
  '.sh',
  '.command',
  '.cmd',
  '.bat',
]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.icns']);
const GENERATED_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  'release',
  'coverage',
  'test-results',
  'playwright-report',
  '__snapshots__',
]);
const SECRET_FILE =
  /^(?:\.env(?:\..*)?|auth\.json|tokens?\.json|credentials?(?:[.-].*)?|secrets?(?:[.-].*)?|settings\.local\.json|id_rsa|id_ed25519)$/iu;
const SECRET_EXT = /\.(?:pem|key|p12|pfx|keystore)$/iu;
const SECRET_PATTERNS = [
  ['private key', /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/u],
  ['OpenAI token', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}/u],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{35,})/u],
  ['JWT credential', /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/u],
  [
    'saved credential',
    /["'](?:access_token|refresh_token|client_secret|api_key)["']\s*:\s*["'][A-Za-z0-9_./+=-]{24,}["']/iu,
  ],
  ['npm token', /(?:_authToken|_auth|_password)\s*=\s*(?!\$\{)[A-Za-z0-9_./+=-]{16,}/u],
];
const FETCH_INTERVAL = 30_000;
const DEBOUNCE = 10_000;
const POLL_INTERVAL = 2_000;
const COMMAND_TIMEOUT = 120_000;

export class CommandError extends Error {
  constructor(program, code) {
    super(`${path.basename(program)} failed (exit ${code ?? 'unknown'}).`);
    this.code = code;
  }
}

/** Captures output for internal inspection only; errors never print raw Git URLs or credentials. */
export function command(program, args, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env },
    });
    const chunks = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(() => child.kill(), options.timeout ?? COMMAND_TIMEOUT);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) child.kill();
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.once('error', () => {
      settled = true;
      clearTimeout(timer);
      reject(new CommandError(program, null));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      const result = { code: code ?? 1, stdout: Buffer.concat(chunks) };
      if (result.code !== 0 && !options.allowFailure) reject(new CommandError(program, code));
      else resolve(result);
    });
  });
}

const git = (repo, args, options) => command('git', args, repo, options);
const text = (result) => result.stdout.toString('utf8').trim();
const nulNames = (buffer) => buffer.toString('utf8').split('\0').filter(Boolean);
const safeName = (value) => {
  let sanitized = value.replace(/[\u0000-\u001f\u007f]/gu, '?');
  for (const [, pattern] of SECRET_PATTERNS) {
    sanitized = sanitized.replace(new RegExp(pattern.source, `${pattern.flags}g`), '[redacted]');
  }
  return sanitized.slice(0, 160);
};

export function isSecretFilename(file) {
  const basename = path.posix.basename(file);
  return SECRET_FILE.test(basename) || SECRET_EXT.test(basename);
}

export function isAllowedPath(file) {
  if (!file || file.startsWith('/') || /[\\\u0000-\u001f]/u.test(file)) return false;
  const parts = file.split('/');
  if (parts.some((part) => part === '..' || part === '.' || GENERATED_SEGMENTS.has(part)))
    return false;
  if (isSecretFilename(file)) return false;
  if (file === '.idea/vcs.xml') return true;
  if (parts.length === 1)
    return (
      ROOT_FILES.has(file) ||
      /^[A-Z][A-Za-z0-9_.-]*\.md$/u.test(file) ||
      /^tsconfig(?:\.[a-z0-9-]+)?\.json$/u.test(file)
    );
  if (!SOURCE_DIRECTORIES.has(parts[0])) return false;
  const extension = path.posix.extname(file).toLowerCase();
  return (
    SOURCE_EXTENSIONS.has(extension) || (parts[0] === 'assets' && IMAGE_EXTENSIONS.has(extension))
  );
}

/** Returns a category, never a matching secret value. */
export function secretReason(file, bytes) {
  if (isSecretFilename(file)) return 'credential filename';
  if (bytes.length > 5 * 1024 * 1024) return 'file exceeds the source sync size limit';
  if (bytes.includes(0)) {
    return file.startsWith('assets/') &&
      IMAGE_EXTENSIONS.has(path.posix.extname(file).toLowerCase())
      ? null
      : 'binary/generated content';
  }
  const source = bytes.toString('utf8');
  for (const [category, pattern] of SECRET_PATTERNS) if (pattern.test(source)) return category;
  return null;
}

export function sanitizedRemote(remote) {
  try {
    const url = new URL(remote);
    if (['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) {
      return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}`;
    }
  } catch {
    /* SCP-style SSH and local test remotes are handled below. */
  }
  const ssh = /^(?:[^@\s]+@)?([\w.-]+):([\w./-]+)$/u.exec(remote);
  return ssh && !/^[A-Za-z]:[\\/]/u.test(remote) ? `${ssh[1]}:${ssh[2]}` : '[local repository]';
}

async function atomicJSON(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

async function loadJSON(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

function livePID(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export async function repositoryPaths(cwd = process.cwd()) {
  const repo = text(await git(cwd, ['rev-parse', '--show-toplevel']));
  const raw = text(await git(repo, ['rev-parse', '--git-path', 'quota-sync']));
  return { repo, metadata: path.resolve(repo, raw) };
}

export async function acquireLock(metadata) {
  await mkdir(metadata, { recursive: true, mode: 0o700 });
  const file = path.join(metadata, 'lock.json');
  const claimFile = path.join(metadata, 'lock.claim');
  const owner = { pid: process.pid, nonce: randomUUID(), startedAt: new Date().toISOString() };
  let claim;
  try {
    claim = await open(claimFile, 'wx', 0o600);
  } catch {
    throw new Error(
      'Another process is acquiring the sync lock. Retry shortly; inspect lock.claim if this persists.',
    );
  }
  try {
    await claim.writeFile(JSON.stringify(owner));
    const current = await loadJSON(file);
    if (current && livePID(current.pid))
      throw new Error('Another sync process is running. Use sync:status or sync:resume.');
    if (current) await rm(file, { force: true });
    try {
      const handle = await open(file, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(owner));
      await handle.close();
      return async () => {
        const current = await loadJSON(file);
        if (current?.nonce === owner.nonce) await rm(file, { force: true });
      };
    } catch (error) {
      if (error.code === 'EEXIST')
        throw new Error(
          'The sync lock is incomplete. Inspect lock.json before starting another watcher.',
        );
      throw error;
    }
  } finally {
    await claim.close();
    await rm(claimFile, { force: true });
  }
}

/** Parse porcelain v1 -z, including both paths in rename/copy records. */
export async function changes(repo) {
  const records = nulNames(
    (await git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout,
  );
  const result = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    const status = record.slice(0, 2);
    result.push({
      file: record.slice(3),
      untracked: status === '??',
      staged: status[0] !== ' ' && status[0] !== '?',
    });
    if (/[RC]/u.test(status))
      result.push({ file: records[++index], untracked: false, staged: true });
  }
  return result;
}

export async function fingerprint(repo) {
  const hash = createHash('sha256');
  hash.update(
    (await git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout,
  );
  hash.update((await git(repo, ['diff', '--binary'])).stdout);
  hash.update((await git(repo, ['diff', '--cached', '--binary'])).stdout);
  hash.update((await git(repo, ['rev-parse', 'HEAD'], { allowFailure: true })).stdout);
  for (const item of await changes(repo)) {
    if (!item.untracked || !isAllowedPath(item.file)) continue;
    try {
      hash.update(item.file);
      hash.update(await readFile(path.join(repo, item.file)));
    } catch {
      hash.update('file changed while reading');
    }
  }
  return hash.digest('hex');
}

export async function findNpmCLI(preferred) {
  const candidates = [preferred, process.env.QUOTA_SYNC_NPM_CLI, process.env.npm_execpath];
  for (const executable of [process.execPath, await realpath(process.execPath)]) {
    candidates.push(
      path.join(path.dirname(executable), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    );
    candidates.push(
      path.resolve(path.dirname(executable), '../lib/node_modules/npm/bin/npm-cli.js'),
    );
  }
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    candidates.push(path.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    candidates.push(path.resolve(directory, '../lib/node_modules/npm/bin/npm-cli.js'));
  }
  for (const candidate of candidates) {
    if (!candidate || path.basename(candidate) !== 'npm-cli.js') continue;
    try {
      await access(candidate);
      return await realpath(candidate);
    } catch {
      /* Next explicit location. */
    }
  }
  throw new Error('npm was not found. Run sync using npm run sync, or reinstall the sync service.');
}

export class SyncEngine {
  constructor(repo, metadata) {
    this.repo = repo;
    this.metadata = metadata;
    this.stateFile = path.join(metadata, 'state.json');
    this.resumeFile = path.join(metadata, 'resume.request');
    this.state = {};
  }

  async initialize() {
    await mkdir(this.metadata, { recursive: true, mode: 0o700 });
    this.state = (await loadJSON(this.stateFile)) || {};
  }

  async save(message, extra = {}) {
    this.state = {
      ...this.state,
      ...extra,
      lastMessage: message,
      updatedAt: new Date().toISOString(),
    };
    await atomicJSON(this.stateFile, this.state);
    return { paused: !!this.state.paused, message };
  }

  async pause(message) {
    return this.save(message, { paused: true });
  }

  async resume() {
    await rm(this.resumeFile, { force: true });
    return this.save('Sync resumed; changes will be checked before publishing.', {
      paused: false,
      nextNetworkAt: 0,
      networkFailures: 0,
    });
  }

  async networkFailure() {
    const failures = (this.state.networkFailures || 0) + 1;
    return this.save(
      'Git network request failed. Check connectivity/authentication; automatic retry is scheduled.',
      {
        networkFailures: failures,
        nextNetworkAt:
          Date.now() + Math.min(300_000, FETCH_INTERVAL * 2 ** Math.min(failures - 1, 4)),
      },
    );
  }

  async scanStaged() {
    const files = nulNames(
      (await git(this.repo, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']))
        .stdout,
    );
    for (const file of files) {
      if (!isAllowedPath(file)) return `Cannot auto-publish this staged path: ${safeName(file)}.`;
      const reason = secretReason(file, (await git(this.repo, ['show', `:${file}`])).stdout);
      if (reason)
        return `Publish paused: ${reason} detected in ${safeName(file)}. No secret value was logged.`;
    }
    return null;
  }

  async scanOutgoing(remoteRef) {
    const range = remoteRef ? `${remoteRef}..HEAD` : 'HEAD';
    const commits = text(await git(this.repo, ['rev-list', '--reverse', range]))
      .split('\n')
      .filter(Boolean);
    for (const commit of commits) {
      const files = nulNames(
        (
          await git(this.repo, [
            'diff-tree',
            '--root',
            '-m',
            '--no-commit-id',
            '--name-only',
            '-r',
            '-z',
            commit,
          ])
        ).stdout,
      );
      for (const file of new Set(files)) {
        const content = await git(this.repo, ['show', `${commit}:${file}`], { allowFailure: true });
        if (content.code !== 0) continue; // Deleted paths have no blob to publish in this commit.
        if (!isAllowedPath(file))
          return `Outgoing history includes a path outside the source allowlist: ${safeName(file)}.`;
        const reason = secretReason(file, content.stdout);
        if (reason)
          return `Outgoing history contains ${reason} in ${safeName(file)}. Review local commits before resuming.`;
      }
    }
    return null;
  }

  async runChecks() {
    const before = await fingerprint(this.repo);
    const service = await loadJSON(path.join(this.metadata, 'service-config.json'));
    const npm = await findNpmCLI(service?.npmCLI);
    const result = await command(process.execPath, [npm, 'run', 'check'], this.repo, {
      allowFailure: true,
      timeout: 10 * 60_000,
    });
    const after = await fingerprint(this.repo);
    if (before !== after) return 'changed';
    return result.code === 0 ? 'passed' : 'failed';
  }

  async checkResult() {
    const result = await this.runChecks();
    if (result === 'changed') {
      await this.save(
        'Files changed during checks; waiting for edits to settle before checking again.',
      );
      return false;
    }
    if (result === 'failed') {
      await this.pause(
        'npm run check failed. Fix the project, then run npm run sync:resume. Changes are preserved.',
      );
      return false;
    }
    return true;
  }

  async once({ forceFetch = true, allowLocal = true } = {}) {
    try {
      await access(this.resumeFile);
      await this.resume();
    } catch {
      /* No resume request. */
    }
    if (this.state.paused) return { paused: true, message: this.state.lastMessage };
    try {
      return await this.perform({ forceFetch, allowLocal });
    } catch (error) {
      return this.pause(
        error instanceof CommandError
          ? 'A local Git operation failed. Inspect the repository in IDEA, then run npm run sync:resume.'
          : safeName(error.message || 'Sync needs attention.'),
      );
    }
  }

  async perform({ forceFetch, allowLocal }) {
    const branchResult = await git(this.repo, ['symbolic-ref', '--short', 'HEAD'], {
      allowFailure: true,
    });
    if (branchResult.code !== 0)
      return this.pause('Detached HEAD cannot be synchronized. Switch to a branch and resume.');
    const branch = text(branchResult);
    const origin = await git(this.repo, ['remote', 'get-url', 'origin'], { allowFailure: true });
    if (origin.code !== 0)
      return this.pause('No origin remote is configured. Connect the repository and resume.');
    for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
      if (
        (await git(this.repo, ['rev-parse', '-q', '--verify', name], { allowFailure: true }))
          .code === 0
      ) {
        return this.pause(
          'A manual Git operation is in progress. Complete it before resuming sync.',
        );
      }
    }

    const now = Date.now();
    const mayNetwork = now >= (this.state.nextNetworkAt || 0);
    if (mayNetwork && (forceFetch || now - (this.state.lastFetchAt || 0) >= FETCH_INTERVAL)) {
      const fetched = await git(this.repo, ['fetch', '--no-tags', 'origin'], {
        allowFailure: true,
        timeout: 60_000,
      });
      if (fetched.code !== 0) return this.networkFailure();
      await this.save('Fetched remote changes.', {
        lastFetchAt: Date.now(),
        nextNetworkAt: 0,
        networkFailures: 0,
      });
    }

    const pending = await changes(this.repo);
    const unsupported = pending.find((item) => !item.untracked && !isAllowedPath(item.file));
    if (unsupported)
      return this.pause(
        `A tracked/staged path needs manual review: ${safeName(unsupported.file)}.`,
      );
    const selected = [
      ...new Set(pending.filter((item) => isAllowedPath(item.file)).map((item) => item.file)),
    ];
    if (selected.length && !allowLocal) return this.save('Waiting for local edits to settle.');
    if (selected.length) {
      for (const file of selected) {
        try {
          if ((await lstat(path.join(this.repo, file))).isSymbolicLink())
            return this.pause(`Symbolic links require manual review: ${safeName(file)}.`);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      for (let offset = 0; offset < selected.length; offset += 100) {
        await git(this.repo, ['add', '-A', '--', ...selected.slice(offset, offset + 100)]);
      }
      const scan = await this.scanStaged();
      if (scan) return this.pause(scan);
      const checkedTree = text(await git(this.repo, ['write-tree']));
      if (!(await this.checkResult()))
        return { paused: !!this.state.paused, message: this.state.lastMessage };
      if (text(await git(this.repo, ['write-tree'])) !== checkedTree) {
        return this.save('Staging changed after checks; waiting to verify the new selection.');
      }
      for (const key of ['user.name', 'user.email']) {
        if ((await git(this.repo, ['config', '--get', key], { allowFailure: true })).code !== 0) {
          return this.pause(
            'Git commit identity is missing. Configure this repository in IDEA and resume.',
          );
        }
      }
      if (
        (await git(this.repo, ['diff', '--cached', '--quiet'], { allowFailure: true })).code !== 0
      ) {
        await git(this.repo, ['commit', '-m', 'chore: sync verified local changes']);
        if (text(await git(this.repo, ['rev-parse', 'HEAD^{tree}'])) !== checkedTree) {
          return this.pause(
            'The committed tree changed after checks. Review hooks/staging and resume; nothing was pushed.',
          );
        }
      }
      this.state.validatedHead = text(await git(this.repo, ['rev-parse', 'HEAD']));
    }

    const head = await git(this.repo, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
    if (head.code !== 0) return this.save('No source commit is available to synchronize.');
    const ref = `refs/remotes/origin/${branch}`;
    const exists =
      (await git(this.repo, ['rev-parse', '--verify', ref], { allowFailure: true })).code === 0;
    let ahead = 1;
    let behind = 0;
    if (exists)
      [ahead, behind] = text(
        await git(this.repo, ['rev-list', '--left-right', '--count', `HEAD...${ref}`]),
      )
        .split(/\s+/u)
        .map(Number);
    if (behind) {
      if ((await changes(this.repo)).some((item) => !item.untracked))
        return this.save('Waiting for local changes before updating from GitHub.');
      if (ahead) {
        const trial = await git(this.repo, ['merge-tree', '--write-tree', 'HEAD', ref], {
          allowFailure: true,
        });
        if (trial.code !== 0)
          return this.pause(
            'Local and remote commits conflict. Resolve them in IDEA, then run npm run sync:resume. Both histories are preserved.',
          );
        await git(this.repo, ['merge', '--no-edit', '--no-stat', ref]);
      } else {
        await git(this.repo, ['merge', '--ff-only', '--no-stat', ref]);
      }
      if (!(await this.checkResult()))
        return { paused: !!this.state.paused, message: this.state.lastMessage };
      this.state.validatedHead = text(await git(this.repo, ['rev-parse', 'HEAD']));
      [ahead] = text(await git(this.repo, ['rev-list', '--left-right', '--count', `HEAD...${ref}`]))
        .split(/\s+/u)
        .map(Number);
    }
    if (!ahead)
      return this.save('Local and GitHub commits are synchronized.', {
        lastSyncAt: new Date().toISOString(),
      });
    const outgoingProblem = await this.scanOutgoing(exists ? ref : null);
    if (outgoingProblem) return this.pause(outgoingProblem);
    const currentHead = text(await git(this.repo, ['rev-parse', 'HEAD']));
    if (this.state.validatedHead !== currentHead) {
      if (!(await this.checkResult()))
        return { paused: !!this.state.paused, message: this.state.lastMessage };
      this.state.validatedHead = currentHead;
    }
    if ((await changes(this.repo)).some((item) => !item.untracked || isAllowedPath(item.file))) {
      return this.save('New local edits arrived; publishing waits for the next verified commit.');
    }
    if (text(await git(this.repo, ['rev-parse', 'HEAD'])) !== currentHead) {
      return this.save(
        'The local branch changed during verification; publishing waits for the next check.',
      );
    }
    if (!mayNetwork)
      return this.save('Waiting for the network retry window. Local changes are preserved.');
    const pushed = await git(
      this.repo,
      ['push', '--porcelain', '-u', 'origin', `${currentHead}:refs/heads/${branch}`],
      { allowFailure: true, timeout: 60_000 },
    );
    if (pushed.code !== 0) return this.networkFailure();
    return this.save('Verified local changes were pushed to GitHub.', {
      lastSyncAt: new Date().toISOString(),
      networkFailures: 0,
      nextNetworkAt: 0,
    });
  }
}

export async function status(cwd = process.cwd()) {
  const { repo, metadata } = await repositoryPaths(cwd);
  const state = (await loadJSON(path.join(metadata, 'state.json'))) || {};
  const lock = await loadJSON(path.join(metadata, 'lock.json'));
  const remote = await git(repo, ['remote', 'get-url', 'origin'], { allowFailure: true });
  return {
    running: !!lock && livePID(lock.pid),
    paused: !!state.paused,
    branch: safeName(
      text(await git(repo, ['symbolic-ref', '--short', 'HEAD'], { allowFailure: true })) ||
        '(detached)',
    ),
    remote: remote.code === 0 ? sanitizedRemote(text(remote)) : '(none)',
    pending: (await changes(repo)).filter((item) => isAllowedPath(item.file)).length,
    lastMessage: state.lastMessage || 'Sync has not run yet.',
    lastSyncAt: state.lastSyncAt || null,
    nextRetryAt: state.nextNetworkAt ? new Date(state.nextNetworkAt).toISOString() : null,
  };
}

export async function runCLI() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--once';
  if (args.length > 1 || !['--once', '--watch', '--status', '--resume'].includes(mode)) {
    throw new Error('Usage: node scripts/git-sync.mjs --once|--watch|--status|--resume');
  }
  if (mode === '--status') {
    console.log(JSON.stringify(await status(), null, 2));
    return;
  }
  const { repo, metadata } = await repositoryPaths();
  if (mode === '--resume') {
    await mkdir(metadata, { recursive: true, mode: 0o700 });
    const lock = await loadJSON(path.join(metadata, 'lock.json'));
    if (lock && livePID(lock.pid)) {
      await writeFile(path.join(metadata, 'resume.request'), new Date().toISOString(), {
        mode: 0o600,
      });
      console.log('Resume requested. The running watcher will recheck changes.');
      return;
    }
  }
  const release = await acquireLock(metadata);
  const engine = new SyncEngine(repo, metadata);
  await engine.initialize();
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    if (mode === '--resume') await engine.resume();
    if (mode !== '--watch') {
      const result = await engine.once();
      console.log(result.message);
      if (result.paused) process.exitCode = 1;
      return;
    }
    let previous = '';
    let editedAt = Date.now();
    let lastLogged = '';
    while (!stopping) {
      const current = await fingerprint(repo);
      if (current !== previous) {
        previous = current;
        editedAt = Date.now();
      }
      const stable = Date.now() - editedAt >= DEBOUNCE;
      const fetchDue = Date.now() - (engine.state.lastFetchAt || 0) >= FETCH_INTERVAL;
      if (stable || fetchDue || engine.state.paused) {
        const result = await engine.once({ forceFetch: false, allowLocal: stable });
        if (result.message !== lastLogged) {
          const line = `${new Date().toISOString()} ${result.message}`;
          console.log(line);
          await appendFile(path.join(metadata, 'watch.log'), `${line}\n`, { mode: 0o600 });
          lastLogged = result.message;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCLI().catch((error) => {
    console.error(safeName(error.message || 'Sync failed.'));
    process.exitCode = 1;
  });
}
