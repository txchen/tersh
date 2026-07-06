# Termix Terminal WebSocket Protocol

## Question

What exact Terminal transport protocol does a local terminal CLI need to speak to connect through Termix: WebSocket URL construction, authentication inputs, `connectToHost` payload, input/output message shapes, resize behavior, session attachment, ping/pong, disconnect semantics, and error/state messages?

## Sources

- Termix backend terminal WebSocket: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts`
- Termix React terminal client: `/Users/txchen/code/github/Termix/src/ui/features/terminal/Terminal.tsx`
- Termix terminal host config type: `/Users/txchen/code/github/Termix/src/ui/features/terminal/terminal-types.ts`
- Termix session manager: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal-session-manager.ts`
- Termix SSH auth helper: `/Users/txchen/code/github/Termix/src/backend/ssh/auth-manager.ts`
- Termix host key verifier: `/Users/txchen/code/github/Termix/src/backend/ssh/host-key-verifier.ts`
- Termix nginx proxy config: `/Users/txchen/code/github/Termix/docker/nginx.conf`

## Summary

A local Node.js CLI can speak Termix's terminal transport directly. The transport is a JSON-over-WebSocket protocol that opens a Termix backend `ssh2` shell, sends terminal input as JSON `input` messages, receives terminal output as JSON `data` messages, and forwards resize events as JSON `resize` messages.

The smallest useful CLI should:

1. Open the terminal WebSocket.
2. Authenticate with a Termix JWT accepted by the WebSocket.
3. Send `connectToHost` with terminal dimensions and a valid `hostConfig`.
4. Put the local terminal into raw mode.
5. Send every local stdin chunk as `{ "type": "input", "data": <string> }`.
6. Write every server `{ "type": "data", "data": <string> }` to stdout.
7. Send `{ "type": "resize", "data": { "cols": n, "rows": n } }` on terminal resize.
8. Handle `connected`, `sessionCreated`, `error`, `disconnected`, and `session_ended`.
9. Either implement or explicitly fail interactive prompt message types such as host-key verification, TOTP, passphrase prompts, OPKSSH, Vault, Warpgate, and tmux selection.

## WebSocket URL

The terminal backend is a standalone `ws` server listening on port `30002`; nginx maps `/ssh/websocket/` to `http://127.0.0.1:30002/`. Sources: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:107`, `/Users/txchen/code/github/Termix/docker/nginx.conf:400`.

The React client chooses among these URL forms:

- Development web: `ws://localhost:30002` or `wss://localhost:30002`, based on page protocol.
- Embedded Electron: `ws://127.0.0.1:30002?token=<jwt>`.
- Remote Electron: `ws(s)://<configured-host>/ssh/websocket/?token=<jwt>`.
- Production web: same-origin `${getBasePath()}/ssh/websocket/`, relying on cookies. Source: `/Users/txchen/code/github/Termix/src/ui/features/terminal/Terminal.tsx:940`.

For a CLI connecting to a deployed Termix server, the likely URL is:

```text
wss://<termix-host>/ssh/websocket/?token=<jwt>
```

or:

```text
ws://<termix-host>/ssh/websocket/?token=<jwt>
```

for an HTTP/self-hosted non-TLS deployment.

## WebSocket Authentication

On WebSocket connection, the backend accepts a JWT from three places, in order:

- `jwt` cookie.
- `Authorization: Bearer <token>`.
- `?token=<token>` query parameter.

It then calls `authManager.verifyJWTToken(token)` and rejects missing, invalid, or pending-TOTP JWTs with close code `1008`. It also requires `UserCrypto.getUserDataKey(userId)` to be present; if the user data key is missing, it sends `{ "type": "error", "message": "Data locked - re-authenticate with password", "code": "DATA_LOCKED" }` and closes with `1008`. Source: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:115`.

The backend repeats the data-key check before every incoming message and can send `{ "type": "error", "message": "Data access expired - please re-authenticate", "code": "DATA_EXPIRED" }` before closing with `1008`. Source: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:272`.

Implication for later auth work: this ticket confirms the terminal protocol path is JWT-based today. Whether the CLI can obtain and maintain a suitable JWT/data-key state is owned by `Determine CLI Authentication Model`.

## Client-to-Server Messages

### `connectToHost`

Starts a new SSH terminal session:

```json
{
  "type": "connectToHost",
  "data": {
    "cols": 120,
    "rows": 36,
    "hostConfig": {
      "id": 123,
      "ip": "server.example.com",
      "port": 22,
      "username": "root",
      "authType": "password"
    },
    "initialPath": "/opt/app",
    "executeCommand": "htop",
    "tmuxAttachSession": "session-name"
  }
}
```

