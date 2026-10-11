import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { resolve } from 'node:path';
import electron from 'electron';

const root = resolve(import.meta.dirname, '..');
let child;
let rebuilding = false;
let queued = false;
let timer;
async function rebuild() {
  if (rebuilding) {
    queued = true;
    return;
  }
  rebuilding = true;
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((done) => child.once('exit', done));
  }
  const builder = spawn(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'inherit' });
  const code = await new Promise((done) => builder.once('exit', done));
  if (code === 0) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(electron, ['.', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', env });
  }
  rebuilding = false;
  if (queued) {
    queued = false;
    await rebuild();
  }
}
for (const folder of ['src', 'native']) {
  watch(resolve(root, folder), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), 650);
  });
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    child?.kill();
    process.exit();
  });
await rebuild();
