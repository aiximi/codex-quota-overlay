# Codex Quota Overlay 2.0.0

First public release for macOS Apple Silicon, Intel Mac and Windows x64.

## Download

- macOS 13+: choose `mac-arm64` for Apple Silicon or `mac-x64` for Intel, then open the DMG and drag the app to Applications.
- Windows 10/11 x64: choose `setup.exe` for installation or `portable.exe` for a portable build.
- Verify your file with `SHA256SUMS.txt`.

Features include foreground-only quota display, reset countdowns and expiration dates, explicitly confirmed credit redemption, subscription dates, Chinese/English UI, tray controls and optional login startup.

These community builds are **not Apple Developer ID notarized or Windows Authenticode signed**. Operating-system publisher warnings are expected. The project is not affiliated with OpenAI. Read the repository installation guide before use; do not disable global security controls.

Official Codex with a supported local ChatGPT login is required. Keychain-only logins and API-key mode may not work. Subscription dates are best-effort and can be entered manually. Tests use offline fixtures; no real credit redemption is performed to validate a release. Windows CI packaging does not replace every real desktop/multi-monitor compatibility test.

中文：安装前先登录官方 Codex。每条重置机会独立显示，需再次确认才会消耗。预览和自动化测试使用示例数据，不会消耗真实机会。当前发行版未公证/签名，请核对下载来源和校验值。

## Windows installation / Windows 安装

The `setup.exe` installer supports choosing an installation folder on a writable drive, such as `D:\Apps\Codex Quota Overlay`. The portable executable has no installation wizard; place it in the folder you want. User settings remain in `%APPDATA%\Codex Quota Overlay`.

SmartScreen may display “Windows protected your PC” **before** the installation wizard because this release is unsigned and has not established download reputation. After checking the source and checksum, users who choose to trust this release can use **More info → Run anyway**, if Windows offers that option. If organizational policy or Smart App Control prevents it, consult the device administrator; do not disable global protection. Signing future releases would not guarantee that every new file immediately avoids this prompt. See [Microsoft's explanation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

中文：请选择 `setup.exe`，在安装向导的目录页点击“浏览”，可选 D 盘、E 盘等有写入权限的位置。“Windows 已保护你的电脑”出现在安装向导之前；核对本项目下载来源与 SHA-256 后，如果决定信任此版本，可自行点击“更多信息 → 仍要运行”。若系统没有该入口，请联系设备管理员。当前版本没有正式代码签名，此提示不能宣称已消除。详细步骤见 [安装说明](https://github.com/aiximi/codex-quota-overlay/blob/main/docs/USAGE.md)。

维护者申请代码签名的免费方案、费用、身份验证步骤和发布流程见 [Windows 签名指南](https://github.com/aiximi/codex-quota-overlay/blob/main/docs/WINDOWS-SIGNING.md)。
