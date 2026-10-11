#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fetchCatalog, gh } from './catalog.mjs';
import { REPOSITORY, validateCatalog } from './model.mjs';
import { replaceReleaseNavigation } from './render.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--apply', '--check'].includes(args[0])) {
    throw new Error('Usage: node scripts/releases/navigation.mjs --check | --apply');
  }
  const catalog = validateCatalog(
    JSON.parse(
      await readFile(new URL('../../docs/releases/catalog.json', import.meta.url), 'utf8'),
    ),
  );
  const live = await fetchCatalog();
  if (JSON.stringify(live) !== JSON.stringify(catalog)) {
    throw new Error(
      'Public releases changed. Refresh and publish the download catalog before updating navigation.',
    );
  }
  const updates = [];
  for (const release of catalog.releases) {
    const current = JSON.parse(
      await gh(['api', 'repos/' + REPOSITORY + '/releases/tags/' + release.tag]),
    );
    if (current.draft || current.prerelease || current.tag_name !== release.tag) {
      throw new Error('Release state changed; refresh the catalog.');
    }
    const body = replaceReleaseNavigation(current.body ?? '', catalog);
    if (body !== current.body) updates.push({ tag: release.tag, body });
  }
  if (args[0] === '--check') {
    if (updates.length)
      throw new Error(
        'Release navigation needs updating: ' + updates.map(({ tag }) => tag).join(', '),
      );
    console.log('Release navigation is up to date.');
    return;
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'quota-release-navigation-'));
  try {
    for (const { tag, body } of updates) {
      const file = path.join(temporary, tag + '.md');
      await writeFile(file, body);
      // Only the body changes. Tags, titles, original notes and binary assets remain intact.
      await gh(['release', 'edit', tag, '--repo', REPOSITORY, '--notes-file', file]);
      console.log('Updated cross-platform navigation: ' + tag);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  if (!updates.length) console.log('Release navigation already up to date.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
