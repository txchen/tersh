# Termix TTY Bridge Prototype

PROTOTYPE - throwaway code for `Prove TTY Bridge Feasibility`.

## Question

Can a minimal Node.js CLI bridge a local raw TTY to Termix's terminal WebSocket transport with acceptable behavior for stdin, stdout, terminal resize, connection lifecycle, and exit handling?

## One Command

```bash
node .scratch/termix-cli-bridge/prototypes/tty-bridge/termix-tty-bridge-prototype.mjs mock-test
```

The mock test proves the local bridge mechanics without a real Termix server:

- sends `connectToHost` with `cols`, `rows`, and sanitized `hostConfig`
- deletes stored secret fields before sending host metadata
- forwards local stdin chunks as `input` messages
- forwards terminal resize as `resize`
- writes server `data` messages to stdout
- tracks session ids
- sends `disconnect` and resolves an exit code on `session_ended`

## Real Server Probe

With a valid Termix JWT and reachable server, the same script can attempt a real connection:

```bash
node .scratch/termix-cli-bridge/prototypes/tty-bridge/termix-tty-bridge-prototype.mjs connect \
  --server https://termix.example \
  --token '<jwt>' \
  --host-id 123
```

This mode uses:

- `GET /host/db/host` with `Authorization: Bearer <jwt>` to select a sanitized host
- `wss://<server>/ssh/websocket/?token=<jwt>` for the terminal WebSocket
- raw mode only when stdin is a real TTY

## Verdict

The bridge mechanics are viable. The remaining uncertainty is not the local TTY bridge; it is live-server behavior around interactive prompts, host-key prompts, and production-grade token/config storage.

