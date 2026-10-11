# Security policy

Supported security fixes target the latest 2.x release. This is community software, not an OpenAI product.

For suspected credential exposure or a way to bypass reset confirmation, use [GitHub private vulnerability reporting](https://github.com/aiximi/codex-quota-overlay/security/advisories/new). Do not post authentication files, access tokens, account identifiers, personal quota screenshots or exploit details in a public issue. If private reporting is unavailable, open a minimal issue asking for a private contact channel without sensitive details.

Contributors must preserve sandbox/context isolation, fixed network destinations for credentials, explicit reset confirmation, per-account identity checks, durable idempotency records, and the rule that tests never spend real credits. Treat all server strings and IPC inputs as untrusted.

Download release files only from this repository and verify `SHA256SUMS.txt`. Current builds are unsigned/unnotarized. A checksum detects accidental changes; it does not replace a publisher certificate or establish trust in a compromised release account.

开发者请勿在公开 Issue 中贴出 auth.json、token、账号 ID 或私人日志。涉及凭证或重置保护的问题优先使用私密漏洞报告。
