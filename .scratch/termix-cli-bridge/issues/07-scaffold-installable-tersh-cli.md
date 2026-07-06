# Scaffold Installable `tersh` CLI

Status: ready-for-agent

## Parent

.scratch/termix-cli-bridge/PRD.md

## What to build

Create the first installable shape of the local terminal CLI named `tersh`. A user should be able to run the CLI locally, see the initial command surface, and run automated tests for the command boundary. This slice should establish the package, binary entrypoint, command runner, test harness, local execution/linking path, and project conventions that later slices will extend.

The CLI should target Node 24+, stay npm-package-shaped from the start, avoid Electron/browser automation dependencies, and keep runtime dependencies minimal.

## Acceptance criteria

- [ ] A Node 24+ npm-shaped package exists with a `tersh` binary entrypoint.
- [ ] The binary can be run locally through direct execution and a package-linking workflow.
- [ ] The command runner recognizes the planned top-level commands: `login`, `hosts`, `connect`, and `logout`.
- [ ] Placeholder command behavior is user-visible and exits predictably without stack traces.
- [ ] A small automated test harness exists and can test command-level stdout, stderr, and exit code behavior.
- [ ] Project documentation explains local development, local execution, linking, and test commands.
- [ ] The package does not depend on Electron or browser automation.
- [ ] macOS and Linux are documented as the v1 support target, with Windows experimental.

## Blocked by

None - can start immediately
