# Tersh PRD

Status: ready-for-agent

## Problem Statement

Users who manage SSH hosts in Termix can connect through the Termix web or desktop terminal UI, but they cannot use those Termix-managed hosts directly from a normal local terminal. This forces them to leave their terminal workflow, duplicate host configuration in a separate SSH config, or bypass Termix's stored host, credential, sharing, and audit boundaries.

The user wants a local terminal CLI named `tersh` that connects through an existing Termix server to Termix-managed SSH hosts. The CLI must feel like a normal terminal session while preserving the Termix server as the authority for authentication, host discovery, stored credentials, and SSH brokering.

## Solution

Build `tersh` as a Node 24+ local terminal CLI. It authenticates to a Termix server with the same native-style JWT login path used by Termix native clients, stores only the resulting session token securely, lists sanitized SSH-capable hosts through the existing authenticated host API, and bridges a selected host into the user's local TTY through Termix's Terminal transport.

The first usable version should work against the current Termix server without required backend changes. It should support password and TOTP Termix login, host listing, direct or interactive host selection, local TTY bridging over JSON-over-WebSocket, terminal resize, clean disconnect, clear auth relogin behavior, and the interactive prompt states needed for password/TOTP Termix-managed SSH connections.

## User Stories

1. As a Termix user, I want to install a `tersh` CLI, so that I can connect to Termix-managed SSH hosts from my local terminal.
2. As a Termix user, I want `tersh` to work with my existing Termix server, so that I do not need to fork or modify the server before trying it.
3. As a Termix user, I want to run `tersh login --server <url>`, so that I can authenticate the CLI to a specific Termix server.
4. As a Termix user, I want `tersh login` to prompt for username and password, so that I do not expose credentials through shell history.
5. As a Termix user with TOTP enabled, I want `tersh login` to prompt for my TOTP or backup code, so that I can complete login securely.
6. As a Termix user, I want `tersh` to store only the final session token, so that my Termix password and TOTP code are never persisted.
7. As a Termix user, I want `tersh` to reject pending-TOTP tokens, so that it never tries to open a terminal with an incomplete login session.
8. As a Termix user, I want `tersh` to reuse a valid stored session token, so that I do not log in before every connection.
9. As a Termix user, I want `tersh` to prompt for login when no valid token exists, so that host listing and connection commands recover naturally.
10. As a Termix user, I want `tersh` to offer one re-login attempt after auth or data-lock terminal failures, so that expired Termix sessions are easy to fix.
11. As a Termix user, I want `tersh logout` to remove my stored session token, so that the local machine no longer has Termix access.
12. As a Termix user, I want `tersh logout` to leave non-secret server config intact, so that logging in again is convenient.
13. As a Termix user, I want `tersh hosts` to list my Termix-managed SSH hosts, so that I can discover what I can connect to.
14. As a Termix user, I want shared hosts to appear when Termix grants me access, so that CLI behavior matches the web UI's host visibility.
15. As a Termix user, I want `tersh hosts` to show useful metadata such as name, username, host, port, folder, tags, auth type, and shared status, so that I can identify the right host.
16. As a Termix user, I want `tersh hosts` to filter out hosts that cannot be used for SSH terminal sessions, so that the list contains only connectable targets.
17. As a Termix user, I want `tersh connect <host-id-or-name>` to connect directly, so that common workflows are fast.
18. As a Termix user, I want `tersh connect` without a host argument to show an interactive host picker, so that I can choose without memorizing host ids.
19. As a Termix user, I want host selection to accept ids and names, so that both precise and human-friendly invocation styles work.
20. As a Termix user, I want clear ambiguity errors when multiple hosts match a name, so that I do not connect to the wrong machine.
21. As a Termix user, I want `tersh` to use sanitized host metadata from Termix, so that stored SSH secrets remain server-side.
22. As a Termix user, I want `tersh` to defensively remove any secret host fields before opening a terminal session, so that accidental API regressions do not leak secrets through the CLI.
23. As a Termix user, I want the Termix server to resolve stored credentials during connection, so that I do not copy SSH passwords or private keys locally.
24. As a Termix user, I want the local terminal to enter raw mode during a connected session, so that full-screen programs, shells, control keys, and escape sequences behave normally.
25. As a Termix user, I want my local keystrokes to reach the remote shell, so that the session feels like SSH.
26. As a Termix user, I want remote terminal output to render on stdout, so that my terminal displays the remote shell naturally.
27. As a Termix user, I want terminal window resizes to be forwarded, so that remote programs adapt to my current terminal size.
28. As a Termix user, I want `tersh` to restore terminal state on exit, errors, interrupts, and disconnects, so that my local terminal is not left in raw mode.
29. As a Termix user, I want remote session exit codes to become local CLI exit codes when available, so that scripts and shell workflows can detect success or failure.
30. As a Termix user, I want `tersh` to send a clean disconnect when it exits, so that Termix can close the backend terminal session intentionally.
31. As a Termix user, I want connection logs and lifecycle messages to appear on stderr, so that stdout remains reserved for remote terminal output.
32. As a Termix user, I want `tersh` to handle Termix `connected`, `sessionCreated`, `disconnected`, `error`, and `session_ended` states, so that the session lifecycle is understandable and reliable.
33. As a Termix user, I want `tersh` to handle application ping/pong parity with the Termix terminal client, so that long-running sessions remain healthy.
34. As a Termix user connecting to a host that asks for an SSH password challenge, I want a hidden local prompt, so that the password does not echo or enter the remote PTY stream.
35. As a Termix user connecting to a host that asks for keyboard-interactive TOTP, I want a hidden local prompt, so that I can complete the SSH challenge safely.
36. As a Termix user who enters a wrong TOTP, I want a clear retry prompt, so that I can correct the code without restarting unnecessarily.
37. As a Termix user connecting to a new host key, I want to see the host key details or fingerprint and accept or reject explicitly, so that I can make a trust decision.
38. As a Termix user seeing a changed host key, I want a stronger warning that defaults to rejection unless I explicitly accept, so that potential host impersonation is harder to miss.
39. As a Termix user connecting with an encrypted SSH key, I want `tersh` to prompt for the key passphrase without persisting it, so that the connection can proceed within a bounded security model.
40. As a Termix user, I want local prompt handling to pause raw terminal forwarding, so that secrets typed into prompts are not sent to the remote shell.
41. As a Termix user, I want local prompts to write to stderr, so that prompt text does not corrupt command output captured from stdout.
42. As a Termix user, I want browser-based Warpgate, OPKSSH, and Vault flows to fail with clear messages in v1, so that unsupported flows do not hang or partially run.
43. As a Termix user, I want manual credential fallback to be unsupported in v1, so that `tersh` does not become a broad local secret collection tool.
44. As a Termix user, I want automatic tmux session selection to be unsupported in v1, so that the CLI stays focused on normal shell connection and I can attach manually after connecting.
45. As a Termix user, I want `sessionExpired` and `sessionTakenOver` messages to print clearly and exit, so that I understand why the local terminal session ended.
46. As a Termix user, I want valid HTTPS and WSS to be required by default, so that `tersh` does not silently weaken transport security.
47. As a self-hosted Termix user with a private CA, I want to configure a CA file, so that I can use secure TLS without disabling verification.
48. As a self-hosted Termix user in a test environment, I want an explicit insecure TLS option with a warning, so that I can debug knowingly.
49. As a self-hosted Termix user, I want plain HTTP or WS only when my configured server URL explicitly uses HTTP, so that no silent downgrade occurs.
50. As a macOS user, I want `tersh` to store tokens in the OS keychain when available, so that local session storage follows platform expectations.
51. As a Linux user, I want `tersh` to store tokens in the OS keychain or secret service when available, so that local session storage follows platform expectations.
52. As a user on a system without a usable keychain, I want an explicit `0600` token file fallback with a warning, so that I can still use the CLI while understanding the risk.
53. As a user, I want non-secret config stored in the OS config directory, so that server preferences are not mixed with package or project files.
54. As a maintainer, I want `tersh` to be npm-package-shaped from the start, so that local linking and eventual publication use the same package boundary.
55. As a maintainer, I want Node 24+ as the runtime target, so that the CLI can use modern Node capabilities without compatibility workarounds.
56. As a maintainer, I want runtime dependencies to stay minimal, so that installation and security review stay manageable.
57. As a maintainer, I want no Electron or browser automation dependency in v1, so that `tersh` remains a true local terminal CLI.
58. As a maintainer, I want macOS and Linux to be officially supported first, so that raw TTY, resize, and credential storage behavior are tested where v1 is expected to work.
59. As a maintainer, I want Windows to be experimental in v1, so that it is not blocked unnecessarily but is not over-promised.
60. As a maintainer, I want API keys excluded from v1 terminal authentication, so that the CLI does not use a credential type that cannot unlock Termix encrypted data today.
61. As a maintainer, I want browser and desktop login-state reuse excluded from the primary v1 path, so that the CLI does not depend on brittle external storage details.
62. As a maintainer, I want future API-key support to use a dedicated server exchange for terminal JWTs, so that the Terminal transport continues to require identity plus data access.
63. As a maintainer, I want future id-only host connection to be treated as backend hardening, so that v1 can ship against the current Termix protocol while documenting the cleaner path.
64. As a maintainer, I want the TTY bridge separated from command parsing and auth concerns, so that terminal behavior can be tested with fake streams and a fake WebSocket.
65. As a maintainer, I want host discovery separated from terminal connection, so that host filtering and sanitized host construction can be tested without a live WebSocket.
66. As a maintainer, I want token storage behind a small storage boundary, so that keychain and file fallback behavior can be tested without touching real credentials.
67. As a maintainer, I want command-level tests around `login`, `hosts`, `connect`, and `logout`, so that user-facing behavior is protected as the internals change.
68. As a maintainer, I want a live-server smoke path documented but not required for normal tests, so that CI can stay deterministic while manual verification remains possible.

