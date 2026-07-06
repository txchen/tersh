# Tersh

`tersh` is a Node 24+ local terminal CLI for connecting to Termix-managed SSH hosts through a Termix server.

This package is currently scaffolded for the initial command surface. Later slices will add login, host discovery, and Terminal transport bridging.

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

The command placeholders are intentionally user-visible and exit predictably until their implementation slices land.

## Dependencies

The scaffold has no runtime dependencies and does not use Electron or browser automation.
