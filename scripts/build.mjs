import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const native = spawnSync(process.execPath, ['scripts/build-native.mjs'], {
  cwd: root,
  stdio: 'inherit',
});
if (native.status !== 0) process.exit(native.status ?? 1);
await rm(resolve(root, 'dist'), { recursive: true, force: true });
await mkdir(resolve(root, 'dist/renderer'), { recursive: true });
await Promise.all([
  build({
    entryPoints: [resolve(root, 'src/main/index.ts')],
    outfile: resolve(root, 'dist/main/index.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
    sourcemap: true,
  }),
  build({
    entryPoints: [resolve(root, 'src/main/preload.ts')],
    outfile: resolve(root, 'dist/main/preload.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
    sourcemap: true,
  }),
  build({
    entryPoints: [
      resolve(root, 'src/renderer/overlay.ts'),
      resolve(root, 'src/renderer/settings.ts'),
    ],
    outdir: resolve(root, 'dist/renderer'),
    bundle: true,
    platform: 'browser',
    target: 'chrome140',
    format: 'iife',
    sourcemap: true,
  }),
]);
for (const file of ['index.html', 'settings.html', 'styles.css']) {
  await cp(resolve(root, 'src/renderer', file), resolve(root, 'dist/renderer', file));
}
console.log('Built desktop app and native window helper. No account operations performed.');