## Implementation Decisions

- Build a Node 24+ npm-package-shaped CLI named `tersh`. Use `tersh` as the binary name, with a scoped package name only if the unscoped package name is unavailable.
- Keep the first version client-only. It must work against the current Termix server and must not require Termix backend changes.
- Initial command surface is `tersh login --server <url>`, `tersh hosts`, `tersh connect <host-id-or-name>`, and `tersh logout`.
- `tersh connect` is interactive by default. With a host argument it connects directly; without one it shows an interactive host picker. A non-interactive scripting mode can come later.
- Authenticate with native-style Termix JWT login. Send the native-app request marker when calling password login and TOTP verification so the server returns a JSON token.
- For password-only login, prompt locally for username and password, post the login request, and store only the returned final JWT.
- For TOTP login, detect the pending-TOTP response, prompt locally for a TOTP or backup code, verify it, and store only the final JWT. Never attempt Terminal transport connection with a temporary pending-TOTP token.
- Reuse the stored JWT until it is missing, expired, revoked, or rejected by the server. On missing token before host listing or connection, prompt login. On terminal auth/data-lock failure, restore terminal state and offer one re-login attempt.
- Do not use Termix API keys directly for v1 terminal authentication. Current API-key auth does not unlock or restore the user data key and the Terminal transport verifies JWTs directly.
- Do not make browser cookie reuse, desktop token import, OIDC callback login, LDAP-specific token handling, or WebAuthn a primary v1 auth path. These can be future auth expansions.
- Store non-secret config in the OS config directory. Config should include server URL, optional default host, CA file setting, and explicit insecure TLS setting.
- Store JWT/session tokens in the OS keychain when available. Permit a local file fallback only when explicit, warn clearly, enforce `0600` permissions, and never store it inside the package or project directory.
- Never persist Termix passwords, TOTP codes, SSH passwords, SSH private keys, SSH key passphrases, or other host credential secrets.
- Require valid HTTPS/WSS by default. Support a configured CA file for private CA or self-signed deployments. Allow insecure TLS verification only as an explicit setting with a warning. Never silently downgrade to HTTP/WS.
- Support macOS and Linux officially for v1. Keep Windows unblocked in code but document it as experimental until raw TTY behavior, keychain storage, and resize handling are tested there.
- Use the existing authenticated host list endpoint for host discovery. The CLI should fetch the user's visible host list with the stored JWT.
- Filter host listings to SSH-terminal-capable hosts. Present useful selection metadata including name, username, host, port, folder, tags, auth type, shared status, and credential hints.
- Resolve direct host arguments by matching id or name against the fetched list. If multiple names match, fail locally with an ambiguity message rather than guessing.
- Use the selected sanitized host object as the Terminal transport `hostConfig` in v1. Do not send only `{ id }`, because the current Terminal transport validates username, host, and port before server-side host resolution.
- Defensively remove sensitive host fields before sending `hostConfig`, even though the host list endpoint is expected to strip secrets.
- Do not call host export, password-copy, quick-connect, or other secret-returning endpoints for normal Termix-managed host connections.
- Let the Termix server resolve stored credentials, jump hosts, SOCKS5 settings, terminal config, and shared-host credential rules server-side during connection.
- Open the Terminal transport as JSON-over-WebSocket using the authenticated JWT and the Termix terminal WebSocket route.
- On WebSocket open, send `connectToHost` with current terminal `cols`, `rows`, and sanitized `hostConfig`. Optional fields such as initial path or execute command are not required for the first command surface.
- Put the local terminal into raw mode only while the TTY bridge owns an active session. Forward local stdin chunks as `input` messages and write server `data` messages to stdout.
- Forward terminal window size changes as `resize` messages and update bridge state with the current dimensions.
- Handle Terminal transport lifecycle messages: `connected`, `sessionCreated`, `sessionAttached`, `connection_log`, `resized`, `pong`, `error`, `disconnected`, `session_ended`, `sessionExpired`, and `sessionTakenOver`.
- Send JSON `ping` messages for parity with the Termix terminal client. Rely on the WebSocket implementation for protocol-level ping/pong frames.
- On local exit, remote session end, interrupt, WebSocket close, or error, remove input listeners, restore raw mode, send `disconnect` when possible, close the socket cleanly, and resolve an appropriate process exit code.
- Print diagnostics, connection logs, local prompts, warnings, and lifecycle messages to stderr. Preserve stdout for remote terminal output.
- Support local prompt handling for `password_required`, `totp_required`, and `totp_retry`. Pause raw terminal forwarding, hide secret input, send the matching response message, and resume forwarding after the prompt.
- Support host-key verification prompts. For a new host key, show fingerprint/details and ask for explicit accept or reject. For a changed host key, show a stronger warning and default to reject unless the user explicitly types accept.
- Support encrypted SSH key passphrase prompts by asking locally with hidden input and sending the current Termix reconnect-with-credentials response shape. Do not persist the passphrase.
- For `auth_method_not_available`, fail clearly in v1 rather than collecting arbitrary fallback credentials locally.
- For Warpgate, OPKSSH, Vault, and associated browser-auth status messages, fail clearly in v1 rather than attempting partial browser/callback support.
- For `tmux_sessions_available`, fail clearly in v1 and recommend disabling Termix auto-tmux for that host or connecting normally and running `tmux attach` manually after the shell is available.
- For `sessionExpired` and `sessionTakenOver`, print a clear terminal message and exit. Do not implement automatic reattach or takeover in v1.
- Future backend hardening should prefer an id-only terminal connection path or safe terminal connect-config endpoint, with access checking before host resolution and server-side credential containment. This is not a v1 dependency.
- Future API-key support should use a server-approved API-key-to-terminal-JWT exchange that also handles data-key unlock or restoration. Raw API keys should not be accepted by the Terminal transport.