`cols`, `rows`, and `hostConfig` are required for the normal path. `initialPath`, `executeCommand`, and `tmuxAttachSession` are optional. The backend `ConnectToHostData` shape includes `hostConfig.id`, `ip`, `port`, `username`, credential fields, jump hosts, SOCKS5 settings, port knocking, terminal config, and session logging. Source: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:41`.

Important constraint: the backend validates `username`, `ip`, and `port` before server-side host resolution. Even if `id` later resolves stored host data and credentials, the initial `hostConfig` cannot be only `{ id }`; it must include valid non-empty `username`, valid non-empty `ip`, and positive numeric `port`. Sources: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:1050`, `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:1150`.

When `id` and authenticated `userId` are present, Termix resolves stored host data and credentials server-side, including jump hosts, SOCKS5 settings, `terminalConfig`, and credentials if the frontend did not include password/key data. Source: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:1150`.

### `attachSession`

Reattaches a WebSocket to an existing backend terminal session:

```json
{
  "type": "attachSession",
  "data": {
    "sessionId": "<session-id>",
    "cols": 120,
    "rows": 36,
    "tabInstanceId": "optional-client-instance-id"
  }
}
```

If attach succeeds, the backend may replay buffered output, resize the remote PTY, then send `sessionAttached` and `connected`. Source: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:340`.

The session manager keeps a detached session alive until an idle timeout, buffers output, and supports takeover notification when another WebSocket attaches to the same live session. Sources: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal-session-manager.ts:9`, `/Users/txchen/code/github/Termix/src/backend/ssh/terminal-session-manager.ts:292`.

### `input`

Forwards terminal input to the SSH stream:

```json
{ "type": "input", "data": "ls -la\r" }
```

The React terminal sends every `onData` chunk as `input`. The backend writes tabs and escape-prefixed strings directly, and otherwise writes a UTF-8 buffer to the `ssh2` stream. Sources: `/Users/txchen/code/github/Termix/src/ui/features/terminal/Terminal.tsx:1103`, `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:539`.

### `resize`

Forwards local terminal dimensions:

```json
{ "type": "resize", "data": { "cols": 120, "rows": 36 } }
```

The backend calls `setWindow(rows, cols, rows, cols)`, updates the stored session size, and replies with `{ "type": "resized", "cols": n, "rows": n }`. Source: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:2858`.

### `ping`

Application-level ping:

```json
{ "type": "ping" }
```

The backend replies `{ "type": "pong" }`. The React client sends this every 30 seconds and closes when a previous app-level pong was not received. Sources: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:567`, `/Users/txchen/code/github/Termix/src/ui/features/terminal/Terminal.tsx:1126`.

Separately, the backend also sends WebSocket protocol ping frames every 30 seconds and terminates zombie connections if protocol pong is missing. A Node `ws` client normally replies to protocol ping frames automatically, but the CLI can still implement the JSON ping for parity. Source: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:207`.

### `disconnect`

Destroys the current backend terminal session and clears auth state:

```json
{ "type": "disconnect" }
```

Source: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:451`.

### Optional UI Messages

These are not needed for the minimal local TTY bridge unless the CLI wants parity with the web UI:

- `listSessions` returns `sessionList`.
- `get_cwd` returns `cwd`.
- `open_file_in_editor` returns `open_file_in_editor`.
- `tmux_attach` attaches to or creates a tmux session.
- `tmux_detach` detaches from the tracked tmux session.

Sources: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:427`, `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:461`, `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:490`, `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:571`.

## Server-to-Client Messages

### Terminal Data

Terminal output is always JSON:

```json
{ "type": "data", "data": "<terminal-output-string>" }
```

The backend converts `ssh2` stream `Buffer` data to UTF-8 strings, buffers it in the session manager, and sends it to the attached WebSocket. Source: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:1558`.

### Connection State

Relevant state messages:

- `connection_log`: `{ data: { stage, level, message, details? } }`.
- `sessionCreated`: `{ sessionId }`.
- `connected`: `{ message }`.
- `sessionAttached`: `{ sessionId }`.
- `sessionExpired`: `{ sessionId, message? }`.
- `sessionTakenOver`: `{ sessionId, message }`.
- `resized`: `{ cols, rows }`.
- `session_ended`: `{ code }`.
- `disconnected`: `{ message, graceful? }`.
- `error`: `{ message, code? }`.

Sources: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:1036`, `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:1541`, `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:1754`, `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:1594`, `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:2208`.

