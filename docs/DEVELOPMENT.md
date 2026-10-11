# 开发与 IDEA / Development

## 环境

- Node.js **22.12+**，npm，Git **2.38+**。自动同步的冲突预检使用 `git merge-tree --write-tree`，需要这个 Git 版本。
- macOS：`xcode-select --install` 安装 Command Line Tools。Swift helper 只需系统 AppKit。
- Windows：PowerShell 5.1（Windows 自带）；开发 Node/Electron 不依赖 Java、Visual Studio 或额外 C++ 插件。
- IDEA 安装并启用 JavaScript、Node.js、Git 插件。其他支持 Node 的编辑器同样可用。

```sh
git clone https://github.com/aiximi/codex-quota-overlay.git
cd codex-quota-overlay
npm ci
npm run preview
```

Electron 44 会在首次使用时下载其官方运行时，后续复用缓存。首次安装需要网络。npm 12 的安装脚本白名单在 `package.json` 中，避免全局允许所有依赖脚本。若下载失败，修复现有网络/代理后重试；不要禁用 TLS 校验。

若已配置 `HTTP_PROXY` / `HTTPS_PROXY`，构建时可设置 `ELECTRON_GET_USE_PROXY=true` 让 Electron 下载器使用它们。这里必须使用 `true`，不能用 `1`。Git 的代理是独立配置，见 [SYNC.md](SYNC.md)。

## IDEA 一键运行

1. **File → Open**，选择仓库根目录，而不是 `src` 或生成目录。
2. **Settings → Languages & Frameworks → Node.js**，选择本机 Node 22.12+ 与 npm。
3. 等待索引完成，运行配置会自动发现 `.run/` 下的配置：
   - **Start**：构建后直接启动正式账号界面。
   - **Dev**：真实账号开发模式，保存源码后重新构建并重启。
   - **Preview (offline)**：示例数据，不读取账号、不调用真实重置。
   - **Check**：类型、格式和离线单元测试。
   - **UI Tests**：Electron 离线界面检查。
   - **Format**：按仓库的 Prettier 配置格式化可读源码。
   - **Build packages**：本机打包。
   - **Build Windows**：生成 Windows 安装器与便携版。
   - **Git Sync**：前台启动自动 Git 同步。若已经安装后台同步服务，不要重复运行。
   - **Git Sync Status**：显示同步是否运行、是否暂停及原因。
4. Git 工具窗口会显示 `origin`，IDEA 与命令行/Codex 使用同一个工作目录。无需复制项目或维护第二份源码。

共享 `.idea/vcs.xml` 只包含 Git 映射。工作区窗口布局、本机 Node 路径和其他 `.idea` 用户偏好不提交。

### 保存时保持源码可读

在 **Settings → Languages & Frameworks → JavaScript → Prettier** 中选择 **Automatic Prettier configuration**，启用 **Run on save** 和 **Run on 'Reformat Code' action**。它会使用本仓库安装的 Prettier、`.prettierrc.json` 和 `.prettierignore`，让保存、IDEA 格式化动作与 `npm run format` 采用同一套规则。`.editorconfig` 统一 UTF-8、LF 换行与缩进。

阅读、搜索和修改 `src/`、`native/windows/` 与 `scripts/` 中的源码。`dist/` 和 `build/` 是构建产物；压缩后的脚本不适合作为维护入口，重新构建也会覆盖它们。可将 `dist/`、`build/`、`release/`、`coverage/`、`test-results/` 与 `playwright-report/` 标记为 **Excluded**，减少 IDEA 索引与搜索噪音。Windows 原生 PowerShell 脚本遵循 `.editorconfig` 的四空格缩进，由维护者保持清晰布局，Prettier 不会修改原生脚本或 macOS 代码。

自动同步会先执行格式检查，格式未通过时保留修改并暂停。先运行 **Format** 和 **Check**，通过后执行 `npm run sync:resume`；后台同步不会在编辑过程中擅自重新排版文件。

## 常用命令

```sh
npm run dev
npm run format
npm run check
npm run test:ui
npm run build
npm run package:mac
npm run package:win
```

