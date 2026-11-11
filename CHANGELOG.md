# Changelog

## Unreleased

- Put downloads immediately after the project introduction, with a generated latest-per-platform block in both READMEs.
- Add a unified download center, complete version history, and detailed notes for each published release. Keep Windows and macOS release versions explicit.

## 2.1.3 · 2026-11-11

[Release details / 版本详情](docs/releases/v2.1.3.md) · [Published packages](https://github.com/aiximi/codex-quota-overlay/releases/tag/v2.1.3)

- Validate actual macOS panel geometry inside the visible Codex/display region during desktop and full-screen Space changes.
- Reapply intended placement on recovery even if cached Electron bounds already match; reject clipped and off-display surfaces.
- Recreate a persistently unavailable native panel after five seconds of confirmed failure, preserve UI state, and rebind its new window ID with a 30-second recreation cooldown.
- Consume fresh native visibility observations without replaying them during quota or UI updates. Preserve foreground-only following and existing click behavior.

## 2.1.2 · 2026-11-11

[Release details / 版本详情](docs/releases/v2.1.2.md) · [Published packages](https://github.com/aiximi/codex-quota-overlay/releases/tag/v2.1.2)

- Keep the exact verified Codex window associated while the macOS overlay or Settings owns foreground, fixing disappearance during interaction.
- Clear associations on unrelated apps, unavailable hosts or changed process/window identity.
- Test production Swift host selection directly, including repeated clicks, settings, movement and stale hosts; Windows behavior is unchanged.

## 2.1.1 · 2026-11-11

[Release details / 版本详情](docs/releases/v2.1.1.md) · [Published packages](https://github.com/aiximi/codex-quota-overlay/releases/tag/v2.1.1)

- Repair macOS panels missing from the current desktop using exact native window visibility instead of Electron's visible flag alone, without taking focus.
- Restart tracking after wake/unlock and position restore, with fresh foreground validation.
- Keep helper recovery active with capped backoff after repeated failures on both platforms.
- Add a real macOS window-server regression and helper lifecycle coverage; preserve settings, reset receipts and the existing quota protocol.

## 2.1.0 · 2026-11-06

[Release details / 版本详情](docs/releases/v2.1.0.md) · [Published packages](https://github.com/aiximi/codex-quota-overlay/releases/tag/v2.1.0)

- Unify macOS and Windows releases with foreground official-data refresh, account checks and explicit stale/unknown states.
- Fetch subscription dates independently of quota, preserve official/manual source labels, and request complete reset details with read-only legacy fallback.
- Preserve Windows 2.0.1 interaction, tracking and installation fixes.

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
