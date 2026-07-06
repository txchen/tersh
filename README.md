# Tersh

`tersh` is a Node 24+ local terminal CLI for connecting to Termix-managed SSH hosts through a Termix server.

This package currently supports Termix login/logout and the initial command surface. Later slices will add host discovery and Terminal transport bridging.

## Runtime Support

- macOS and Linux are the v1 support targets.
- Windows is experimental for v1.
- Node.js 24 or newer is required.

## Local Development

Run the focused command-boundary test suite:

```sh
npm test
```

Run syntax checks:

```sh
npm run check
```

## Local Execution

Run the binary through Node:

```sh
node ./bin/tersh.js --help
```

Run it directly from the working tree:

```sh
./bin/tersh.js --help
```

## Local Linking

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

The planned top-level commands are:

- `tersh login --server <url>`
- `tersh hosts`
- `tersh connect [host-id-or-name]`
- `tersh logout`

`tersh connect` is intentionally user-visible and exits predictably until its implementation slice lands.

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

## Dependencies

The scaffold has no runtime dependencies and does not use Electron or browser automation.
