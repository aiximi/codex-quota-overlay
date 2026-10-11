# 发布维护 / Releasing

## 统一下载入口与独立版本

用户始终从 [DOWNLOADS.md](../DOWNLOADS.md) 选择安装包，从 [VERSIONS.md](VERSIONS.md) 查看历史版本。目录分别按平台、架构选择最新稳定版；一次 Windows 更新不会使 macOS 下载入口消失，也不会要求 macOS 跟随更改版本。GitHub 仓库只能显示一个 “Latest” 发布标记，它不是本项目的全平台下载入口。

| 发布范围 | 标签             | 对应的版本说明                    |
| -------- | ---------------- | --------------------------------- |
| 全平台   | `vX.Y.Z`         | `docs/releases/vX.Y.Z.md`         |
| Windows  | `windows-vX.Y.Z` | `docs/releases/windows-vX.Y.Z.md` |

当前源码 `package.json` 的基线版本为 `2.0.0`，macOS 发布版本为 `2.0.0`；Windows 已独立发布 `2.0.1`。Windows 工作流使用 electron-builder 的 `extraMetadata.version` 覆盖包内版本和文件名，源码基线并未因此变成 `2.0.1`。核对发行包时，应同时记录平台、版本、标签及源码提交。

已发布的标签、安装包和 `SHA256SUMS.txt` 不得移动、删除后替换或覆盖。修复安装包必须发布新版本。旧版本继续保留在版本记录中；修改说明文字不能改变安装包内容或虚构旧版本包含的新功能。

## 准备版本说明

发布前在批准构建的源码提交中加入 `docs/releases/<完整标签>.md`，不要复用通用的旧 `docs/RELEASE-NOTES.md`。说明必须包含 `## 更新内容` 小节，并用一级 `- ` 列表逐项描述具体变化；目录生成器会将它们汇入版本历史。另需说明适用系统、已完成验证和仍存在的限制。签名状态必须与真实文件一致。

每份说明必须包含以下两个稳定地址，工作流会检查它们：