## Testing Decisions

- The main test seam should be the CLI command boundary: invoke command handlers or the packaged binary with mocked Termix HTTP responses, mocked token/config storage, and a fake Terminal transport. Tests should assert user-visible behavior, requests sent to Termix, stdout/stderr output, exit codes, and persisted config/token effects.
- The highest dedicated behavioral seam should be the TTY bridge. Test it with fake WebSocket objects and fake stdin/stdout/stderr streams, following the prototype's mock test pattern. Assert `connectToHost`, `input`, `resize`, `disconnect`, stdout data forwarding, stderr lifecycle messages, session id tracking, raw-mode restoration, and exit code resolution.
- Test external behavior rather than implementation details. A good test should describe what a user, Termix server, or local terminal observes: commands sent, prompts shown, messages written, tokens stored or removed, and sockets closed.
- Add host discovery tests around the authenticated host list behavior. Cover SSH-terminal filtering, id selection, name selection, ambiguous names, shared hosts present in the list, invalid host metadata, and defensive secret stripping before `hostConfig` is sent.
- Add authentication tests for password login, TOTP login, pending-token rejection, missing-token relogin, expired-token relogin, logout token removal, and "never persist password/TOTP" behavior.
- Add token/config storage tests using a storage abstraction. Cover keychain success, explicit file fallback, `0600` permission enforcement, warning output, server URL persistence, TLS config persistence, and logout behavior.
- Add TLS URL construction tests. Cover HTTPS-to-WSS, HTTP-to-WS only when explicitly configured, CA file configuration, insecure TLS warnings, and no silent downgrade.
- Add interactive prompt tests for `password_required`, `totp_required`, `totp_retry`, `host_key_verification_required`, `host_key_changed`, and `passphrase_required`. Assert raw forwarding pauses, prompts go to stderr, secret input is hidden, the correct Termix response message is sent, and forwarding resumes afterward.
- Add unsupported prompt tests for manual credential fallback, Warpgate, OPKSSH, Vault, and tmux session selection. Assert a clear stderr message, terminal restoration, clean socket closure where applicable, and nonzero exit.
- Add lifecycle tests for `error`, `disconnected`, `session_ended`, `sessionExpired`, `sessionTakenOver`, WebSocket close codes, interrupts, and local process shutdown. Assert raw-mode restoration in every path.
- Add command-level tests for `tersh login --server <url>`, `tersh hosts`, `tersh connect <host-id-or-name>`, `tersh connect` interactive picker, and `tersh logout`.
- Because there is no existing application package or test harness in this repo yet, choose a small Node-native test setup that fits the package when it is scaffolded. The prototype's dependency-free mock test is the closest prior art for the TTY bridge seam.
- Do not require a real Termix server in normal automated tests. Provide a manual smoke-test path for a reachable Termix server, valid account, and safe target host after deterministic tests pass.

