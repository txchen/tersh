# Implement Login, Logout, Config, And Token Storage

Status: resolved

## Parent

.scratch/termix-cli-bridge/PRD.md

## What to build

Implement the first authenticated CLI flow. A user should be able to run `tersh login --server <url>`, enter Termix credentials without leaking them into shell history, complete password-only or TOTP login, persist non-secret server config, store only the final JWT/session token, and remove that token with `tersh logout`.

This slice should use the Termix native-style JWT login path and native-app request marker so the server returns a JSON token. It should not use API keys, browser cookies, desktop app token storage, OIDC, LDAP-specific workarounds, WebAuthn, or browser-based auth flows.

## Acceptance criteria

- [ ] `tersh login --server <url>` prompts locally for username and password.
- [ ] Password-only login posts to the Termix login endpoint with the native-app request marker and stores only the final returned JWT/session token.
- [ ] TOTP-required login prompts for a TOTP or backup code, verifies the temporary token, and stores only the final returned JWT/session token.
- [ ] The CLI never stores Termix passwords, TOTP codes, temporary pending-TOTP tokens, SSH passwords, private keys, or key passphrases.
- [ ] Non-secret config is stored in the OS config directory, including server URL and TLS preferences.
- [ ] JWT/session token storage uses the OS keychain when available.
- [ ] Explicit local file token fallback is supported only with a clear warning and `0600` permissions.
- [ ] `tersh logout` removes stored token material while leaving non-secret server config intact.
- [ ] Valid HTTPS/WSS is required by default, private CA configuration is supported, insecure TLS verification is explicit and warned, and HTTP/WS is used only when the configured server URL explicitly starts with HTTP.
- [ ] Automated tests cover password login, TOTP login, pending-token rejection, logout, token/config persistence, TLS URL policy, and "never persist secrets" behavior.

## Blocked by

- .scratch/termix-cli-bridge/issues/07-scaffold-installable-tersh-cli.md
