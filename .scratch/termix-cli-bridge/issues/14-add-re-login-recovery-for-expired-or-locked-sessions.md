# Add Re-Login Recovery For Expired Or Locked Sessions

Status: ready-for-agent

## Parent

.scratch/termix-cli-bridge/PRD.md

## What to build

Add a bounded recovery path for missing, expired, revoked, or data-locked Termix sessions. A user should be prompted to log in when a token is missing before host listing or connection, and should get one safe re-login attempt when the Terminal transport reports auth or data-lock failure.

This slice must restore terminal state before prompting. It should not silently retry while the terminal is in raw mode and should not loop forever on repeated auth failures.

## Acceptance criteria

- [ ] Host listing prompts for login when no usable token exists.
- [ ] Connect prompts for login when no usable token exists.
- [ ] Expired or rejected token responses from host-listing requests produce a clear login recovery path.
- [ ] WebSocket close code or terminal errors indicating auth failure, data locked, or data expired restore terminal state before any prompt.
- [ ] The CLI offers one re-login attempt for auth/data-lock Terminal transport failures.
- [ ] A successful re-login retries the intended host listing or connection once.
- [ ] A failed re-login or repeated auth/data-lock failure exits with a clear message and nonzero code.
- [ ] Recovery behavior never stores passwords, TOTP codes, or temporary pending-TOTP tokens.
- [ ] Automated tests cover missing token recovery, host-list expired token recovery, WebSocket auth/data-lock recovery, successful one-time retry, repeated failure, prompt timing after raw-mode restoration, and no infinite retry loop.

## Blocked by

- .scratch/termix-cli-bridge/issues/08-implement-login-logout-config-and-token-storage.md
- .scratch/termix-cli-bridge/issues/10-connect-directly-to-a-host-with-the-core-tty-bridge.md
