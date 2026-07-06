# Prove TTY Bridge Feasibility

Type: prototype
Status: resolved
Part of: ../map.md

## Question

Can a minimal Node.js CLI bridge a local raw TTY to Termix's Terminal transport with acceptable behavior for stdin, stdout, terminal resize, connection lifecycle, and exit handling?

## Expected Output

A throwaway prototype or protocol-level test, linked from the ticket, plus a decision on whether the approach is technically viable before production design begins.

## Answer

Resolved with [Termix TTY Bridge Prototype](../prototypes/tty-bridge/NOTES.md).

The local Node.js bridge approach is technically viable. The prototype proves the core mechanics without external dependencies: it sends `connectToHost` with terminal dimensions and sanitized `hostConfig`, forwards local stdin chunks as Termix `input` messages, writes server `data` messages to stdout, sends resize events, tracks session ids, sends `disconnect`, and resolves exit codes on session end.

Verification run:

```bash
node --check .scratch/termix-cli-bridge/prototypes/tty-bridge/termix-tty-bridge-prototype.mjs
node .scratch/termix-cli-bridge/prototypes/tty-bridge/termix-tty-bridge-prototype.mjs mock-test
```

The mock test passed. I did not run against a real Termix server because this session does not have the user's server URL, JWT, or a safe target host id. The remaining feasibility risk is live interactive behavior, not the raw TTY/WebSocket bridge itself. That risk is now owned by [Decide Interactive Prompt UX](05-decide-interactive-prompt-ux.md).
