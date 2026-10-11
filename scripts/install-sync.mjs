#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { command, findNpmCLI, repositoryPaths } from './git-sync.mjs';

const xml = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
const ps = (value) => `'${value.replaceAll("'", "''")}'`;

/** Windows argv quoting, independent of cmd.exe and shell metacharacters. */
export function windowsArgument(value) {
  return `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, '$1$1')}"`;
}

export function installationID(repo) {
  return `io.github.aiximi.codex-quota-sync.${createHash('sha256').update(repo).digest('hex').slice(0, 12)}`;
}

/** Keep tool locations, never a snapshot of tokens or the caller's environment. */
export function servicePath(node, currentPath, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const separator = platform === 'win32' ? ';' : ':';
  const directories = [paths.dirname(node), ...currentPath.split(separator)];
  const seen = new Set();
  return directories
    .filter((directory) => {
      if (
        !paths.isAbsolute(directory) ||
        /(?:^|[\\/])node_modules[\\/]\.bin(?:[\\/]|$)/u.test(directory)
      )
        return false;
      const key = platform === 'win32' ? directory.toLowerCase() : directory;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(separator);
}

/** Runs in the same process so service stop and the process lock refer to Node itself. */
export function serviceRunnerSource(script) {
  return `import { readFile } from 'node:fs/promises';
import { runCLI } from ${JSON.stringify(pathToFileURL(script).href)};
try {
  const settings = JSON.parse(await readFile(new URL('./service-config.json', import.meta.url), 'utf8'));
  if (typeof settings.path !== 'string' || !settings.path) throw new Error('Missing tool path');
  process.env.PATH = settings.path;
  await runCLI();
} catch {
  console.error('Sync service failed. Check npm run sync:status and the local service configuration.');
  process.exitCode = 1;
}
`;
}

export function launchAgentXML({ label, repo, metadata, node, script }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(script)}</string><string>--watch</string></array>
  <key>WorkingDirectory</key><string>${xml(repo)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(path.join(metadata, 'stdout.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(metadata, 'stderr.log'))}</string>
</dict></plist>
`;
}

export function windowsTaskScript({ label, repo, node, script, uninstall }) {
  const header = `$ErrorActionPreference = 'Stop'\n$taskName = ${ps(label)}\n`;
  if (uninstall)
    return `${header}
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
`;
  return `${header}
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute ${ps(node)} -Argument ${ps(`${windowsArgument(script)} --watch`)} -WorkingDirectory ${ps(repo)}
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--uninstall')) {
    throw new Error('Usage: node scripts/install-sync.mjs [--uninstall]');
  }
  const uninstall = args[0] === '--uninstall';
  const { repo, metadata } = await repositoryPaths();
  const label = installationID(repo);
  const node = process.execPath;
  const script = path.join(repo, 'scripts', 'git-sync.mjs');
  const serviceRunner = path.join(metadata, 'service-runner.mjs');
  await mkdir(metadata, { recursive: true, mode: 0o700 });
  if (!uninstall) {
    const npmCLI = await findNpmCLI();
    await writeFile(
      path.join(metadata, 'service-config.json'),
      `${JSON.stringify({ npmCLI, node, path: servicePath(node, process.env.PATH || '') }, null, 2)}\n`,
      { mode: 0o600 },
    );
    await writeFile(serviceRunner, serviceRunnerSource(script), { mode: 0o600 });
  }
  if (process.platform === 'darwin') {
    const directory = path.join(os.homedir(), 'Library', 'LaunchAgents');
    const plist = path.join(directory, `${label}.plist`);
    const domain = `gui/${process.getuid()}`;
    await command('launchctl', ['bootout', `${domain}/${label}`], repo, { allowFailure: true });
    if (uninstall) {
      await rm(plist, { force: true });
    } else {
      await mkdir(directory, { recursive: true });
      await writeFile(
        plist,
        launchAgentXML({ label, repo, metadata, node, script: serviceRunner }),
        {
          mode: 0o600,
        },
      );
      await command('launchctl', ['bootstrap', domain, plist], repo);
    }
  } else if (process.platform === 'win32') {
    const encoded = Buffer.from(
      windowsTaskScript({ label, repo, node, script: serviceRunner, uninstall }),
      'utf16le',
    ).toString('base64');
    const powershell = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    await command(
      powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      repo,
    );
  } else {
    throw new Error(
      'Automatic login sync supports macOS and Windows. Run npm run sync:watch manually on this platform.',
    );
  }
  console.log(
    uninstall
      ? 'Login sync was removed. Repository changes, Git history, and local sync logs were preserved.'
      : 'Login sync is installed and starting. Use npm run sync:status to check it; npm run sync:uninstall removes it.',
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
