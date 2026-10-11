import assert from 'node:assert/strict';
import test from 'node:test';
import { generateFiles } from '../../scripts/releases/catalog.mjs';
import {
  REPO_URL,
  createCatalog,
  latestPlatforms,
  parseTag,
  validateCatalog,
} from '../../scripts/releases/model.mjs';
import {
  END,
  START,
  releaseChanges,
  renderVersions,
  replaceDownloadBlock,
  replaceReleaseNavigation,
} from '../../scripts/releases/render.mjs';

function fixture(tag, platforms = ['windows-x64', 'mac-arm64', 'mac-x64']) {
  const { version } = parseTag(tag);
  const sha = 'a'.repeat(64);
  const names = platforms.flatMap((platform) =>
    platform === 'windows-x64'
      ? ['setup', 'portable'].map(
          (kind) => 'Codex-Quota-Overlay-' + version + '-' + platform + '-' + kind + '.exe',
        )
      : ['dmg', 'zip'].map(
          (kind) => 'Codex-Quota-Overlay-' + version + '-' + platform + '.' + kind,
        ),
  );
  const sum = names.map((name) => sha + '  ' + name).join('\n');
  const item = {
    tag_name: tag,
    html_url: REPO_URL + '/releases/tag/' + tag,
    published_at: '2026-10-11T16:24:54Z',
    draft: false,
    prerelease: false,
    assets: [...names, 'SHA256SUMS.txt'].map((name) => ({
      name,
      size: 1000000,
      state: 'uploaded',
      browser_download_url: REPO_URL + '/releases/download/' + tag + '/' + name,
      ...(name === 'SHA256SUMS.txt' ? {} : { digest: 'sha256:' + sha }),
    })),
  };
  return { item, sum };
}
function catalogFrom(...fixtures) {
  return createCatalog(
    fixtures.map(({ item }) => item),
    new Map(fixtures.map(({ item, sum }) => [item.tag_name, sum])),
  );
}
function examples() {
  return catalogFrom(fixture('v2.0.0'), fixture('windows-v2.0.1', ['windows-x64']));
}
const note =
  '# Release\n\n## 更新内容\n\n- Fixed native click handling.\n\n- Fixed CLI discovery.\n\n## 升级\n\n- Quit the old app.\n';

test('history preserves wrapped change details and resolves links from the version note', () => {
  const contents =
    '# Version\n\n## 更新内容\n\n- Fixed input.\n  Only on Windows.\n  - Keep this condition.\n  See [guide](../USAGE.md#install).\n\n[details]: ../../DOWNLOADS.md\n\n## 升级\nDo not include.\n';
  const changes = releaseChanges(contents, 'windows-v2.0.1');
  assert.ok(changes.includes('  Only on Windows.\n  - Keep this condition.'));
  assert.ok(changes.includes(REPO_URL + '/blob/main/docs/USAGE.md#install'));
  assert.ok(changes.includes('[details]: ' + REPO_URL + '/blob/main/DOWNLOADS.md'));
  assert.ok(!changes.includes('Do not include.'));
});

test('every release can show both systems while its original notes remain unchanged', () => {
  const original = '# Windows 2.0.1\n\nOriginal change details and source commit.\n';
  const body = replaceReleaseNavigation(original, examples());
  assert.equal(replaceReleaseNavigation(body, examples()), body);
  assert.ok(body.endsWith(original));
  assert.ok(body.includes('2.0.1-windows-x64-setup.exe'));
  assert.ok(body.includes('2.0.0-mac-arm64.dmg'));
  assert.ok(body.includes('2.0.0-mac-x64.dmg'));
  assert.throws(
    () => replaceReleaseNavigation('<!-- download-navigation:start -->', examples()),
    /preserved/,
  );
});

