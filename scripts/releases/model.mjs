export const REPOSITORY = 'aiximi/codex-quota-overlay';
export const REPO_URL = 'https://github.com/' + REPOSITORY;
export const PLATFORMS = [
  {
    id: 'windows-x64',
    zh: 'Windows 10/11 · x64',
    en: 'Windows 10/11 · x64',
    kinds: ['setup', 'portable'],
  },
  {
    id: 'mac-arm64',
    zh: 'macOS 13+ · Apple Silicon',
    en: 'macOS 13+ · Apple Silicon',
    kinds: ['dmg', 'zip'],
  },
  { id: 'mac-x64', zh: 'macOS 13+ · Intel', en: 'macOS 13+ · Intel', kinds: ['dmg', 'zip'] },
];
const NUMBER = '(0|[1-9][0-9]*)';
const TAG = new RegExp(
  '^(?:(windows|macos)-)?v(' + NUMBER + '\\.' + NUMBER + '\\.' + NUMBER + ')$',
);
const ASSET =
  /^Codex-Quota-Overlay-(\d+\.\d+\.\d+)-(windows-x64-(setup|portable)\.exe|mac-(arm64|x64)\.(dmg|zip))$/;

export function parseTag(tag) {
  const match = typeof tag === 'string' ? TAG.exec(tag) : null;
  if (!match) return null;
  const version = match[2];
  if (version.split('.').some((part) => !Number.isSafeInteger(Number(part)))) return null;
  return { version, scope: match[1] ?? 'all' };
}

export function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function parseChecksums(contents) {
  const sums = new Map();
  for (const line of contents.trim().split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})[ \t]+\*?([^/\\\r\n]+)$/.exec(line);
    if (!match || sums.has(match[2])) throw new Error('Invalid or duplicate checksum entry.');
    sums.set(match[2], match[1].toLowerCase());
  }
  return sums;
}

export function publicReleases(items) {
  if (!Array.isArray(items)) throw new Error('GitHub did not return a release list.');
  return items.filter((item) => !item.draft && !item.prerelease && parseTag(item.tag_name));
}

function downloadAsset(asset, tag) {
  const expected =
    REPO_URL +
    '/releases/download/' +
    encodeURIComponent(tag) +
    '/' +
    encodeURIComponent(asset.name);
  if (
    asset.browser_download_url !== expected ||
    asset.state !== 'uploaded' ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0
  ) {
    throw new Error('Invalid or incomplete published asset: ' + tag + '/' + asset.name);
  }
  return { name: asset.name, url: asset.browser_download_url, size: asset.size };
}

// Only complete, checksummed platform pairs can become a download recommendation.
export function createCatalog(items, checksums) {
  const seen = new Set();
  const releases = publicReleases(items).map((item) => {
    const tag = item.tag_name;
    const { version, scope } = parseTag(tag);
    if (seen.has(tag)) throw new Error('Duplicate release tag: ' + tag);
    seen.add(tag);
    if (
      item.html_url !== REPO_URL + '/releases/tag/' + tag ||
      !Number.isFinite(Date.parse(item.published_at)) ||
      !Array.isArray(item.assets)
    ) {
      throw new Error('Invalid release metadata: ' + tag);
    }
    const checksumAssets = item.assets.filter((asset) => asset.name === 'SHA256SUMS.txt');
    if (checksumAssets.length !== 1 || !checksums.has(tag)) {
      throw new Error('Missing unique checksums for ' + tag);
    }
    const checksum = downloadAsset(checksumAssets[0], tag);
    const sums = parseChecksums(checksums.get(tag));
    const grouped = new Map();
    const names = new Set();
    for (const asset of item.assets) {
      const match = ASSET.exec(asset.name);
      if (!match) continue;
      if (names.has(asset.name) || match[1] !== version) {
        throw new Error('Duplicate or mismatched package version in ' + tag);
      }
      names.add(asset.name);
      const platform = match[3] ? 'windows-x64' : 'mac-' + match[4];
      const kind = match[3] ?? match[5];
      if (
        (scope === 'windows' && platform !== 'windows-x64') ||
        (scope === 'macos' && !platform.startsWith('mac-'))
      ) {
        throw new Error('Package does not match release platform: ' + tag);
      }
      const record = downloadAsset(asset, tag);
      const sha256 = sums.get(asset.name);
      if (!sha256 || (asset.digest && asset.digest !== 'sha256:' + sha256)) {
        throw new Error('Published checksums disagree for ' + asset.name);
      }
      const files = grouped.get(platform) ?? {};
      files[kind] = { ...record, sha256 };
      grouped.set(platform, files);
    }
    const platforms = PLATFORMS.filter(({ id }) => grouped.has(id)).map(({ id, kinds }) => {
      const files = grouped.get(id);
      if (kinds.some((kind) => !files[kind]))
        throw new Error('Incomplete platform packages in ' + tag);
      return { id, files: Object.fromEntries(kinds.map((kind) => [kind, files[kind]])) };
    });
    if (platforms.length === 0) throw new Error('Release contains no supported packages: ' + tag);
    return {
      tag,
      version,
      publishedAt: new Date(item.published_at).toISOString(),
      url: item.html_url,
      notes: 'docs/releases/' + tag + '.md',
      checksum,
      platforms,
    };
  });
  releases.sort(
    (a, b) =>
      compareVersions(b.version, a.version) ||
      b.publishedAt.localeCompare(a.publishedAt) ||
      a.tag.localeCompare(b.tag),
  );
  if (releases.length === 0)
    throw new Error('No public stable releases found; the existing catalog was preserved.');
  return { schemaVersion: 1, repository: REPOSITORY, releases };
}

export function latestPlatforms(catalog) {
  return PLATFORMS.map((platform) => {
    const candidates = catalog.releases.filter((release) =>
      release.platforms.some(({ id }) => id === platform.id),
    );
    candidates.sort(
      (a, b) =>
        compareVersions(b.version, a.version) ||
        b.publishedAt.localeCompare(a.publishedAt) ||
        a.tag.localeCompare(b.tag),
    );
    const release = candidates[0];
    if (!release) throw new Error('No stable download available for ' + platform.id);
    return {
      platform,
      release,
      files: release.platforms.find(({ id }) => id === platform.id).files,
    };
  });
}

export function validateCatalog(catalog) {
  if (
    catalog.schemaVersion !== 1 ||
    catalog.repository !== REPOSITORY ||
    !Array.isArray(catalog.releases)
  ) {
    throw new Error('Unsupported catalog format.');
  }
  const sums = new Map();
  const raw = catalog.releases.map((release) => {
    const files = release.platforms.flatMap((platform) => Object.values(platform.files));
    sums.set(release.tag, files.map((file) => file.sha256 + '  ' + file.name).join('\n'));
    return {
      tag_name: release.tag,
      published_at: release.publishedAt,
      html_url: release.url,
      assets: [...files, release.checksum].map((file) => ({
        name: file.name,
        size: file.size,
        state: 'uploaded',
        browser_download_url: file.url,
        ...(file.sha256 ? { digest: 'sha256:' + file.sha256 } : {}),
      })),
    };
  });
  const normalized = createCatalog(raw, sums);
  if (JSON.stringify(normalized) !== JSON.stringify(catalog))
    throw new Error('Catalog is not canonical; regenerate it.');
  latestPlatforms(catalog);
  return catalog;
}
