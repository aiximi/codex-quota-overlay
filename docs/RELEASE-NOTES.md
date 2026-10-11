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
