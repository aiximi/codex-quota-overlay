import { PLATFORMS, REPO_URL, latestPlatforms } from './model.mjs';

export const START = '<!-- downloads:start -->';
export const END = '<!-- downloads:end -->';
const BLOB = REPO_URL + '/blob/main/';
const labels = {
  zh: { setup: '下载安装版', portable: '便携版 EXE', dmg: '下载安装版 DMG', zip: '压缩包 ZIP' },
  en: {
    setup: 'Download installer',
    portable: 'Portable EXE',
    dmg: 'Download DMG',
    zip: 'ZIP archive',
  },
};
const link = (label, url) => '[' + label + '](' + url + ')';
const date = (value) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));

export function latestTable(catalog, language = 'zh') {
  const english = language === 'en';
  const lines = [
    english
      ? '| System | Latest stable | Recommended | Alternative | Changes |'
      : '| 你的系统 | 最新稳定版 | 推荐下载 | 其他格式 | 更新说明 |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const { platform, release, files } of latestPlatforms(catalog)) {
    const [first, second] = platform.kinds;
    lines.push(
      '| ' +
        [
          platform[language],
          '**' + release.version + '**',
          link(labels[language][first], files[first].url),
          link(labels[language][second], files[second].url),
          link(english ? 'Release notes' : '查看变化', BLOB + release.notes),
        ].join(' | ') +
        ' |',
    );
  }
  return lines.join('\n');
}

export function replaceDownloadBlock(text, catalog, language = 'zh') {
  if (
    text.split(START).length !== 2 ||
    text.split(END).length !== 2 ||
    text.indexOf(END) < text.indexOf(START)
  ) {
    throw new Error('README must have exactly one correctly ordered downloads block.');
  }
  const prefix = text.slice(0, text.indexOf(START));
  const suffix = text.slice(text.indexOf(END) + END.length);
  return prefix + START + '\n\n' + latestTable(catalog, language) + '\n\n' + END + suffix;
}

export function releaseChanges(notes, tag) {
  const sections = notes.split(/^## 更新内容[ \t]*$/m);
  const section = sections[1]?.split(/^## /m)[0]?.trim();
  if (sections.length !== 2 || !section || !/^- /m.test(section))
    throw new Error('Missing concrete change list in notes for ' + tag);
  // Preserve wrapped lines and nested conditions. Links move with their source notes.
  const absolute = (target) => new URL(target, BLOB + 'docs/releases/' + tag + '.md').href;
  return section
    .replace(
      /(!?\[[^\]\n]*\]\()([^\s)]+)(\))/g,
      (_, prefix, target, suffix) => prefix + absolute(target) + suffix,
    )
    .replace(
      /^([ \t]{0,3}\[[^\]\n]+\]:[ \t]*)([^\s]+)/gm,
      (_, prefix, target) => prefix + absolute(target),
    );
}

export function replaceReleaseNavigation(body, catalog) {
  const start = '<!-- download-navigation:start -->';
  const end = '<!-- download-navigation:end -->';
  const block = [
    start,
    '',
    '## 各系统最新稳定版 / Latest stable downloads',
    '',
    latestTable(catalog),
    '',
    link('统一下载中心 / All downloads', BLOB + 'DOWNLOADS.md') +
      ' · ' +
      link('历史版本与变化 / Version history', BLOB + 'docs/VERSIONS.md'),
    '',
    '以下是本次发行的更新记录；页面下方 Assets 仅列本次发行文件。其他系统请使用上表的下载链接。',
    'The notes and Assets below belong to this release; use the table above for each system’s latest version.',
    '',
    end,
  ].join('\n');
  if (!body.includes(start) && !body.includes(end)) return block + '\n\n' + body;
  if (
    body.split(start).length !== 2 ||
    body.split(end).length !== 2 ||
    body.indexOf(end) < body.indexOf(start)
  ) {
    throw new Error('Malformed release navigation markers; existing notes were preserved.');
  }
  return body.slice(0, body.indexOf(start)) + block + body.slice(body.indexOf(end) + end.length);
}

