# Termix CLI Interactive Prompt UX

## Question

Which Termix interactive states must the CLI support for the first usable version, and how should each be represented in a normal terminal?

## Decision

V1 should optimize for the user's actual path: password + TOTP Termix-managed SSH connections from a normal local terminal.

## Supported In V1

### Password And TOTP Prompts

Support:

- `password_required` -> prompt locally with hidden input, send `password_response`.
- `totp_required` -> prompt locally with hidden input, send `totp_response`.
- `totp_retry` -> prompt again with a clear retry message, send `totp_response`.

The CLI should pause raw terminal forwarding while prompting, write prompt text to `stderr`, hide entered secrets, send only the response message to Termix, then restore raw terminal forwarding.

### Host Key Verification

Support:

- `host_key_verification_required`
- `host_key_changed`

For a new host key, show the host key details/fingerprint and ask for `accept` or `reject`.

For a changed host key, show a stronger warning and default to reject unless the user explicitly types `accept`.

Respond with:

```json
{ "type": "host_key_verification_response", "action": "accept" }
```

or:

```json
{ "type": "host_key_verification_response", "action": "reject" }
```

matching Termix's current message shape.

### Encrypted Key Passphrase

Support `passphrase_required` even though it is not the user's primary path.

Prompt locally with hidden input and reconnect with:

```json
{
  "type": "reconnect_with_credentials",
  "keyPassword": "<hidden>",
  "cols": 120,
  "rows": 36,
  "hostConfig": {}
}
```

The CLI should not persist the passphrase.

### Session State Messages

Support clear terminal messages for:

- `sessionExpired`: print that the Termix session expired and exit.
- `sessionTakenOver`: print that the session was attached elsewhere and exit.

No automatic reattach or takeover flow in v1.

## Explicitly Unsupported In V1

### Manual Credential Fallback

For `auth_method_not_available`, print a clear unsupported message and exit.

Rationale: ad hoc password/private-key fallback turns the CLI into a local secret collection path and expands the storage/security boundary. V1 should rely on Termix-managed credentials plus bounded prompts.

### Browser-Based Auth Flows

Fail clearly for:

- `warpgate_auth_required`
- `opkssh_auth_required`
- `vault_auth_required`
- associated OPKSSH/Vault browser status messages

Rationale: these require browser/callback orchestration and are not needed for the user's current password + TOTP flow.

### Tmux Session Selection

Do not implement `tmux_sessions_available` selection in v1.

If Termix sends `tmux_sessions_available`, print a clear message that CLI v1 does not support auto-tmux selection, recommend disabling Termix auto-tmux for that host or connecting normally and running `tmux attach` manually, then exit cleanly.

Rationale: the user does not need this. After connection, they can enter a tmux session manually.

## Product Shape

V1 prompt UX should be conservative:

- Never let local secrets flow into the remote PTY stream.
- Pause raw mode before local prompts and restore it after the prompt.
- Prompt on `stderr`, not `stdout`, so remote output stays clean.
- Prefer explicit exit with a useful message over partial support for complex browser or fallback flows.

