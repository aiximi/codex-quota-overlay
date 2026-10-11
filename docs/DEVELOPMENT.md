# 开发与 IDEA / Development

## 环境

- Node.js **22.12+**，npm，Git。
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
   - **Dev**：真实账号开发模式，保存源码后重新构建并重启。
   - **Preview (offline)**：示例数据，不读取账号、不调用真实重置。
   - **Check**：类型、格式和离线单元测试。
   - **UI Tests**：Electron 离线界面检查。
   - **Build packages**：本机打包。
   - **Git Sync**：前台启动自动 Git 同步。若已经安装后台同步服务，不要重复运行。
4. Git 工具窗口会显示 `origin`，IDEA 与命令行/Codex 使用同一个工作目录。无需复制项目或维护第二份源码。

共享 `.idea/vcs.xml` 只包含 Git 映射。工作区窗口布局、本机 Node 路径和其他 `.idea` 用户偏好不提交。

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

## English

Open the repository root in IDEA, select a Node.js 22.12+ interpreter, and use the shared `.run` configurations. Local IDE paths remain ignored. Run `npm ci`, then `npm run preview` for safe offline development; `npm run dev` uses the actual signed-in account. All reset testing must use fake transports, never real credits.

`npm run check` performs type, format, and offline tests. `npm run test:ui` launches a separate Electron preview with isolated settings. Build packages on the corresponding OS. Release tags run all matrix builds before uploading binaries and checksums. No signing secrets belong in Git.