For a new session, the normal success path is: connection logs, `sessionCreated`, terminal `data` as it arrives, then `connected`. For an attach path, the backend may send buffered `data`, then `sessionAttached`, then `connected`. Sources: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:1541`, `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:376`.

### Interactive Authentication and Prompts

The web terminal supports many interactive states. A minimal CLI can start by supporting password/TOTP/host key/passphrase and rejecting the rest with a clear error, but the protocol surface is:

| Server message | Client response | Purpose |
| --- | --- | --- |
| `host_key_verification_required` with `data` | `host_key_verification_response` with `{ "action": "accept" }` or `{ "action": "reject" }` | New host key trust prompt. |
| `host_key_changed` with `data` | same as above | Changed host key trust prompt. |
| `totp_required` with `prompt` | `totp_response` with `{ "code": "123456" }` | Keyboard-interactive TOTP. |
| `totp_retry` | prompt again and send another `totp_response` | Invalid TOTP retry. |
| `password_required` with `prompt` | `password_response` with `{ "code": "<password-or-response>" }` | Keyboard-interactive password or challenge. |
| `passphrase_required` | `reconnect_with_credentials` with `keyPassword` plus `cols`, `rows`, `hostConfig` | Encrypted SSH key passphrase. |
| `auth_method_not_available` | `reconnect_with_credentials` with `password` or `sshKey` plus `cols`, `rows`, `hostConfig` | User-provided fallback credentials. |
| `warpgate_auth_required` with `url`, `securityKey`, `instructions` | `warpgate_auth_continue` | Warpgate browser confirmation. |
| `opkssh_auth_required` | `opkssh_start_auth` | Start OPKSSH browser auth. |
| `opkssh_status`, `opkssh_completed`, `opkssh_error`, `opkssh_timeout`, `opkssh_config_error` | `opkssh_browser_opened`, `opkssh_auth_completed`, or `opkssh_cancel` depending on state | OPKSSH browser auth flow. |
| `vault_auth_required` | `vault_start_auth` | Start Vault OIDC flow. |
| `vault_auth_url`, `vault_completed`, `vault_error` | `vault_auth_completed` or `vault_cancel` | Vault OIDC auth flow. |
| `tmux_sessions_available` | `tmux_attach` with `sessionName` or empty string | Auto-tmux selection. |
| `tmux_session_created`, `tmux_session_attached`, `tmux_unavailable`, `tmux_detached` | usually no response | tmux state notification. |

Sources: `/Users/txchen/code/github/Termix/src/backend/ssh/host-key-verifier.ts:348`, `/Users/txchen/code/github/Termix/src/backend/ssh/auth-manager.ts:151`, `/Users/txchen/code/github/Termix/src/backend/ssh/auth-manager.ts:201`, `/Users/txchen/code/github/Termix/src/backend/ssh/auth-manager.ts:283`, `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:709`, `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:781`, `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:898`, `/Users/txchen/code/github/Termix/src/ui/features/terminal/Terminal.tsx:3016`, `/Users/txchen/code/github/Termix/src/ui/features/terminal/Terminal.tsx:3049`.

## Minimal CLI Protocol Decision

The prototype ticket can proceed with this minimum viable protocol:

```text
connect ws(s)://<termix>/ssh/websocket/?token=<jwt>
on open:
  send connectToHost({ cols, rows, hostConfig, initialPath?, executeCommand? })
on local stdin:
  send input(data)
on local resize:
  send resize({ cols, rows })
on server data:
  write data to stdout
on server sessionCreated:
  remember sessionId if later attach is desired
on server connected:
  mark connected
on server resized:
  ignore or log
on server error/disconnected/session_ended:
  restore local TTY and exit nonzero unless the remote command/session ended intentionally
on exit:
  send disconnect if ws is still open, restore local TTY
```

The bridge should treat all incoming messages as JSON text. It should not expect raw terminal bytes from the WebSocket.

## Open Risks For Later Tickets

- `Determine CLI Authentication Model`: the terminal transport requires a JWT and unlocked Termix user data key. This research does not prove the CLI can obtain those safely.
- `Determine Host Selection Data Flow`: `connectToHost` cannot be id-only today because the backend validates `ip`, `port`, and `username` before resolving stored host data.
- `Decide Interactive Prompt UX`: advanced prompt support is wider than the minimal TTY bridge. The CLI needs a v1 support matrix before production implementation.
