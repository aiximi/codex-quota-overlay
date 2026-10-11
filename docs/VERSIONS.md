# 历史版本与更新记录

[下载各系统最新版](../DOWNLOADS.md) · [项目首页](../README.md)

每个系统独立列出已发布版本，最新版本排在前面。发布日期按北京时间（UTC+8）显示。旧版供回退和兼容性排查，已知修复请查看对应版本说明。

## Windows 10/11 · x64

| 版本                 | 发布日期   | 下载                                                                                                                                                                                                                                                                                           | 变化与校验                                                                                                                                                                                                     |
| -------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.0.1 **当前最新版** | 2026-10-12 | [下载安装版](https://github.com/aiximi/codex-quota-overlay/releases/download/windows-v2.0.1/Codex-Quota-Overlay-2.0.1-windows-x64-setup.exe) · [便携版 EXE](https://github.com/aiximi/codex-quota-overlay/releases/download/windows-v2.0.1/Codex-Quota-Overlay-2.0.1-windows-x64-portable.exe) | [更新说明](https://github.com/aiximi/codex-quota-overlay/blob/main/docs/releases/windows-v2.0.1.md) · [SHA-256](https://github.com/aiximi/codex-quota-overlay/releases/download/windows-v2.0.1/SHA256SUMS.txt) |
| 2.0.0                | 2026-10-11 | [下载安装版](https://github.com/aiximi/codex-quota-overlay/releases/download/v2.0.0/Codex-Quota-Overlay-2.0.0-windows-x64-setup.exe) · [便携版 EXE](https://github.com/aiximi/codex-quota-overlay/releases/download/v2.0.0/Codex-Quota-Overlay-2.0.0-windows-x64-portable.exe)                 | [更新说明](https://github.com/aiximi/codex-quota-overlay/blob/main/docs/releases/v2.0.0.md) · [SHA-256](https://github.com/aiximi/codex-quota-overlay/releases/download/v2.0.0/SHA256SUMS.txt)                 |

## macOS 13+ · Apple Silicon

| 版本                 | 发布日期   | 下载                                                                                                                                                                                                                                                            | 变化与校验                                                                                                                                                                                     |
| -------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.0.0 **当前最新版** | 2026-10-11 | [下载安装版 DMG](https://github.com/aiximi/codex-quota-overlay/releases/download/v2.0.0/Codex-Quota-Overlay-2.0.0-mac-arm64.dmg) · [压缩包 ZIP](https://github.com/aiximi/codex-quota-overlay/releases/download/v2.0.0/Codex-Quota-Overlay-2.0.0-mac-arm64.zip) | [更新说明](https://github.com/aiximi/codex-quota-overlay/blob/main/docs/releases/v2.0.0.md) · [SHA-256](https://github.com/aiximi/codex-quota-overlay/releases/download/v2.0.0/SHA256SUMS.txt) |

## macOS 13+ · Intel

| 版本                 | 发布日期   | 下载                                                                                                                                                                                                                                                        | 变化与校验                                                                                                                                                                                     |
| -------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.0.0 **当前最新版** | 2026-10-11 | [下载安装版 DMG](https://github.com/aiximi/codex-quota-overlay/releases/download/v2.0.0/Codex-Quota-Overlay-2.0.0-mac-x64.dmg) · [压缩包 ZIP](https://github.com/aiximi/codex-quota-overlay/releases/download/v2.0.0/Codex-Quota-Overlay-2.0.0-mac-x64.zip) | [更新说明](https://github.com/aiximi/codex-quota-overlay/blob/main/docs/releases/v2.0.0.md) · [SHA-256](https://github.com/aiximi/codex-quota-overlay/releases/download/v2.0.0/SHA256SUMS.txt) |

## 每次发行具体改了什么

### 2.0.1 · Windows 10/11 · x64

**发布日期：2026-10-12** · [完整更新说明](https://github.com/aiximi/codex-quota-overlay/blob/main/docs/releases/windows-v2.0.1.md) · [原始发行与全部附件](https://github.com/aiximi/codex-quota-overlay/releases/tag/windows-v2.0.1)

- **面板能显示却无法正常点击或输入。** Windows 浮层现在可在点击时获得原生窗口焦点；刚出现时仍使用不激活的显示方式，避免抢占 Codex 正在使用的键盘焦点。
- **点击浮层或设置后，窗口跟随失效。** 与浮层交互期间保留最后一个已确认的 Codex 窗口关联，并持续检查它是否有效。切换到其他应用、最小化或关闭 Codex 后仍会隐藏，失效的窗口关联会被清除。
- **找不到 CLI，或额度一直显示 `—`。** 自动查找 `%LOCALAPPDATA%\OpenAI\Codex\bin` 下受管理的版本目录与原生 `codex.exe`，避免选中无法独立运行的 MSIX 资源程序。Windows 额度查询改用其 CLI 支持的无参数请求；macOS 的请求方式保持原样。
- **额度被订阅查询拖延。** Windows CLI 返回用量后立即显示；可选的订阅日期请求较慢时，不再延迟已有用量。
- **拖动不流畅。** 拖动位置先保存在内存中，在移动完成或短暂静止后写入设置，避免每次鼠标移动都同步写盘。

同一源码版本还整理了 IDEA 运行配置与本地格式化入口，改进 Windows 开发者 Git 同步的隐藏启动、日志与运行时路径处理。发行应用不会自动开启开发者 Git 同步。

### 2.0.0 · Windows 10/11 · x64、macOS 13+ · Apple Silicon、macOS 13+ · Intel

**发布日期：2026-10-11** · [完整更新说明](https://github.com/aiximi/codex-quota-overlay/blob/main/docs/releases/v2.0.0.md) · [原始发行与全部附件](https://github.com/aiximi/codex-quota-overlay/releases/tag/v2.0.0)

- Codex 位于前台时显示浮层；收起为 `276 × 42` 胶囊，展开查看详情，使用独立拖动柄调整位置。
- 显示账号实际返回的额度周期、剩余百分比、自然重置日期与倒计时，不预设所有账号都有相同限额。
- 每条重置机会分别显示到期日期与操作按钮；再次确认后才会消耗，请求互斥，结果不明确时不自动重试。
- 显示额外额度，以及尽力从官方账号接口获取的订阅续费/到期日期；支持按账号手动记录并标注来源。
- 提供中文、英文、托盘/菜单栏设置、可选登录启动与完全离线的示例预览。
- 公开分层源码、测试、IDEA 运行配置、构建流程，以及开发者可选的 Git 自动同步。发行应用不会自动启用 Git 同步。

## 历史版本保留规则

- 已公开的版本标签、安装包和下载地址保留；修复通过新版本发布。
- 单系统更新只推进对应系统的最新版本，其他系统继续显示各自的最新稳定版。
- 草稿和预发行版本不进入稳定版下载推荐；GitHub 自动生成的 Source code 文件是源码，不是安装包。
- 本页展示公开发行的桌面安装包。早期仅本地使用的原型未公开分发，不提供下载。

<!-- Generated from docs/releases/catalog.json and versioned release notes. -->
