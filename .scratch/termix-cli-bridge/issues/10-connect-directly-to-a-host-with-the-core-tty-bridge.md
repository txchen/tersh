# Connect Directly To A Host With The Core TTY Bridge

Status: resolved

## Parent

.scratch/termix-cli-bridge/PRD.md

## What to build

Implement the first end-to-end terminal connection: `tersh connect <host-id-or-name>`. A logged-in user should be able to select a Termix-managed host by id or unambiguous name, send sanitized host metadata to the Termix Terminal transport, and interact with the remote session through the local TTY.

This slice should cover the core TTY bridge: JSON-over-WebSocket connection, `connectToHost`, raw stdin forwarding, stdout rendering, resize forwarding, ping/pong parity, lifecycle messages, clean disconnect, terminal restoration, and exit code resolution. Use the prototype as context for the bridge mechanics rather than copying it blindly: `.scratch/termix-cli-bridge/prototypes/tty-bridge/termix-tty-bridge-prototype.mjs`.

## Acceptance criteria

- [ ] `tersh connect <host-id-or-name>` fetches the host list using the stored server URL and JWT/session token.
- [ ] Host arguments resolve by id or unambiguous name; ambiguous names fail locally with a clear message.
- [ ] The selected host is validated for required terminal metadata before connection.
- [ ] The CLI sends the selected sanitized host object as `hostConfig`; it does not send only `{ id }`.
- [ ] Sensitive host fields are defensively removed from `hostConfig` before the Terminal transport connection.
- [ ] The Terminal transport URL is constructed from the configured Termix server and authenticated JWT/session token.
- [ ] On WebSocket open, the CLI sends `connectToHost` with current terminal dimensions and sanitized `hostConfig`.
- [ ] Local stdin is forwarded as Terminal transport `input` messages while the bridge owns the active session.
- [ ] Server `data` messages are written to stdout without diagnostic decoration.
- [ ] Local terminal resize events are forwarded as Terminal transport `resize` messages.
- [ ] Connection logs, diagnostics, and lifecycle messages are written to stderr.
- [ ] The bridge handles `connected`, `sessionCreated`, `sessionAttached`, `connection_log`, `resized`, `pong`, `error`, `disconnected`, and `session_ended`.
- [ ] The bridge sends `disconnect` and restores terminal state on normal exit, remote session end, WebSocket close, error, and interrupt.
- [ ] Remote session exit codes become local CLI exit codes when available.
- [ ] Automated tests use fake WebSocket and fake stream seams to cover connect payload, input forwarding, output forwarding, resize forwarding, ping/pong behavior, lifecycle handling, cleanup, terminal restoration, and exit codes.

## Blocked by

- .scratch/termix-cli-bridge/issues/08-implement-login-logout-config-and-token-storage.md
- .scratch/termix-cli-bridge/issues/09-implement-authenticated-host-listing.md
