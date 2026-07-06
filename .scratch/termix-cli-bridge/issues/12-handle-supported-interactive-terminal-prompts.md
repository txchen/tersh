# Handle Supported Interactive Terminal Prompts

Status: ready-for-agent

## Parent

.scratch/termix-cli-bridge/PRD.md

## What to build

Support the Termix interactive prompt states needed for password/TOTP Termix-managed SSH connections from a local terminal. During an active TTY bridge, supported prompts should pause raw forwarding, write prompts to stderr, hide secret input where appropriate, send the matching Termix response message, and resume forwarding afterward.

This slice covers SSH password/challenge prompts, keyboard-interactive TOTP prompts, TOTP retry, host-key verification, changed-host-key warnings, and encrypted SSH key passphrase prompts.

## Acceptance criteria

- [ ] `password_required` pauses raw forwarding, prompts on stderr with hidden input, sends the expected password response message, and resumes forwarding.
- [ ] `totp_required` pauses raw forwarding, prompts on stderr with hidden input, sends the expected TOTP response message, and resumes forwarding.
- [ ] `totp_retry` shows a clear retry prompt, sends the expected TOTP response message, and resumes forwarding.
- [ ] `host_key_verification_required` shows host key details or fingerprint, requires explicit accept or reject, and sends the expected host-key verification response.
- [ ] `host_key_changed` shows a stronger warning, defaults to rejection unless the user explicitly accepts, and sends the expected host-key verification response.
- [ ] `passphrase_required` prompts with hidden input, sends the expected reconnect-with-credentials response shape, and does not persist the passphrase.
- [ ] Secret prompt input never reaches the remote PTY stream or stdout.
- [ ] Terminal raw mode and input listeners are restored correctly after every prompt path.
- [ ] Automated tests cover each supported prompt, secret hiding behavior, stdout preservation, stderr prompts, raw-forwarding pause/resume, and response messages sent to Termix.

## Blocked by

- .scratch/termix-cli-bridge/issues/10-connect-directly-to-a-host-with-the-core-tty-bridge.md
