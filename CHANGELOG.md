# Changelog

## Unreleased

- Add Windows installer verification for the actual directory-selection page, custom-drive installation, installed-app offline startup, and uninstallation.
- Add an on-demand workflow that verifies an existing public installer against its release checksums before installation testing.
- Clarify SmartScreen prompts, unsigned release status, custom installation folders and portable-app data locations in Chinese and English.
- The existing 2.0.0 installer already supports selecting its installation directory; no claim is made that these checks remove SmartScreen warnings.

## 2.0.0

- First public cross-platform release: shared Electron/TypeScript UI and backend.
- macOS arm64/x64 and Windows x64 packaging, CI and downloadable release artifacts.
- Remaining quota, natural reset countdowns, individual reset expiration dates, extra balance and subscription dates.
- Explicit per-credit reset confirmation, durable retry protection and account isolation.
- Chinese/English settings, optional login startup, tray controls and offline preview.
- Organized source tree, tests, IDEA run configurations and opt-in developer Git synchronization.

## Earlier local prototype

A macOS-only Swift prototype established the interaction and read-only quota display. Personal build artifacts and account data are intentionally not part of this repository.
