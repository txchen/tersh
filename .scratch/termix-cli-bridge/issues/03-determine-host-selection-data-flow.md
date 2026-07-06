# Determine Host Selection Data Flow

Type: research
Status: resolved
Part of: ../map.md

## Question

How can the CLI discover and select Termix-managed SSH hosts, and does an existing authenticated API return enough host configuration for `connectToHost` without exposing credentials unnecessarily?

## Expected Output

A concrete data-flow recommendation for host listing, host selection, and `hostConfig` construction, including whether the CLI should send a full host object, a host id, or require a backend endpoint change.

## Answer

Resolved in [Termix Host Selection Data Flow](../research/03-host-selection-data-flow.md).

Use the existing authenticated host list API for v1: `GET /host/db/host` with the CLI's JWT. The response includes enough sanitized host metadata for host selection and terminal connection, including `id`, `ip`, `port`, `username`, `authType`, `credentialId`, jump-host settings, SOCKS5 settings, terminal config, feature flags, and shared-host metadata.

The CLI should present SSH-capable hosts from that list, let the user pick by id/name/fuzzy search, and send the selected sanitized host object as `hostConfig` in `connectToHost`. It should not use host export, password-copy, or quick-connect endpoints for Termix-managed hosts.

Do not send only `{ id }` today. The terminal WebSocket validates `username`, `ip`, and `port` before it resolves the stored host by id, so an id-only payload fails current validation. Stored credentials still stay server-side because the host list strips secrets, and the WebSocket resolves credentials from `resolveHostById` when the client omits `password` and `key`.

A production CLI would be cleaner with a new id-only server-side path that checks host access, resolves the host, validates after resolution, and keeps credentials server-side. That is a hardening improvement, not a blocker for the feasibility prototype.