## Out of Scope

- Replacing the Termix web or desktop terminal UI.
- Building a raw SSH client that bypasses Termix-managed hosts and credentials.
- Changing SSH target servers.
- Required Termix backend changes for v1.
- Direct API-key terminal authentication.
- Browser cookie scraping or reliance on existing desktop app token storage.
- OIDC, LDAP-specific token workarounds, WebAuthn, Warpgate, OPKSSH, and Vault browser/callback flows.
- Manual ad hoc SSH credential fallback in the CLI.
- Automatic tmux session selection.
- Automatic session reattach, takeover, or multi-tab session management.
- Windows as an officially supported platform in v1.
- Storing SSH passwords, private keys, key passphrases, Termix passwords, or TOTP codes locally.
- Host export, password-copy, quick-connect, or other secret-returning Termix host endpoints.
- npm publication automation beyond shaping the package for eventual publication.

## Further Notes

- The wayfinder map now says the implementation path is clear enough to build: JSON-over-WebSocket Terminal transport, native-style JWT login, sanitized host discovery, dependency-free TTY bridge feasibility, conservative prompt UX, and client-only npm-shaped packaging.
- The main remaining live risk is not protocol feasibility. It is live-server behavior around supported interactive prompts, host-key prompts, and production-grade token/config storage across macOS and Linux.
- The TTY bridge prototype proved the core mechanics with fake streams and a fake WebSocket: connect payload, secret stripping, input forwarding, resize forwarding, output forwarding, session id tracking, disconnect, and exit code resolution.
- Keep the vocabulary consistent: Termix server, local terminal CLI, Terminal transport, and TTY bridge.
