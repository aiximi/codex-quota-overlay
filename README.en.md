# Codex Quota Overlay

[中文](README.md) · [Download](https://github.com/aiximi/codex-quota-overlay/releases/latest) · [Development](docs/DEVELOPMENT.md) · [Privacy](docs/PRIVACY.md)

A compact **macOS and Windows** desktop overlay that appears while Codex is in the foreground. See remaining quota, reset countdowns, individual reset-credit expiration dates, extra credits, and subscription dates. Redeem a selected reset credit only after explicit confirmation.

Independent community software. Not affiliated with or endorsed by OpenAI. It does not patch Codex or inject code into its interface.

<img src="assets/preview.png" width="328" alt="Offline preview with synthetic quota, reset and subscription dates" />

The preview uses synthetic data. Both Chinese and English interfaces are available.

## Install

Download from [GitHub Releases](https://github.com/aiximi/codex-quota-overlay/releases/latest):

- Apple Silicon: `*-mac-arm64.dmg`; Intel Mac: `*-mac-x64.dmg`. Drag the app into Applications.
- Windows 10/11 x64: `*-windows-x64-setup.exe` or `*-windows-x64-portable.exe`.
- Verify the file using the accompanying `SHA256SUMS.txt`.

Builds are not Apple Developer ID notarized or Windows Authenticode signed. The operating system may warn about an unknown publisher. Verify the source and checksum. Where offered, use only the OS's per-app approval interface; do not disable system-wide security.

**Choose a Windows drive:** Run `Codex-Quota-Overlay-2.0.0-windows-x64-setup.exe`. On the installer's directory page, use **Browse** or enter a path such as `D:\Apps\Codex Quota Overlay`. Your account needs write permission to the selected directory. The `portable.exe` has no installation-directory page: place it on your preferred drive and run it there. User data still lives in `%APPDATA%\Codex Quota Overlay\`.

**“Unrecognized app” before the installer:** Current packages are unsigned and new versions need SmartScreen reputation; signing would not guarantee warning-free releases. This warning alone is not a malware verdict. After verifying this repository's release and SHA-256, you may choose **More info → Run anyway** if Windows offers it and you trust the download. If enterprise policy or Smart App Control blocks execution, keep global protection enabled and contact your administrator or wait for a release that meets your device's policy. See [Microsoft's explanation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation) and the [installation guide](docs/USAGE.md).

Install and sign in to official Codex first. Start the overlay, switch to Codex, and expand the capsule. Use the tray/menu-bar Settings entry to change language, configure login startup, set the refresh interval, or choose a native Codex executable.

The current authentication adapter supports ChatGPT credentials in `CODEX_HOME/auth.json` or `~/.codex/auth.json`. Keychain-only credentials, API-key logins and third-party providers may not work. Never publish your authentication file, token or account identifier in an issue.

## Behavior

- A 276 × 42 collapsed capsule; a separate grip for dragging and a large toggle target.
- Only public foreground-window geometry is read. No screenshots, chat inspection or accessibility permission is required by the window helper.
- Actual quota windows are displayed, including accounts that only have a weekly window.
- Reset credits are selected individually. Cancel is the confirmation default. Requests are serialized, never automatically retried, and ambiguous retries retain the same operation ID.
- Subscription dates can come from the official account endpoint, a labelled local cache, or a manual account-scoped entry. The endpoint is not a stable public API and may be unavailable.
- No telemetry or project-owned backend. Credentials remain in the main process and are never sent to the renderer or stored in application settings.

## Develop

Requires Node.js 22.12+, npm and Git 2.38+; macOS additionally needs Xcode Command Line Tools for its window helper. Downloaded apps include their runtime.

```sh
git clone https://github.com/aiximi/codex-quota-overlay.git
cd codex-quota-overlay
npm ci
npm run preview
npm run dev
```

`preview` uses synthetic data and cannot perform a real reset. `dev` rebuilds and restarts after saved source changes. Open the repository in IntelliJ IDEA and use the shared `.run` configurations.

```sh
npm run check
npm run test:ui
npm run package:mac
npm run package:win
```

Build each release on its target OS. CI builds Apple Silicon, Intel Mac and Windows x64 packages. Windows CI checks cannot replace real desktop, mixed-DPI and multi-monitor testing. Linux window tracking is not supported. There is no auto-updater; use Releases for updates.

Optional developer Git synchronization checks changes, commits and pushes them, then integrates remote updates. Conflicts pause synchronization without overwriting either side. It is never enabled by the distributed application. See [SYNC.md](docs/SYNC.md).

Source is separated into `src/core`, `src/main`, `src/renderer`, `src/shared`, `native`, `tests`, `scripts`, and `docs`. See [Architecture](docs/ARCHITECTURE.md), [Contributing](CONTRIBUTING.md), [Security](SECURITY.md), and [MIT License](LICENSE).
