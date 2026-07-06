# Tersh

`tersh` is a Node 24+ local terminal CLI for connecting to Termix-managed SSH hosts through a Termix server.

This package supports Termix login/logout, SSH-capable host listing, and a local TTY bridge through the Termix Terminal transport.

## Runtime Support

- macOS and Linux are the v1 support targets.
- Windows is experimental for v1.
- Node.js 24 or newer is required.

## Quick Start

Run without installing:

```sh
npx @txchen/tersh --help
npx @txchen/tersh login --server https://termix.example
npx @txchen/tersh hosts
npx @txchen/tersh connect <host-id-or-name>
```

Or install globally to use the `tersh` command directly:

```sh
npm install -g @txchen/tersh
tersh --help
```

## Local Development

Run the focused command-boundary test suite:

```sh
npm test
```

Run syntax checks:

```sh
npm run check
```

## Local Execution From Source

Run the binary through Node:

```sh
node ./bin/tersh.js --help
```

Run it directly from the working tree:

```sh
./bin/tersh.js --help
```

## Local Linking From Source

Link the package into your active npm prefix:

```sh
npm link
tersh --help
```

Remove the link when finished:

```sh
npm unlink -g tersh
```

## Commands

The top-level commands are:

- `tersh login --server <url>`
- `tersh hosts`
- `tersh connect [host-id-or-name]`
- `tersh logout`

### Login

```sh
tersh login --server https://termix.example
```

Login prompts locally for username and password. If the Termix server requires TOTP, it then prompts for a TOTP or backup code. Prompts and diagnostics are written to stderr.

The login request uses Termix's native-app JWT path and stores only the final session token.

Optional TLS and storage flags:

```sh
tersh login --server https://termix.example --ca-file /path/to/ca.pem
tersh login --server https://termix.example --insecure-skip-tls-verify
tersh login --server https://termix.example --token-store file
```

HTTPS is required by default. Plain HTTP is used only when the configured server URL explicitly starts with `http://`. The file token fallback is explicit, warns on use, writes with `0600` permissions, and refuses to write token material inside the project directory.

### Logout

```sh
tersh logout
```

Logout removes stored token material and leaves non-secret server config intact.

### Hosts

```sh
tersh hosts
```

Hosts uses the stored Termix server URL and session token to call the authenticated host list API. Output includes SSH-terminal-capable hosts visible to the user, including shared hosts, and prints identifying metadata such as name, username, host, port, folder, tags, auth type, shared status, and credential hints.

Host secrets are not printed or stored locally.

### Connect

```sh
tersh connect <host-id-or-name>
```

Connect fetches the visible host list with the stored session token, resolves the argument by id or unambiguous name, validates the selected host metadata, and opens the Termix Terminal transport. Local stdin is forwarded to the remote session, remote terminal data is written to stdout, and diagnostics stay on stderr.

Run `tersh connect` without an argument to pick from the visible SSH-capable hosts interactively.

Supported terminal prompts include SSH password/challenge, TOTP retry, host-key verification, changed-host-key warnings, and encrypted SSH key passphrases. Browser-based and manual fallback flows that are outside v1 fail with clear stderr messages instead of collecting extra local secrets or opening a browser.

## Manual Live-Server Smoke Test

Live Termix access is not required for `npm test`, `npm run check`, or CI. This smoke path is optional and should be run only when a maintainer has a reachable Termix server and a safe target host.

Prerequisites:

- A reachable Termix server URL.
- A valid Termix account, including a TOTP device or backup code if the account requires TOTP.
- A non-production-critical SSH target host visible to that account.
- The target host should be safe to open, resize, run harmless commands on, and disconnect from. For first validation, avoid production-critical hosts and long-running sessions.
- For prompt validation, use hosts that intentionally exercise the desired path: password/TOTP challenge, new or changed host key, encrypted SSH key passphrase, unsupported browser-auth host, or Termix auto-tmux host.

Basic smoke flow:

```sh
tersh login --server https://termix.example
tersh hosts
tersh connect <host-id-or-name>
tersh connect
tersh logout
```

Expected observations:

- `tersh login` prompts on stderr for username/password and, when required, TOTP or backup code. It exits `0` on success and stores only the final session token.
- `tersh hosts` writes host rows to stdout and diagnostics to stderr. It should not print passwords, private keys, or copied secrets.
- `tersh connect <host-id-or-name>` opens a local terminal session. Remote terminal data appears on stdout; Termix diagnostics, lifecycle messages, and local prompts appear on stderr.
- While connected, resize the terminal window and run a harmless command such as `printf 'tersh-smoke\n'`. The session should keep working after resize.
- Disconnect with the remote shell's normal exit command, such as `exit`. The local terminal should leave raw mode cleanly. A normal remote exit should return `0`; if the remote session reports a nonzero exit code, `tersh connect` should return that code. Local interrupts or abnormal WebSocket closes should restore terminal state and exit nonzero.
- `tersh connect` without an argument should print a numbered host picker on stderr, accept a selected number, and connect to that host. Enter `q` to cancel and expect exit `130`.
- `tersh logout` removes stored token material and exits `0`.

Interactive prompt checks, where safe to exercise:

- Password/TOTP SSH challenges should pause raw forwarding, prompt locally with hidden input, and then resume the terminal session.
- Host-key verification should show the host/fingerprint details and require `accept` or `reject`; changed host keys default to rejection unless `accept` is typed.
- Encrypted SSH key passphrases should be hidden and not persisted.
- Unsupported v1 flows should fail clearly on stderr and exit nonzero: manual credential fallback, Warpgate, OPKSSH, Vault browser auth, and automatic tmux session selection. For auto-tmux, the message should recommend disabling Termix auto-tmux for that host or connecting normally and running `tmux attach` manually.
- If a stored session expires or data access is locked, `hosts` or `connect` should restore terminal state, prompt for one login recovery attempt, and retry once. Repeated failures should exit nonzero with a clear message.

TLS smoke variants:

```sh
tersh login --server https://termix.example --ca-file /path/to/private-ca.pem
tersh hosts

tersh login --server https://termix.example --insecure-skip-tls-verify
tersh hosts
```

Use `--ca-file` for private CA or self-signed deployments. Use `--insecure-skip-tls-verify` only for explicit test environments; it prints a warning and should not be used for routine production validation.

This repository does not include a live smoke helper script. If you wrap these commands locally, gate the wrapper behind explicit environment variables such as `TERSH_SMOKE_SERVER_URL` and `TERSH_SMOKE_HOST`, and never hardcode credentials, app passwords, session tokens, SSH passwords, private keys, or host secrets.

## Dependencies

The scaffold has no runtime dependencies and does not use Electron or browser automation.
