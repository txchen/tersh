# Document Manual Live-Server Smoke Testing

Status: ready-for-agent

## Parent

.scratch/termix-cli-bridge/PRD.md

## What to build

Document and wire a manual smoke-test path for validating `tersh` against a reachable Termix server, valid account, and safe target host. This should not be required for normal automated tests or CI, but it should give maintainers a repeatable way to verify the full live path after deterministic tests pass.

The smoke path should cover login, host listing, direct connect, supported interactive prompts where feasible, unsupported-flow messaging where feasible, terminal resize, clean disconnect, logout, and TLS configuration.

## Acceptance criteria

- [ ] Documentation explains prerequisites for a live smoke run: reachable Termix server, valid account, safe target host, and expected host capabilities.
- [ ] Documentation identifies which commands to run for login, host listing, direct connect, optional interactive connect, logout, and TLS variants.
- [ ] The smoke path includes expected observations for terminal output, stderr diagnostics, resize behavior, disconnect behavior, and exit codes.
- [ ] The smoke path explicitly says live Termix access is not required for normal automated tests or CI.
- [ ] The smoke path includes safety notes about not using production-critical hosts for first validation.
- [ ] The smoke path covers private CA configuration and explicit insecure TLS behavior.
- [ ] Any helper script or command wrapper is optional and gated behind explicit environment/config input, with no hardcoded credentials or host secrets.

## Blocked by

- .scratch/termix-cli-bridge/issues/10-connect-directly-to-a-host-with-the-core-tty-bridge.md
- .scratch/termix-cli-bridge/issues/12-handle-supported-interactive-terminal-prompts.md
- .scratch/termix-cli-bridge/issues/13-fail-clearly-for-unsupported-v1-terminal-flows.md
- .scratch/termix-cli-bridge/issues/14-add-re-login-recovery-for-expired-or-locked-sessions.md
