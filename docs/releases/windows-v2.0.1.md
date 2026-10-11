# Windows 2.0.1 · 交互与额度查询修复

发布日期：**2026-10-12（Asia/Shanghai）**。发布标签：`windows-v2.0.1`。

[下载中心](https://github.com/aiximi/codex-quota-overlay/blob/main/DOWNLOADS.md) · [全部版本与变化](https://github.com/aiximi/codex-quota-overlay/blob/main/docs/VERSIONS.md) · [此版本发布文件](https://github.com/aiximi/codex-quota-overlay/releases/tag/windows-v2.0.1)

**这是仅 Windows 的修复版。macOS 没有发布 2.0.1，继续使用原 [2.0.0](https://github.com/aiximi/codex-quota-overlay/blob/main/docs/releases/v2.0.0.md) 安装包。** 本次提供 Windows 10/11 x64 的 `setup.exe` 安装版与 `portable.exe` 便携版，构建源码为 [`eadce9b9e7d1ef3ed7b0b62a6797a79fa97e65e5`](https://github.com/aiximi/codex-quota-overlay/commit/eadce9b9e7d1ef3ed7b0b62a6797a79fa97e65e5)。

## 更新内容

- **面板能显示却无法正常点击或输入。** Windows 浮层现在可在点击时获得原生窗口焦点；刚出现时仍使用不激活的显示方式，避免抢占 Codex 正在使用的键盘焦点。
- **点击浮层或设置后，窗口跟随失效。** 与浮层交互期间保留最后一个已确认的 Codex 窗口关联，并持续检查它是否有效。切换到其他应用、最小化或关闭 Codex 后仍会隐藏，失效的窗口关联会被清除。
- **找不到 CLI，或额度一直显示 `—`。** 自动查找 `%LOCALAPPDATA%\OpenAI\Codex\bin` 下受管理的版本目录与原生 `codex.exe`，避免选中无法独立运行的 MSIX 资源程序。Windows 额度查询改用其 CLI 支持的无参数请求；macOS 的请求方式保持原样。
- **额度被订阅查询拖延。** Windows CLI 返回用量后立即显示；可选的订阅日期请求较慢时，不再延迟已有用量。
- **拖动不流畅。** 拖动位置先保存在内存中，在移动完成或短暂静止后写入设置，避免每次鼠标移动都同步写盘。

同一源码版本还整理了 IDEA 运行配置与本地格式化入口，改进 Windows 开发者 Git 同步的隐藏启动、日志与运行时路径处理。发行应用不会自动开启开发者 Git 同步。

## 如何升级

1. 从下载中心选择 Windows 2.0.1。核对文件与 [本版本 SHA256SUMS.txt](https://github.com/aiximi/codex-quota-overlay/releases/download/windows-v2.0.1/SHA256SUMS.txt) 一致；不要使用另一版本的校验文件。
2. 在系统托盘选择“退出”，先结束旧浮层。只关闭 Codex 不会退出浮层；不要同时运行旧版和新版。
3. 安装版运行 `Codex-Quota-Overlay-2.0.1-windows-x64-setup.exe`，可在向导中选择 `D:\Apps\Codex Quota Overlay` 等当前账号有写权限的目录。便携版在旧程序退出后替换为 `Codex-Quota-Overlay-2.0.1-windows-x64-portable.exe`，再运行新文件。
4. 如果以前手动填写了失效的 CLI 路径，在设置中清空该字段以恢复自动查找。切换到 Codex 后检查浮层点击、展开与用量显示。

安装目录选择在 2.0.0 已经支持，本次仍保留；便携版没有安装向导。两种版本的用户数据仍位于 `%APPDATA%\Codex Quota Overlay\`，不会随 EXE 移动。更新不需要删除设置；如果存在结果不明确的重置记录，尤其不要删除它来尝试另一条重置。完整步骤见 [安装与使用](https://github.com/aiximi/codex-quota-overlay/blob/main/docs/USAGE.md)。

## 验证了什么

- Windows 发布流程执行类型、格式、离线单元测试和 Electron 界面测试，再打包安装版与便携版。
- 原生窗口测试检查 Windows 浮层可获得焦点；PowerShell helper 测试检查 User32 初始化、JSON 心跳，以及 Codex/浮层/其他应用之间的窗口关联规则。
- 协议与路径测试使用本地示例验证 Windows CLI 查找、额度请求参数，以及与 macOS 行为的区分。
- 实际生成的安装包在 Windows CI 中验证目录选择、自定义盘符安装、安装后离线启动和卸载；上传文件核对大小与 SHA-256。

上述测试使用离线预览、示例协议或 CI 桌面，**没有兑换真实账号的重置机会**。测试不能替代所有真实 Codex 版本、多显示器、混合缩放比例和企业策略环境的人工检查，也不表示 macOS 发行包发生了变化。

## 已知限制

**Windows 2.0.1 仍未经过 Authenticode 签名。** 此次修复不会消除 SmartScreen 的“未识别的应用”提示。未签名的新文件需要积累信誉，即使未来签名，也不能保证新版本立刻没有提示；该提示本身不是病毒检测结论。

核对本仓库来源和校验值后，若系统提供入口且你决定信任下载，可以选择“更多信息 → 仍要运行”。企业策略或 Smart App Control 阻止时请联系管理员，**不要关闭全局保护**。参见 [Microsoft 官方说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)。

支持的登录方式、订阅日期接口限制与 2.0.0 相同。当前没有自动更新器；下载已安装程序的新版本和拉取开发源码是两项独立操作。

## English summary

Released on **October 12, 2026 (Asia/Shanghai)** as `windows-v2.0.1`. **This patch updates Windows only; macOS remains on v2.0.0.** It fixes native mouse/keyboard interaction, Codex host tracking while using the overlay, managed CLI discovery, and the Windows quota request. Usage appears before an optional subscription lookup finishes, and drag positions are saved after movement rather than on every event.

Quit the old overlay through its tray menu before installing the new setup package or replacing the portable EXE. Clear an obsolete manual CLI path to restore automatic discovery. Both packages retain user data in `%APPDATA%\Codex Quota Overlay\`; custom installation folders were already supported in 2.0.0.

Windows CI checked offline tests, Electron interaction, the native helper, packaging, installer directory selection, custom-drive installation, offline startup and uninstallation. No real reset credit was redeemed. These checks do not cover every real Codex desktop, monitor, DPI or enterprise-policy configuration.

The packages remain unsigned. This release does not remove SmartScreen restrictions, and future signing would not guarantee warning-free new files. Verify the source and checksums, use a per-app approval only if offered and trusted, and keep global security protections enabled.
