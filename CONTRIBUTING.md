# Contributing

Thank you for helping improve a small, readable desktop utility. Discuss large features in an issue first and keep changes focused.

1. Fork and clone the repository; use Node.js 22.12+.
2. Run `npm ci` and `npm run preview`.
3. Work in a short-lived branch. Follow `.editorconfig` and Prettier.
4. Run `npm run check`; for UI changes also run `npm run test:ui`.
5. Add meaningful offline tests for behavior changes, update the relevant docs, then open a pull request describing the problem, result and validation.

## Required boundaries

- Never use real reset credits in tests or demonstrations.
- Never commit credentials, `.env`, generated packages, personal account data, machine-specific IDE configuration or screenshots containing real account information.
- Keep platform-specific APIs in `native/` and `main/platform/`; keep shared logic in `core/`.
- Never weaken confirmation, account validation or idempotency to make a test pass.
- Keep public labels in both Chinese and English. Tests should not depend on one developer's absolute paths.
- Prefer a small dependency footprint. Explain any new runtime dependency.

Developer auto-sync is optional and targets your own checkout/remote. It is not a replacement for reviewing a contribution, and it must never force-push or overwrite remote changes.

By contributing, you agree to license your contribution under the project's MIT license. Be respectful in issues and reviews; harassment and publication of private information are not accepted.
