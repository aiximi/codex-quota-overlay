import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
mkdirSync(resolve(root, 'build/native/windows'), { recursive: true });
copyFileSync(
  resolve(root, 'native/windows/WindowTracker.ps1'),
  resolve(root, 'build/native/windows/WindowTracker.ps1'),
);
if (process.platform === 'darwin') {
  const arch = process.env.QUOTA_TARGET_ARCH || process.arch;
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Unsupported macOS architecture');
  const target = arch === 'x64' ? 'x86_64' : 'arm64';
  mkdirSync(resolve(root, 'build/native/macos'), { recursive: true });
  const result = spawnSync(
    'xcrun',
    [
      'swiftc',
      '-O',
      '-swift-version',
      '5',
      '-target',
      `${target}-apple-macosx12.0`,
      resolve(root, 'native/macos/WindowTracker.swift'),
      '-o',
      resolve(root, 'build/native/macos/window-tracker'),
      '-framework',
      'AppKit',
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0)
    throw new Error(
      'Native helper build failed. Install Xcode Command Line Tools with xcode-select --install.',
    );
}
