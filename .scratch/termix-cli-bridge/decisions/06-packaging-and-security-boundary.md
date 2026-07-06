# Tersh Packaging And Security Boundary

## Question

What should the production CLI's security and distribution boundary be: npm package or private script, config and token storage location, TLS/self-signed certificate handling, supported platforms, and whether any server-side changes are acceptable?

## Decision

Build the CLI as an npm-package-shaped project from the start, named `tersh`, with local testing as the first consumer and npm publication as an intended distribution path.

## Package Shape

- Package name: `tersh` if available; otherwise use a scoped package such as `@txchen/tersh`.
- Binary name: `tersh`.
- Target runtime: Node 24+.
- Local development should support direct `node bin/...` use and package linking.
- Runtime dependencies should stay minimal.
- Do not use Electron or browser automation dependencies.

Initial commands:

```text
tersh login --server <url>
tersh hosts
tersh connect <host-id-or-name>
tersh logout
```

`tersh connect` should be interactive by default:

- If no host is provided, show an interactive host picker.
- If a host id/name is provided, connect directly.
- If not logged in or token is expired, prompt login first.
- Add `--no-interactive` later if script use becomes important.

## Server Boundary

V1 must work against the current Termix server without assuming any backend changes.

Do not fork or require server-side changes for v1. Optional backend hardening can be documented for later, but the CLI design must not depend on it.

Known future hardening ideas:

- id-only terminal connect path with access checking before host resolution.
- dedicated CLI token/session exchange if API-key support is desired later.

## Config And Token Storage

Store non-secret config in the OS config directory. Suggested config fields:

- `serverUrl`
- `defaultHost`
- `tls.caFile`
- `tls.insecureSkipVerify`

Store JWT/session token in the OS keychain when available.

Fallback token storage is allowed only as an explicit v1 fallback:

- use a local file with `0600` permissions
- warn clearly
- never store it inside the project/package directory

Never store:

- Termix password
- TOTP code
- SSH password
- SSH private key
- SSH key passphrase

## TLS

Default behavior must require valid HTTPS/WSS certificates.

Support self-hosted deployments explicitly:

- prefer `--ca-file <path>` for private CA/self-signed setups
- allow `--insecure-skip-tls-verify` only as an explicit per-server setting with a warning

Never silently downgrade to HTTP/WS. Plain HTTP/WS is allowed only when the configured server URL explicitly starts with `http://`.

## Platform Support

Official v1 support:

- macOS
- Linux

Windows should not be blocked in code, but should be documented as experimental until raw TTY behavior, keychain storage, and resize handling are tested there.

## Auth Failure Behavior

If token is missing or expired before host listing, prompt login.

If the WebSocket closes with auth/data-lock conditions such as `1008`, `DATA_LOCKED`, or `DATA_EXPIRED`, restore terminal state, print a clear message, and offer one re-login attempt.

Do not silently retry while the terminal is in raw mode.

