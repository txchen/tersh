# Decide Packaging And Security Boundary

Type: grilling
Status: resolved
Part of: ../map.md

## Question

What should the production CLI's security and distribution boundary be: npm package or private script, config and token storage location, TLS/self-signed certificate handling, supported platforms, and whether any server-side changes are acceptable?

## Expected Output

A production direction that is specific enough to turn into implementation issues, including installation target, config persistence, credential/token handling, and supported operating systems.

## Answer

Resolved in [Tersh Packaging And Security Boundary](../decisions/06-packaging-and-security-boundary.md).

Build the CLI as an npm-package-shaped project named `tersh`, with Node 24+ as the target runtime and npm publication as an intended distribution path. Local testing should work first through direct execution or package linking.

V1 must be client-only and work against current Termix without assuming server-side changes. Store non-secret config in the OS config directory, store JWT/session tokens in OS keychain when available, and allow only an explicit `0600` file fallback with warning. Never store Termix passwords, TOTP codes, SSH passwords, private keys, or key passphrases.

Support macOS and Linux officially in v1, with Windows experimental. Require valid HTTPS/WSS by default, support `--ca-file`, allow explicit `--insecure-skip-tls-verify` with warning, and never silently downgrade to HTTP/WS.

Initial command surface: `tersh login --server <url>`, `tersh hosts`, `tersh connect <host-id-or-name>`, and `tersh logout`. `tersh connect` should be interactive by default, prompt login when needed, and offer one re-login attempt on auth/data-lock WebSocket failures.
