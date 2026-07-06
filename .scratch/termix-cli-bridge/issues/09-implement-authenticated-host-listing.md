# Implement Authenticated Host Listing

Status: resolved

## Parent

.scratch/termix-cli-bridge/PRD.md

## What to build

Implement `tersh hosts` against the current Termix server. A logged-in user should be able to list Termix-managed SSH hosts visible to them, including shared hosts, without fetching or storing host secrets locally.

The CLI should use the existing authenticated host list API with the stored JWT, filter to SSH-terminal-capable hosts, display useful metadata, and preserve the Termix server as the authority for stored hosts and credentials.

## Acceptance criteria

- [ ] `tersh hosts` uses the stored server URL and JWT/session token.
- [ ] If no usable token exists, the command prompts the user to log in through the login flow rather than failing with an opaque auth error.
- [ ] The command fetches visible hosts through the existing authenticated host list API.
- [ ] The listing includes user-owned and shared hosts returned by Termix.
- [ ] The listing filters out hosts that are not SSH-terminal-capable.
- [ ] The displayed metadata is enough to identify hosts: name, username, host, port, folder or grouping information when present, tags when present, auth type, shared status, and credential hints.
- [ ] The command does not call host export, password-copy, quick-connect, or other secret-returning host endpoints.
- [ ] Automated tests cover host filtering, shared hosts, empty results, auth failure, output formatting, and no secret endpoint calls.

## Blocked by

- .scratch/termix-cli-bridge/issues/08-implement-login-logout-config-and-token-storage.md
