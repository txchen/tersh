# Termix CLI Bridge Wayfinder Map

## Destination

Determine whether a Node.js local terminal CLI can connect through an existing Termix server to Termix-managed SSH hosts, and produce a concrete implementation direction or a clear "do not build this way" decision.

## Notes

- Planning effort only; do not implement the CLI as part of the map unless a later ticket explicitly calls for a prototype.
- Use `/wayfinder` when continuing this effort. Use `/research` for AFK code/API investigations and `/domain-modeling` when new project-specific terms need to be named.
- Termix source is at `/Users/txchen/code/github/Termix`.
- Current shallow finding: Termix has a backend terminal WebSocket server in `src/backend/ssh/terminal.ts` on port `30002`, and the React terminal client in `src/ui/features/terminal/Terminal.tsx` speaks JSON messages over that socket.
- Current shallow finding: normal HTTP middleware supports `tmx_` API keys, but the terminal WebSocket currently verifies JWTs directly, so CLI authentication may require either JWT acquisition/reuse or a Termix backend change.

## Decisions so far

- [Map Termix Terminal Transport Protocol](issues/01-map-terminal-websocket-protocol.md) — Termix's terminal transport is JSON-over-WebSocket and is bridgeable from a Node CLI, but the CLI must supply JWT/data-key auth and a valid non-id-only `hostConfig`.
- [Determine CLI Authentication Model](issues/02-determine-cli-authentication-model.md) — Use native-style password/TOTP JWT login for v1; do not use API keys directly unless Termix adds a data-key-aware token exchange.
- [Determine Host Selection Data Flow](issues/03-determine-host-selection-data-flow.md) — Use `GET /host/db/host` for sanitized host discovery and send the selected host object as `hostConfig`; id-only connect is a later backend hardening.
- [Prove TTY Bridge Feasibility](issues/04-prove-tty-bridge-feasibility.md) — A dependency-free Node prototype validates stdin/stdout/resize/lifecycle bridging; live interactive prompt UX remains the main open risk.
- [Decide Interactive Prompt UX](issues/05-decide-interactive-prompt-ux.md) — V1 supports password/TOTP, host-key prompts, key passphrase, and session-state messages; it fails clearly for browser auth, ad hoc credential fallback, and tmux selection.
- [Decide Packaging And Security Boundary](issues/06-decide-packaging-and-security-boundary.md) — Ship `tersh` as a Node 24+ npm-shaped CLI, client-only against current Termix, with keychain token storage, explicit TLS policy, and macOS/Linux v1 support.

## Not yet specified

- None. The way to implementation is clear enough to turn this map into build issues.

## Out of scope

- Replacing Termix's desktop or web UI.
- Building a raw SSH client that bypasses Termix-stored hosts and credentials.
- Changing the SSH target servers themselves.
