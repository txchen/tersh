# Add Interactive Host Picker For `tersh connect`

Status: ready-for-agent

## Parent

.scratch/termix-cli-bridge/PRD.md

## What to build

Add the default interactive host selection path for `tersh connect` with no host argument. A logged-in user should be able to run `tersh connect`, choose from SSH-terminal-capable Termix hosts in a normal terminal picker, and connect through the same direct-connect path used by `tersh connect <host-id-or-name>`.

This slice should not create a separate connection implementation. It should reuse the host discovery, sanitization, validation, and TTY bridge behavior from the direct-connect slice.

## Acceptance criteria

- [ ] `tersh connect` with no host argument fetches visible SSH-terminal-capable hosts.
- [ ] The user can choose a host interactively from useful display metadata.
- [ ] The selected host connects through the same sanitized `hostConfig` and TTY bridge path as direct connect.
- [ ] Empty host lists produce a clear message and nonzero exit.
- [ ] User cancellation restores terminal state and exits predictably.
- [ ] The picker does not display or request stored host secrets.
- [ ] Automated tests cover successful picker selection, empty list behavior, cancellation, and reuse of the direct-connect path.

## Blocked by

- .scratch/termix-cli-bridge/issues/09-implement-authenticated-host-listing.md
- .scratch/termix-cli-bridge/issues/10-connect-directly-to-a-host-with-the-core-tty-bridge.md