export function renderDownloads(catalog) {
  const checksums = latestPlatforms(catalog).map(
    ({ platform, release }) =>
      '| ' +
      platform.zh +
      ' | ' +
      release.version +
      ' | ' +
      link('SHA-256 校验文件', release.checksum.url) +
      ' | ' +
      link('原始发布页', release.url) +
      ' |',
  );
  return [
    '# 下载 Codex Quota Overlay',
    '',
    link('项目首页', 'README.md') +
      ' · ' +
      link('所有历史版本与更新记录', 'docs/VERSIONS.md') +
      ' · ' +
      link('安装与故障排查', 'docs/USAGE.md') +
      ' · ' +
      link('English', 'README.en.md'),
    '',
    '## 选择你的系统',
    '',
    '这里同时列出每个系统已经发布的最新稳定版。Windows 和 Mac 可以分别升级，版本号不同是正常的；只需下载自己系统所在行的文件。',
    '',
    latestTable(catalog),
    '',
    '- **Windows**：通常选择安装版，可在向导中选择 C、D、E 等有写权限的盘符；便携版无需安装。',
    '- **Mac Apple Silicon**：适用于 M 系列芯片；通常选择 DMG。',
    '- **Mac Intel**：适用于 Intel 芯片。可在苹果菜单 → 关于本机中查看芯片或处理器。',
    '- **Mac ZIP**：同一版本应用的压缩包，解压后把应用移动到 Applications；无需同时下载 DMG 和 ZIP。',
    '',
    '## 安装和升级',
    '',
    '1. 安装并登录官方 Codex。',
    '2. 升级前从菜单栏或托盘退出旧版浮层，下载对应系统的安装包。',
    '3. Windows 按向导安装；Mac 打开 DMG，将应用拖入 Applications。',
    '4. 启动浮层，切换到 Codex。完整操作见 ' + link('使用说明', 'docs/USAGE.md') + '。',
    '',
    '当前发行包尚未完成 Windows 正式代码签名或 Apple Developer ID 公证。首次运行的系统提示及处理方式见安装说明。',
    '',
    '## 校验下载文件',
    '',
    '| 系统 | 版本 | 校验文件 | 发布来源 |',
    '| --- | --- | --- | --- |',
    ...checksums,
    '',
    '请使用文件所在发行版本的校验表。Windows 与 Mac 最新版本不同时，不要混用不同发行的校验表。',
    '',
    '## 需要旧版本？',
    '',
    link('打开历史版本与更新记录 →', 'docs/VERSIONS.md') +
      '：按系统查找旧版安装包、发行日期和每次具体变化。旧版文件与原始下载地址保留。',
    '',
    'GitHub 的 Latest 标签表示最近一次发行，可能只更新某个系统。本页根据各系统真实安装包选择最新稳定版，作为统一下载入口。',
    '',
    '<!-- Generated from docs/releases/catalog.json. Edit release notes, not this page. -->',
    '',
  ].join('\n');
}

export function renderVersions(catalog, notes) {
  const lines = [
    '# 历史版本与更新记录',
    '',
    link('下载各系统最新版', '../DOWNLOADS.md') + ' · ' + link('项目首页', '../README.md'),
    '',
    '每个系统独立列出已发布版本，最新版本排在前面。发布日期按北京时间（UTC+8）显示。旧版供回退和兼容性排查，已知修复请查看对应版本说明。',
    '',
  ];
  const latest = latestPlatforms(catalog);
  for (const platform of PLATFORMS) {
    lines.push(
      '## ' + platform.zh,
      '',
      '| 版本 | 发布日期 | 下载 | 变化与校验 |',
      '| --- | --- | --- | --- |',
    );
    for (const release of catalog.releases) {
      const build = release.platforms.find(({ id }) => id === platform.id);
      if (!build) continue;
      const current =
        latest.find(({ platform: item }) => item.id === platform.id).release.tag === release.tag;
      const files = platform.kinds
        .map((kind) => link(labels.zh[kind], build.files[kind].url))
        .join(' · ');
      lines.push(
        '| ' +
          [
            release.version + (current ? ' **当前最新版**' : ''),
            date(release.publishedAt),
            files,
            link('更新说明', BLOB + release.notes) + ' · ' + link('SHA-256', release.checksum.url),
          ].join(' | ') +
          ' |',
      );
    }
    lines.push('');
  }
  lines.push('## 每次发行具体改了什么', '');
  for (const release of catalog.releases) {
    const systems = release.platforms
      .map(({ id }) => PLATFORMS.find((item) => item.id === id).zh)
      .join('、');
    lines.push(
      '### ' + release.version + ' · ' + systems,
      '',
      '**发布日期：' +
        date(release.publishedAt) +
        '** · ' +
        link('完整更新说明', BLOB + release.notes) +
        ' · ' +
        link('原始发行与全部附件', release.url),
      '',
      releaseChanges(notes.get(release.tag), release.tag),
      '',
    );
  }
  lines.push(
    '## 历史版本保留规则',
    '',
    '- 已公开的版本标签、安装包和下载地址保留；修复通过新版本发布。',
    '- 单系统更新只推进对应系统的最新版本，其他系统继续显示各自的最新稳定版。',
    '- 草稿和预发行版本不进入稳定版下载推荐；GitHub 自动生成的 Source code 文件是源码，不是安装包。',
    '- 本页展示公开发行的桌面安装包。早期仅本地使用的原型未公开分发，不提供下载。',
    '',
    '<!-- Generated from docs/releases/catalog.json and versioned release notes. -->',
    '',
  );
  return lines.join('\n');
}
