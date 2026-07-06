# Fail Clearly For Unsupported V1 Terminal Flows

Status: ready-for-agent

## Parent

.scratch/termix-cli-bridge/PRD.md

## What to build

Add explicit v1 behavior for Termix Terminal transport flows that are intentionally unsupported. When the server sends one of these states, the CLI should print a clear stderr message, restore terminal state, close the Terminal transport cleanly when possible, and exit predictably instead of hanging or partially implementing the flow.

This slice covers manual credential fallback, Warpgate, OPKSSH, Vault, tmux session selection, session expiration, and session takeover.

## Acceptance criteria

- [ ] `auth_method_not_available` fails clearly without collecting arbitrary fallback credentials locally.
- [ ] Warpgate browser-auth messages fail clearly without opening or automating a browser.
- [ ] OPKSSH browser-auth messages fail clearly without opening or automating a browser.
- [ ] Vault browser-auth messages fail clearly without opening or automating a browser.
- [ ] `tmux_sessions_available` fails clearly and recommends disabling Termix auto-tmux for the host or connecting normally and running `tmux attach` manually.
- [ ] `sessionExpired` prints a clear message, restores terminal state, and exits.
- [ ] `sessionTakenOver` prints a clear message, restores terminal state, and exits.
- [ ] Unsupported flow handling never leaves the local terminal in raw mode.
- [ ] Automated tests cover each unsupported flow, stderr output, socket cleanup, terminal restoration, and exit code behavior.

## Blocked by

- .scratch/termix-cli-bridge/issues/10-connect-directly-to-a-host-with-the-core-tty-bridge.md
