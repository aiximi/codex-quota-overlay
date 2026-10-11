#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { format, resolveConfig } from 'prettier';
import { REPOSITORY, createCatalog, publicReleases, validateCatalog } from './model.mjs';
import {
  releaseChanges,
  renderDownloads,
  renderVersions,
  replaceDownloadBlock,
} from './render.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const snapshot = 'docs/releases/catalog.json';

export async function gh(args) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return (
        await run(process.env.GH_BIN || 'gh', args, {
          cwd: root,
          encoding: 'utf8',
          timeout: 60000,
          maxBuffer: 20 * 1024 * 1024,
        })
      ).stdout;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw new Error(
    'GitHub request failed; existing download files were preserved. ' +
      (lastError.code === 'ENOENT'
        ? 'Install GitHub CLI or set GH_BIN.'
        : 'Check network access and GitHub CLI authentication.'),
  );
}

export async function fetchCatalog() {
  const pages = JSON.parse(
    await gh(['api', '--paginate', '--slurp', 'repos/' + REPOSITORY + '/releases?per_page=100']),
  );
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error('GitHub pagination returned an unexpected format.');
  }
  const items = pages.flat();
  const checksums = new Map();
  for (const release of publicReleases(items)) {
    const contents = await gh([
      'release',
      'download',
      release.tag_name,
      '--repo',
      REPOSITORY,
      '--pattern',
      'SHA256SUMS.txt',
      '--output',
      '-',
    ]);
    checksums.set(release.tag_name, contents);
  }
  return validateCatalog(createCatalog(items, checksums));
}

export async function generateFiles(
  catalog,
  read = (file) => readFile(path.join(root, file), 'utf8'),
) {
  validateCatalog(catalog);
  const notes = new Map();
  for (const release of catalog.releases) {
    const text = await read(release.notes);
    releaseChanges(text, release.tag);
    notes.set(release.tag, text);
  }
  const raw = new Map([
    [snapshot, JSON.stringify(catalog, null, 2) + '\n'],
    ['DOWNLOADS.md', renderDownloads(catalog)],
    ['docs/VERSIONS.md', renderVersions(catalog, notes)],
    ['README.md', replaceDownloadBlock(await read('README.md'), catalog, 'zh')],
    ['README.en.md', replaceDownloadBlock(await read('README.en.md'), catalog, 'en')],
  ]);
  const config = await resolveConfig(path.join(root, 'package.json'));
  const formatted = new Map();
  for (const [file, contents] of raw) {
    formatted.set(file, await format(contents, { ...config, filepath: file }));
  }
  return formatted;
}

async function main() {
  const args = process.argv.slice(2);
  if (
    args.some((arg) => !['--fetch', '--check'].includes(arg)) ||
    (args.includes('--fetch') && args.includes('--check'))
  ) {
    throw new Error('Usage: node scripts/releases/catalog.mjs [--fetch | --check]');
  }
  const catalog = args.includes('--fetch')
    ? await fetchCatalog()
    : validateCatalog(JSON.parse(await readFile(path.join(root, snapshot), 'utf8')));
  // Finish all network requests, validation and rendering before changing any file.
  const files = await generateFiles(catalog);
  const changed = [];
  for (const [file, contents] of files) {
    let previous;
    try {
      previous = await readFile(path.join(root, file), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (previous !== contents) changed.push(file);
  }
  if (args.includes('--check')) {
    if (changed.length)
      throw new Error(
        'Download catalog is stale: ' + changed.join(', ') + '. Run npm run releases:generate.',
      );
    console.log('Download catalog and per-platform latest versions are consistent.');
    return;
  }
  for (const file of changed) await writeFile(path.join(root, file), files.get(file));
  console.log(
    changed.length ? 'Updated: ' + changed.join(', ') : 'Download catalog already up to date.',
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
