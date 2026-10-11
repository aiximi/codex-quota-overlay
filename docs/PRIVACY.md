# Privacy / 隐私说明

This project has no telemetry, advertising, analytics SDK, or project-operated server.

## What stays local

- Window geometry, foreground process metadata, language, position and refresh preferences.
- Official quota responses shown in the UI.
- Account-scoped subscription date cache and optional manually entered dates.
- Opaque credit IDs and UUID operation receipts required to prevent accidental duplicate reset attempts. Account keys in settings are hashes, not email addresses.

Supported credentials are read from the existing local Codex authentication file into the main process only. They are never copied into application settings, renderer state, logs, repository files or GitHub. The app does not read chat history or capture the screen.

## Network connections

- The installed official Codex CLI contacts its normal account service for quota reads and explicitly confirmed reset requests.
- Subscription lookup sends the current account token to the fixed `https://chatgpt.com/backend-api/subscriptions` endpoint. Redirects are rejected. The token is not sent to arbitrary hosts.
- Opening the GitHub link launches your default browser. Development dependency installation and release downloads use their respective official registries and GitHub.

Preview mode uses synthetic data with no account requests. The developer-only Git sync service only runs if explicitly installed or started, and synchronizes the source repository; the distributed application does not run it.

## Remove data

Quit the app before removing its settings directory. Do not discard a pending reset receipt to force another reset: first resolve the operation using refreshed account information. Uninstalling this app does not modify or remove Codex's own account file.

中文：本项目没有遥测或自营服务器。账号凭证仅在主进程内存使用；不上传聊天、截图或认证文件到项目或 GitHub。设置保存日期与操作记录，不保存 token。自动 Git 同步只属于开发仓库的可选工具，发行应用不会启动它。