test('a Windows-only patch keeps both Mac builds visible and every historical package', () => {
  const catalog = examples();
  assert.deepEqual(
    latestPlatforms(catalog).map(({ platform, release }) => [platform.id, release.version]),
    [
      ['windows-x64', '2.0.1'],
      ['mac-arm64', '2.0.0'],
      ['mac-x64', '2.0.0'],
    ],
  );
  assert.equal(catalog.releases.length, 2);
  assert.equal(
    catalog.releases.flatMap(({ platforms }) =>
      platforms.flatMap(({ files }) => Object.values(files)),
    ).length,
    8,
  );
  assert.deepEqual(validateCatalog(JSON.parse(JSON.stringify(catalog))), catalog);
  const history = renderVersions(catalog, new Map(catalog.releases.map(({ tag }) => [tag, note])));
  assert.ok(history.includes('2026-10-12'));
  assert.ok(history.includes('Codex-Quota-Overlay-2.0.0-windows-x64-setup.exe'));
  assert.ok(history.includes('Codex-Quota-Overlay-2.0.1-windows-x64-setup.exe'));
  assert.ok(history.includes('Fixed native click handling.'));
  assert.ok(!history.includes('Quit the old app.'));
});

test('latest is selected by numeric version per platform, not API order, time or a global tag', () => {
  const releases = [
    fixture('windows-v2.0.9', ['windows-x64']),
    fixture('windows-v2.0.10', ['windows-x64']),
    fixture('v2.0.0'),
  ];
  releases[1].item.published_at = '2026-10-01T01:00:00Z';
  for (const ordered of [releases, releases.toReversed()]) {
    assert.equal(latestPlatforms(catalogFrom(...ordered))[0].release.version, '2.0.10');
  }
});

test('drafts and prereleases do not replace a stable download', () => {
  const draft = fixture('windows-v9.0.0', ['windows-x64']);
  const preview = fixture('windows-v8.0.0', ['windows-x64']);
  draft.item.draft = true;
  preview.item.prerelease = true;
  const catalog = catalogFrom(draft, fixture('v2.0.0'), preview);
  assert.equal(catalog.releases.length, 1);
  assert.equal(latestPlatforms(catalog)[0].release.version, '2.0.0');
});

test('bad uploads, missing formats, mismatched versions and checksums fail closed', () => {
  const mutations = [
    ({ item }) => item.assets.pop(),
    ({ item }) => item.assets.splice(0, 1),
    ({ item }) => {
      item.assets[0].state = 'new';
    },
    ({ item }) => {
      item.assets[0].size = 0;
    },
    ({ item }) => {
      item.assets[0].digest = 'sha256:' + 'b'.repeat(64);
    },
    ({ item }) => {
      item.assets[0].browser_download_url = 'https://example.invalid/download.exe';
    },
    ({ item }) => {
      item.assets[0].name = item.assets[0].name.replace('2.0.0', '2.0.1');
    },
    ({ item }) => item.assets.push({ ...item.assets[0] }),
    (value) => {
      value.sum = value.sum.split('\n').slice(1).join('\n');
    },
  ];
  for (const mutate of mutations) {
    const value = fixture('v2.0.0');
    mutate(value);
    assert.throws(() => catalogFrom(value));
  }
  assert.throws(() => createCatalog([], new Map()), /preserved/);
  assert.throws(() => catalogFrom(fixture('windows-v2.0.1')), /platform/);
});

test('version notes and README markers are required; human content survives regeneration', async () => {
  const catalog = examples();
  const original =
    'Human introduction.\n\n' + START + '\nold block\n' + END + '\n\nHuman instructions.\n';
  const once = replaceDownloadBlock(original, catalog);
  assert.equal(replaceDownloadBlock(once, catalog), once);
  assert.ok(once.startsWith('Human introduction.'));
  assert.ok(once.endsWith('Human instructions.\n'));
  assert.ok(!once.includes('/releases/latest'));
  assert.throws(() => replaceDownloadBlock(START + END + START, catalog), /exactly one/);
  assert.throws(() => releaseChanges('No real change notes.', 'v2.0.0'), /Missing/);
  const read = async (name) => (name.startsWith('README') ? original : note);
  const files = await generateFiles(catalog, read);
  const rerun = await generateFiles(catalog, async (name) => files.get(name) ?? read(name));
  assert.deepEqual(files, rerun);
  assert.equal(files.size, 5);
  assert.ok(files.get('README.en.md').includes('Download installer'));
  const malformed = structuredClone(catalog);
  malformed.releases[0].platforms[0].files.setup.sha256 = 'not a hash';
  assert.throws(() => validateCatalog(malformed));
});
