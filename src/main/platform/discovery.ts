import { constants } from 'node:fs';
import { access, open, realpath, stat } from 'node:fs/promises';
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
    const appRoots = [
      ...(appPath && /\.exe$/iu.test(appPath) ? [paths.dirname(appPath)] : []),
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
  for (const candidate of candidates) {
    const executable = await validateExecutable(candidate);
    if (executable) return executable;
  }
  return null;
}
