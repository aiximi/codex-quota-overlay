# Changelog

## Unreleased

- Put downloads immediately after the project introduction, with a generated latest-per-platform block in both READMEs.
- Add a unified download center, complete version history, and detailed notes for each published release. Keep Windows and macOS release versions explicit.

## 2.0.1 — Windows · 2026-10-12

[Release details / 版本详情](docs/releases/windows-v2.0.1.md) · [Published packages](https://github.com/aiximi/codex-quota-overlay/releases/tag/windows-v2.0.1)

Windows-only patch release (`windows-v2.0.1`). macOS remains on the original `v2.0.0` packages. Release dates use Asia/Shanghai.

- Fix Windows native mouse and keyboard input by using a focusable overlay while preserving nonactivating initial display.
- Keep the verified Codex host while interacting with the Windows overlay/settings; hide it when another app is active or Codex closes/minimizes.
- Discover the Windows desktop CLI in managed version directories and use its parameterless quota query; macOS behavior is unchanged.
- Display Windows quota before the optional subscription lookup completes and persist drag positions after movement instead of on every event.
- Configure readable IDEA run configurations, local formatting, and hidden Windows Git synchronization with local logs.
- Add Windows installer verification for the actual directory-selection page, custom-drive installation, installed-app offline startup, and uninstallation.
- Add an on-demand workflow that verifies an existing public installer against its release checksums before installation testing.
- Clarify SmartScreen prompts, unsigned release status, custom installation folders and portable-app data locations in Chinese and English.
- The existing 2.0.0 installer already supports selecting its installation directory; no claim is made that these checks remove SmartScreen warnings.

## 2.0.0 · 2026-10-11

[Release details / 版本详情](docs/releases/v2.0.0.md) · [Published packages](https://github.com/aiximi/codex-quota-overlay/releases/tag/v2.0.0)

- First public cross-platform release: shared Electron/TypeScript UI and backend.
- macOS arm64/x64 and Windows x64 packaging, CI and downloadable release artifacts.
- Remaining quota, natural reset countdowns, individual reset expiration dates, extra balance and subscription dates.
- Explicit per-credit reset confirmation, durable retry protection and account isolation.
- Chinese/English settings, optional login startup, tray controls and offline preview.
- Organized source tree, tests, IDEA run configurations and opt-in developer Git synchronization.

## Earlier local prototype

A macOS-only Swift prototype established the interaction and read-only quota display. Personal build artifacts and account data are intentionally not part of this repository.