开发默认读取已登录账号；验证重置按钮必须使用离线 fake transport。`--read-only` 可显示真实数据但禁用重置入口；`--preview` 和 `--smoke-test` 使用完全离线数据。`QUOTA_USER_DATA_DIR` 可指定隔离测试目录，不能指向正式设置目录。

## 打包与发布

`scripts/build.mjs` 将主进程和 preload 打包为 CJS，界面打包为浏览器脚本，再复制 HTML/CSS。mac helper 使用 `QUOTA_TARGET_ARCH=arm64` 或 `x64` 选择构建架构；Windows helper 是固定随包脚本。

构建目录：`dist/` 为 JS 与界面，`build/native/` 为 helper，`release/` 为安装包。它们不进入 Git。

在 Mac 上指定架构时，helper 与应用必须选择同一个架构，例如：

```sh
QUOTA_TARGET_ARCH=arm64 npm run package:mac -- --arm64
QUOTA_TARGET_ARCH=x64 npm run package:mac -- --x64
```

上传或修改 `.github/workflows/` 需要 GitHub 的 workflow 写入权限。使用 GitHub CLI 的维护者可以运行 `gh auth refresh --hostname github.com --scopes workflow`，在浏览器授权后再推送。普通下载用户不需要 GitHub 登录或这些权限。

CI 对 macOS arm64、macOS x64、Windows x64 分别执行检查、UI 测试和打包。合并到 main 只生成 Actions 构建产物；推送版本标签时，所有平台成功后才发布 GitHub Release：

```sh
# 先更新 package.json、package-lock.json、CHANGELOG.md 与发布说明
npm run check
npm run test:ui
git add package.json package-lock.json CHANGELOG.md docs/RELEASE-NOTES.md
git commit -m "Release 2.0.1"
git tag v2.0.1
git push origin main v2.0.1
```

当前发行包未进行 Developer ID 公证或 Windows Authenticode 签名。若后续加入签名，应将证书与密码放 GitHub Actions Secrets，不提交到仓库；同步修改安装说明。Windows CI 不能证明所有真实桌面场景均兼容。

### Windows 安装验证与签名限制

申请渠道、费用、地区限制和办理步骤见 [Windows 代码签名指南](WINDOWS-SIGNING.md)。

Windows 构建完成后，CI 会运行 `scripts/test-windows-install.ps1`，验证真实 NSIS 目录选择页、自定义位置安装、安装后的离线启动及卸载。安装验证只用于隔离的 GitHub Actions Windows 环境，不应在装有正式版本的日常电脑上执行。

要验证已经发布的安装包，在 GitHub Actions 中运行 **Verify published Windows installer**，填写版本标签（例如 `v2.0.0`）。它会下载该版本的正式 `setup.exe`，先与同一发布页的 `SHA256SUMS.txt` 核对，再执行安装验证。证据保存在 `windows-installation-evidence` 构建产物中。这样能区分源码测试、新构建包测试与正式下载包测试。

这些检查不等于 SmartScreen 放行认证。CI 中的安装测试不会关闭 Defender、SmartScreen 或更改系统防护设置；下载信誉和组织策略仍会影响用户首次运行。参考 [微软的 SmartScreen 说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)。

正式签名还需要经过身份验证的代码签名证书或签名服务。目前仓库没有配置签名凭据，发行包保持明确标注的未签名状态。自签名证书不能解决公开分发的信誉问题，有效签名也不保证新文件立刻没有提示。获得签名资源后，应配置 electron-builder 26 的签名选项并启用 `forceCodeSigning`，同时验证安装器、便携版和包内程序的 Authenticode 状态；签名失败应中止发布，不能静默退回未签名包。

## English

Use Node.js 22.12+, npm and Git 2.38+; automatic synchronization requires `git merge-tree --write-tree` for conflict checks. Open the repository root in IDEA, select the Node interpreter, and use the shared `.run` configurations. Local IDE paths remain ignored. Run `npm ci`, then `npm run preview` for safe offline development; `npm run dev` uses the actual signed-in account. All reset testing must use fake transports, never real credits.

`npm run check` performs type, format, and offline tests. `npm run test:ui` launches a separate Electron preview with isolated settings. Build packages on the corresponding OS. Release tags run all matrix builds before uploading binaries and checksums. No signing secrets belong in Git.
