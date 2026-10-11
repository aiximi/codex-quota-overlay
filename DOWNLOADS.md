# 下载 Codex Quota Overlay

[项目首页](README.md) · [所有历史版本与更新记录](docs/VERSIONS.md) · [安装与故障排查](docs/USAGE.md) · [English](README.en.md)

## 选择你的系统

这里同时列出每个系统已经发布的最新稳定版。Windows 和 Mac 可以分别升级，版本号不同是正常的；只需下载自己系统所在行的文件。

| 你的系统                  | 最新稳定版 | 推荐下载                                                                                                                                     | 其他格式                                                                                                                                        | 更新说明                                                                                            |
| ------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Windows 10/11 · x64       | **2.0.1**  | [下载安装版](https://github.com/aiximi/codex-quota-overlay/releases/download/windows-v2.0.1/Codex-Quota-Overlay-2.0.1-windows-x64-setup.exe) | [便携版 EXE](https://github.com/aiximi/codex-quota-overlay/releases/download/windows-v2.0.1/Codex-Quota-Overlay-2.0.1-windows-x64-portable.exe) | [查看变化](https://github.com/aiximi/codex-quota-overlay/blob/main/docs/releases/windows-v2.0.1.md) |
| macOS 13+ · Apple Silicon | **2.0.0**  | [下载安装版 DMG](https://github.com/aiximi/codex-quota-overlay/releases/download/v2.0.0/Codex-Quota-Overlay-2.0.0-mac-arm64.dmg)             | [压缩包 ZIP](https://github.com/aiximi/codex-quota-overlay/releases/download/v2.0.0/Codex-Quota-Overlay-2.0.0-mac-arm64.zip)                    | [查看变化](https://github.com/aiximi/codex-quota-overlay/blob/main/docs/releases/v2.0.0.md)         |
| macOS 13+ · Intel         | **2.0.0**  | [下载安装版 DMG](https://github.com/aiximi/codex-quota-overlay/releases/download/v2.0.0/Codex-Quota-Overlay-2.0.0-mac-x64.dmg)               | [压缩包 ZIP](https://github.com/aiximi/codex-quota-overlay/releases/download/v2.0.0/Codex-Quota-Overlay-2.0.0-mac-x64.zip)                      | [查看变化](https://github.com/aiximi/codex-quota-overlay/blob/main/docs/releases/v2.0.0.md)         |

- **Windows**：通常选择安装版，可在向导中选择 C、D、E 等有写权限的盘符；便携版无需安装。
- **Mac Apple Silicon**：适用于 M 系列芯片；通常选择 DMG。
- **Mac Intel**：适用于 Intel 芯片。可在苹果菜单 → 关于本机中查看芯片或处理器。
- **Mac ZIP**：同一版本应用的压缩包，解压后把应用移动到 Applications；无需同时下载 DMG 和 ZIP。

## 安装和升级

1. 安装并登录官方 Codex。
2. 升级前从菜单栏或托盘退出旧版浮层，下载对应系统的安装包。
3. Windows 按向导安装；Mac 打开 DMG，将应用拖入 Applications。
4. 启动浮层，切换到 Codex。完整操作见 [使用说明](docs/USAGE.md)。

当前发行包尚未完成 Windows 正式代码签名或 Apple Developer ID 公证。首次运行的系统提示及处理方式见安装说明。

## 校验下载文件

| 系统                      | 版本  | 校验文件                                                                                                          | 发布来源                                                                                |
| ------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Windows 10/11 · x64       | 2.0.1 | [SHA-256 校验文件](https://github.com/aiximi/codex-quota-overlay/releases/download/windows-v2.0.1/SHA256SUMS.txt) | [原始发布页](https://github.com/aiximi/codex-quota-overlay/releases/tag/windows-v2.0.1) |
| macOS 13+ · Apple Silicon | 2.0.0 | [SHA-256 校验文件](https://github.com/aiximi/codex-quota-overlay/releases/download/v2.0.0/SHA256SUMS.txt)         | [原始发布页](https://github.com/aiximi/codex-quota-overlay/releases/tag/v2.0.0)         |
| macOS 13+ · Intel         | 2.0.0 | [SHA-256 校验文件](https://github.com/aiximi/codex-quota-overlay/releases/download/v2.0.0/SHA256SUMS.txt)         | [原始发布页](https://github.com/aiximi/codex-quota-overlay/releases/tag/v2.0.0)         |

请使用文件所在发行版本的校验表。Windows 与 Mac 最新版本不同时，不要混用不同发行的校验表。

## 需要旧版本？

[打开历史版本与更新记录 →](docs/VERSIONS.md)：按系统查找旧版安装包、发行日期和每次具体变化。旧版文件与原始下载地址保留。

GitHub 的 Latest 标签表示最近一次发行，可能只更新某个系统。本页根据各系统真实安装包选择最新稳定版，作为统一下载入口。

<!-- Generated from docs/releases/catalog.json. Edit release notes, not this page. -->
