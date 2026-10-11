import { constants } from 'node:fs';
import { access, open, readdir, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface DiscoveryEnvironment {
  platform: NodeJS.Platform;
  architecture: string;
  home: string;
  env: NodeJS.ProcessEnv;
  appPath?: string;
}

/** Enumerate explicit installation locations; never crawl unrelated folders. */
export function discoveryCandidates(options: DiscoveryEnvironment): string[] {
  const { platform, architecture, home, env, appPath } = options;
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const candidates: string[] = [];
  const add = (...parts: string[]) => candidates.push(paths.join(...parts));

  if (platform === 'darwin') {
    const bundles = [
      ...(appPath && appPath.endsWith('.app') ? [appPath] : []),
      '/Applications/Codex.app',
      '/Applications/ChatGPT.app',
      paths.join(home, 'Applications', 'Codex.app'),
      paths.join(home, 'Applications', 'ChatGPT.app'),
    ];
    for (const bundle of bundles) {
      add(bundle, 'Contents', 'Resources', 'codex');
      add(
        bundle,
        'Contents',
        'Resources',
        'codex-cli',
        'CodexCLI.app',
        'Contents',
        'MacOS',
        'codex',
      );
    }
  } else if (platform === 'win32') {
    const local = env.LOCALAPPDATA || paths.join(home, 'AppData', 'Local');
    // MSIX package resources can be readable native binaries but cannot be
    // launched by an unpackaged process. The desktop app copies its runnable
    // CLI to the per-user OpenAI/Codex/bin folder discovered below.
    const foregroundRoot =
      appPath && /\.exe$/iu.test(appPath) && !/[\\/]WindowsApps[\\/]/iu.test(appPath)
        ? [paths.dirname(appPath)]
        : [];
    const appRoots = [
      ...foregroundRoot,
      paths.join(local, 'Programs', 'Codex'),
      paths.join(local, 'Programs', 'codex'),
      paths.join(local, 'Codex'),
      ...(env.ProgramFiles ? [paths.join(env.ProgramFiles, 'Codex')] : []),
    ];
    for (const root of appRoots) {
      add(root, 'resources', 'codex.exe');
      add(root, 'resources', 'codex-cli', 'codex.exe');
      add(root, 'resources', 'codex-cli', 'bin', 'codex.exe');
    }
    // The Windows desktop app keeps its CLI outside the MSIX application.
    // discoverCLI expands this fallback into the current versioned binaries.
    add(local, 'OpenAI', 'Codex', 'bin', 'codex.exe');
  }

  const triple =
    platform === 'win32'
      ? `${architecture === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`
      : platform === 'darwin'
        ? `${architecture === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
        : `${architecture === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl`;
  const executable = platform === 'win32' ? 'codex.exe' : 'codex';
  const platformPackage = `codex-${platform}-${architecture === 'arm64' ? 'arm64' : 'x64'}`;
  const npmRoots =
    platform === 'win32'
      ? [paths.join(env.APPDATA || paths.join(home, 'AppData', 'Roaming'), 'npm', 'node_modules')]
      : [
          paths.join(home, '.local', 'lib', 'node_modules'),
          '/usr/local/lib/node_modules',
          '/opt/homebrew/lib/node_modules',
        ];

  // Prefer native vendor binaries over npm's .cmd or JavaScript wrapper. This
  // keeps every launch as spawn(executable, argumentArray, { shell: false }).
  const addNpmRoot = (root: string) => {
    add(root, '@openai', 'codex', 'vendor', triple, 'codex', executable);
    add(root, '@openai', platformPackage, 'vendor', triple, 'codex', executable);
    add(
      root,
      '@openai',
      'codex',
      'node_modules',
      '@openai',
      platformPackage,
      'vendor',
      triple,
      'codex',
      executable,
    );
  };
  for (const root of npmRoots) addNpmRoot(root);

  const pathValue = platform === 'win32' ? env.PATH || env.Path || '' : env.PATH || '';
  for (const directory of pathValue.split(platform === 'win32' ? ';' : ':')) {
    // Ignore empty and relative entries so a working directory cannot silently
    // replace the expected CLI. Users can explicitly select another executable.
    if (!directory || !paths.isAbsolute(directory)) continue;
    add(directory, executable);
    addNpmRoot(
      paths.join(directory, platform === 'win32' ? 'node_modules' : '../lib/node_modules'),
    );
  }
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = platform === 'win32' ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Inspect only the desktop app's managed bin folder, never unrelated directories. */
export async function windowsDesktopCandidates(localAppData: string): Promise<string[]> {
  const bin = path.join(localAppData, 'OpenAI', 'Codex', 'bin');
  const fallback = path.join(bin, 'codex.exe');
  try {
    const entries = await readdir(bin, { withFileTypes: true });
    const versioned = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const candidate = path.join(bin, entry.name, 'codex.exe');
          try {
            const info = await stat(candidate);
            return info.isFile() ? { candidate, modified: info.mtimeMs } : null;
          } catch {
            // Updates may create or remove a version while discovery is running.
            return null;
          }
        }),
    );
    // A desktop update can leave the unversioned binary behind. Prefer the
    // newest version and inspect afresh on every discovery, so hash changes
    // require neither a stored path nor an overlay reinstall.
    return [
      ...versioned
        .filter((entry) => entry !== null)
        .sort((a, b) => b.modified - a.modified || a.candidate.localeCompare(b.candidate))
        .map((entry) => entry.candidate),
      fallback,
    ];
  } catch {
    return [fallback];
  }
}

/** Mach-O/PE/ELF signatures distinguish the real executable from npm wrappers. */
export function isNativeHeader(header: Uint8Array, platform: NodeJS.Platform): boolean {
  if (header.length < 4) return false;
  if (platform === 'win32') return header[0] === 0x4d && header[1] === 0x5a;
  if (platform === 'darwin') {
    const magic = Buffer.from(header.subarray(0, 4)).toString('hex');
    return [
      'feedface',
      'feedfacf',
      'cefaedfe',
      'cffaedfe',
      'cafebabe',
      'bebafeca',
      'cafebabf',
      'bfbafeca',
    ].includes(magic);
  }
  return header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46;
}

/** Never runs a candidate while discovering it. No command strings or shells. */
export async function validateExecutable(
  candidate: string,
  platform = process.platform,
): Promise<string | null> {
  try {
    if (!candidate || /[\u0000-\u001f]/u.test(candidate) || !path.isAbsolute(candidate))
      return null;
    const resolved = await realpath(candidate);
    if (platform === 'win32' && !/\.exe$/iu.test(resolved)) return null;
    if (!(await stat(resolved)).isFile()) return null;
    await access(resolved, platform === 'win32' ? constants.R_OK : constants.R_OK | constants.X_OK);
    const file = await open(resolved, 'r');
    try {
      const header = Buffer.alloc(4);
      const { bytesRead } = await file.read(header, 0, 4, 0);
      return bytesRead === 4 && isNativeHeader(header, platform) ? resolved : null;
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}

export async function discoverCLI(
  configuredPath?: string,
  appPath?: string,
): Promise<string | null> {
  if (configuredPath?.trim()) {
    const configured = configuredPath.trim();
    const expanded =
      configured.startsWith('~/') || configured.startsWith('~\\')
        ? path.join(os.homedir(), configured.slice(2))
        : configured;
    // An explicit invalid choice is reported, never silently replaced by a
    // different installation/account profile.
    return validateExecutable(expanded);
  }
  const candidates = discoveryCandidates({
    platform: process.platform,
    architecture: process.arch,
    home: os.homedir(),
    env: process.env,
    ...(appPath ? { appPath } : {}),
  });
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const managed = await windowsDesktopCandidates(localAppData);
    const fallbackIndex = candidates.indexOf(
      path.join(localAppData, 'OpenAI', 'Codex', 'bin', 'codex.exe'),
    );
    candidates.splice(fallbackIndex, 1, ...managed);
  }
  for (const candidate of candidates) {
    const executable = await validateExecutable(candidate);
    if (executable) return executable;
  }
  return null;
}