- [统一下载入口](https://github.com/aiximi/codex-quota-overlay/blob/main/DOWNLOADS.md)
- [历史版本记录](https://github.com/aiximi/codex-quota-overlay/blob/main/docs/VERSIONS.md)

不要把另一个平台的某个旧版本写成永久下载入口。通用导航链接使用上述目录，描述当前版本自身的安装包时可以使用其专属发布页。历史说明文件由维护者编写，不由目录生成器改写。

## Windows 独立发布

1. 完成 Windows 变更和版本说明；运行 `npm run check`、`npm run test:ui`。确认没有使用真实额度进行重置测试。
2. 将审阅后的源码合并到默认分支，记录完整的 40 位提交 SHA。所选提交必须包含 `docs/releases/windows-vX.Y.Z.md` 及本次发布需要的实现；后来补交的说明不会自动进入旧 SHA。
3. 从默认分支运行 Actions 的 **Publish Windows release**，填写新的数字版本号 `X.Y.Z` 和完整 `source_ref`。不能复用已经公开的版本。
4. 工作流核对源码 SHA 和说明，执行检查、离线 UI 测试、安装包构建，并验证目录选择、自定义路径安装、离线启动及卸载。
5. 工作流先建立草稿，校验安装器、便携版及校验和资产的大小和 GitHub SHA-256 摘要，全部通过后才公开。发布页会记录真实源码提交。

现有草稿必须指向相同源码。只有字节、大小及摘要一致的草稿资产才能直接复用；已有资产不同、重复或出现意外文件时会停止，留给维护者核查。工作流不会自动删除或覆盖资产。已经公开的 Release 会直接拒绝再次发布。

Windows 独立发布可以成为 GitHub 最近一次发行的 “Latest”。该发行正文顶部仍会通过自动导航同时显示 Windows 与 macOS 的最新下载；各系统推荐版本以统一目录为准。

## 全平台发布

1. 更新 `package.json`、`package-lock.json` 和变更记录，并新增 `docs/releases/vX.Y.Z.md`。先执行 `npm run check` 和 `npm run test:ui`。
2. 提交、审阅并合并这些变更后，在对应提交创建新的 `vX.Y.Z` 标签，再推送默认分支和该标签。不要重新指向已有标签。
3. **Build and test** 分别在 macOS arm64、macOS x64 和 Windows x64 执行验证及打包。全部成功后，发行任务再次确认 `package.json` 版本与标签一致、说明文件存在且包含统一入口链接。
4. 发行任务生成 `SHA256SUMS.txt`，使用该标签自己的说明创建公开 Release。若同名 Release 已存在，创建操作失败，不替换旧文件。

同一数值版本可分别存在于全平台标签和平台标签下；目录按每个平台、架构的有效版本和发行数据选择下载项。维护者应避免为同一个平台、架构发布含义不同的同版本包，修复时递增版本。

## 目录更新与检查

**Update download catalog** 在稳定 Release 发布或编辑后运行，也会在 **Publish Windows release** 或 **Build and test** 完成后运行。后者补足使用 `GITHUB_TOKEN` 创建 Release 时不会再次触发普通 Release 工作流事件的情况。即使打包工作流在发布后的证据上传环节失败，目录仍会查询实际公开的发行记录；没有新发行时生成结果不变。

目录任务始终检出默认分支，运行该分支上的生成器。对于 `workflow_run` 事件，仅接受本仓库的 push 或手动运行，并验证触发提交是默认分支的祖先。它不会执行 PR、分叉仓库或触发任务下载产物中的代码。

生成器读取并核对公开稳定发行记录与校验信息，只更新以下五个文件：

- `DOWNLOADS.md`
- `docs/VERSIONS.md`
- `docs/releases/catalog.json`
- `README.md` 的 `downloads:start` / `downloads:end` 区域
- `README.en.md` 的同名区域

本地检查使用 Node.js 22.12+；从网络刷新时还需要已配置的 GitHub CLI。普通下载用户不需要登录 GitHub。

```sh
# 从仓库内快照重新生成，无需网络。
node scripts/releases/catalog.mjs

# 验证生成物与快照一致，不修改文件。
node scripts/releases/catalog.mjs --check

# 读取公开 Releases，验证后刷新快照与目录。
node scripts/releases/catalog.mjs --fetch
```

不要手工修改生成区域来加入未经验证的下载链接。API 或校验失败时应解决原始错误并重试，不能以空列表代替历史记录。自动任务执行格式检查、离线校验和第二次生成的一致性检查；只有五个允许文件能被提交。

目录任务共用并发组，普通推送前会重新读取远程默认分支。如果维护者同时推送了其他修改，任务会停止并保留远程内容；从新的默认分支手动重跑 **Update download catalog**，或等待下一次构建完成触发。任务不会强推、重置或把生成内容合并覆盖现有修改。若仓库保护规则禁止机器人直接写默认分支，应由维护者审阅并合入同样的五个文件，不能绕过分支保护。

目录提交不会触发新的一轮打包：这五个文件是主分支 push 的精确排除项，PR 检查及包含任何其他文件的提交仍正常运行。

目录文件成功推送或确认没有变化后，任务再执行 `node scripts/releases/navigation.mjs --apply`，更新每个公开稳定 Release 正文顶部的受标记导航区域。导航显示各平台最新安装包，并链接统一下载入口和版本记录，因此从 GitHub 的 “Latest” 页面进入也能找到全部平台。此操作仅维护顶部导航，保留原有版本说明、附件、校验和及标签；目录推送失败时不会提前改动发布页导航。

## 验证公开 Windows 安装包

在 Actions 运行 **Verify published Windows installer**，可填写 `v2.0.0` 或 `windows-v2.0.1` 等标签。任务下载指定发布页的安装器和 `SHA256SUMS.txt`，校验后在隔离的 Windows runner 中完成实际安装、启动、卸载验证，并保存截图等证据。

此验证不访问真实 Codex 账号，不使用真实重置，也不会关闭 SmartScreen、Defender 或修改全局防护策略。通过 CI 不代表文件获得 SmartScreen 下载信誉；证书配置和签名限制见 [Windows 代码签名指南](WINDOWS-SIGNING.md)。证书、密码和令牌只能使用受控的 Secrets，不能提交进源码或版本说明。

## English

Use [Downloads](../DOWNLOADS.md) as the permanent entry point and [Version history](VERSIONS.md) for older packages. Each platform and architecture selects its own latest stable version. GitHub's single “Latest” badge is not the cross-platform catalog. The source baseline is currently `2.0.0`; Windows `2.0.1` was released independently using a packaging metadata override.

Full releases use `vX.Y.Z`, with a matching `package.json` version. Windows releases use `windows-vX.Y.Z` and the **Publish Windows release** workflow, with a new numeric version and an approved full source commit SHA from the default branch. Before publishing, that exact source must contain `docs/releases/<tag>.md` with the two permanent GitHub links to `DOWNLOADS.md` and `docs/VERSIONS.md`. Include a `## 更新内容` section with top-level `- ` change bullets for the history generator, plus supported systems, validation and signing limitations. Never replace published tags, binaries or checksums; fixes require a new version.

The Windows workflow validates the source and release notes, builds, tests installation and offline startup, and verifies all draft assets before publication. Existing draft assets may only be reused when their bytes match; differences require review. Published releases are never overwritten. A full release waits for all platform builds and verifies the package version against its tag before creating the release.

**Update download catalog** uses trusted default-branch code after release events or build completion. Workflow-run triggers must originate from this repository and an approved event, and their commit must belong to default-branch history. No triggering workflow artifacts or PR code are executed by the write job. Public release data refreshes only the five generated catalog files. Formatting, offline validation and idempotence checks run before an ordinary push. A concurrent branch update stops the job safely; rerun it on the new default branch. Protected branches remain protected.

Use `node scripts/releases/catalog.mjs --check` for an offline consistency check, omit flags to regenerate from the committed snapshot, or use `--fetch` with GitHub CLI to refresh public release metadata. Do not manually alter generated download regions. Historical version notes are maintained separately. Catalog-only main-branch pushes skip packaging, while PR and source-change checks remain enabled.

After a successful catalog push or a no-change result, `node scripts/releases/navigation.mjs --apply` refreshes a marked navigation block at the top of every public stable release. It lists the current downloads for every platform and links to the permanent catalog and history. Original release notes, assets, checksums and tags remain intact; a failed catalog push prevents navigation updates.

**Verify published Windows installer** accepts both full and Windows-specific tags and checks the real public installer against its published checksum before installation testing. Tests run only in an isolated Windows CI environment, use offline account fixtures, and do not bypass operating-system protection or consume real resets.
