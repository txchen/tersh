# Termix Host Selection Data Flow

## Question

How can the CLI discover and select Termix-managed SSH hosts, and does an existing authenticated API return enough host configuration for `connectToHost` without exposing credentials unnecessarily?

## Sources

- Termix UI SSH host API wrapper: `/Users/txchen/code/github/Termix/src/ui/api/ssh-host-management-api.ts`
- Termix host API routes: `/Users/txchen/code/github/Termix/src/backend/database/routes/host.ts`
- Termix host response normalizers: `/Users/txchen/code/github/Termix/src/backend/database/routes/host-normalizers.ts`
- Termix terminal WebSocket server: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts`
- Termix host resolver: `/Users/txchen/code/github/Termix/src/backend/ssh/host-resolver.ts`
- Termix UI terminal tab bridge: `/Users/txchen/code/github/Termix/src/ui/shell/tabUtils.tsx`
- Termix full-screen app wrapper: `/Users/txchen/code/github/Termix/src/ui/features/FullScreenAppWrapper.tsx`
- Termix permission manager: `/Users/txchen/code/github/Termix/src/backend/utils/permission-manager.ts`

## Summary

The existing authenticated host list endpoint is enough for a first CLI bridge. The CLI should call `GET /host/db/host`, let the user select one returned SSH-capable host, and send the selected sanitized host object as `hostConfig` in the terminal WebSocket `connectToHost` message.

The CLI should not request host export data, host password-copy data, or quick-connect data for normal Termix-managed hosts. The existing host list strips stored secrets before returning host JSON, while the terminal WebSocket can resolve credentials server-side from the host id and authenticated user.

An id-only `connectToHost` payload is still not compatible today because the WebSocket validates `username`, `ip`, and `port` before resolving the stored host. For production polish, Termix should add a small server-side host-id connection path or move resolution/access checking before validation, but this is not required to prove the CLI bridge.

## Existing Host List API

The web UI loads hosts with `sshHostApi.get("/db/host")`. The `sshHostApi` base path is `/host`, so the deployed HTTP endpoint is:

```text
GET /host/db/host
```

The request should use the same JWT from the authentication ticket, preferably as:

```text
Authorization: Bearer <jwt>
```

The route requires both JWT auth and data access. Source: `/Users/txchen/code/github/Termix/src/backend/database/routes/host.ts:1220`.

The route returns all hosts owned by the current user plus shared hosts available through direct user or role access. It selects the fields a terminal would need, including `id`, `ip`, `port`, `username`, `authType`, `credentialId`, `jumpHosts`, `terminalConfig`, SOCKS5 settings, feature flags, and sharing metadata. Sources: `/Users/txchen/code/github/Termix/src/backend/database/routes/host.ts:1248`, `/Users/txchen/code/github/Termix/src/backend/database/routes/host.ts:1324`.

Before returning JSON, the route decrypts own hosts, keeps shared host metadata, normalizes JSON fields, attempts credential-derived display resolution, and strips secrets from every host. Sources: `/Users/txchen/code/github/Termix/src/backend/database/routes/host.ts:1362`, `/Users/txchen/code/github/Termix/src/backend/database/routes/host.ts:1391`.

The stripped fields include `key`, `keyPassword`, `password`, `sudoPassword`, SOCKS5 password, remote desktop passwords, telnet password, and autostart secrets. The response preserves boolean hints like `hasKey`, `hasKeyPassword`, `hasPassword`, and `hasSudoPassword`. Source: `/Users/txchen/code/github/Termix/src/backend/database/routes/host-normalizers.ts:206`.

## Host Lookup and Selection

The CLI should use `GET /host/db/host` for both listing and lookup.

The per-host endpoint `GET /host/db/host/:id` is not equivalent because it filters by `hosts.userId === userId`; it will not return role/user-shared hosts that the list endpoint can return. Source: `/Users/txchen/code/github/Termix/src/backend/database/routes/host.ts:1442`.

Recommended selection flow:

1. Fetch `GET /host/db/host`.
2. Filter to SSH-capable terminal hosts, roughly `enableSsh !== false` and `enableTerminal !== false`.
3. Present `name`, `username`, `ip`, `port`, `folder`, `tags`, `authType`, `isShared`, and secret hints like `hasPassword` or `hasKey`.
4. Support direct `--host <id-or-name>` selection by finding the matching item in the fetched list.
5. Fail locally if the selected host lacks a non-empty `id`, `ip`, `username`, or positive `port`.

The full-screen web route follows the same broad approach: load the host list and find the host by id rather than using a special terminal host endpoint. Source: `/Users/txchen/code/github/Termix/src/ui/features/FullScreenAppWrapper.tsx:64`.

## `hostConfig` Construction

For the current backend, the CLI should send a sanitized selected host object, not only `{ id }`.

The browser terminal converts a UI host into an `SSHHost`-like object with `id`, `name`, `ip`, `port`, `username`, `authType`, optional credential fields, `credentialId`, and `terminalConfig`, then passes that as `hostConfig`. Source: `/Users/txchen/code/github/Termix/src/ui/shell/tabUtils.tsx:44`.

The terminal frontend sends:

```json
{
  "type": "connectToHost",
  "data": {
    "cols": 120,
    "rows": 36,
    "hostConfig": {}
  }
}
```

where `hostConfig` is the selected host object. Source: `/Users/txchen/code/github/Termix/src/ui/features/terminal/Terminal.tsx:1089`.

Minimum compatible CLI payload:

```json
{
  "type": "connectToHost",
  "data": {
    "cols": 120,
    "rows": 36,
    "hostConfig": {
      "id": 123,
      "name": "prod",
      "ip": "10.0.0.10",
      "port": 22,
      "username": "deploy",
      "authType": "credential",
      "credentialId": 45,
      "terminalConfig": {},
      "jumpHosts": [],
      "useSocks5": false
    }
  }
}
```

In practice, the first prototype can send the whole selected object returned by `GET /host/db/host`, after defensively deleting sensitive keys if they somehow appear:

```text
password, key, keyPassword, sudoPassword, socks5Password,
rdpPassword, vncPassword, telnetPassword,
autostartPassword, autostartKey, autostartKeyPassword
```

The CLI may add its own `instanceId` for stable session/tab identity, but it is optional for a simple one-shot bridge.

## Why Credentials Stay Server-Side

On every `connectToHost` message, the WebSocket overwrites `hostConfig.userId` with the authenticated WebSocket user id. Source: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:301`.

The WebSocket currently destructures and validates `id`, `ip`, `port`, and `username` from the client-sent `hostConfig` before resolving the stored host. Source: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:1012`.

After validation, if `id` and `userId` are present, it calls `resolveHostById(id, userId)`, then lets the resolved host override `ip`, `port`, and `username`, and fill jump hosts, SOCKS5 configuration, and terminal configuration. Source: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:1150`.

If the client did not provide `password` or `key`, the WebSocket fills `resolvedCredentials` from `resolvedHostData.password`, `resolvedHostData.key`, `resolvedHostData.keyPassword`, `resolvedHostData.keyType`, and `resolvedHostData.authType`. Source: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:1209`.

`resolveHostById` loads the host and resolves stored credentials server-side. For shared hosts, it attempts user-specific override credentials and then shared credentials for the authenticated user. Sources: `/Users/txchen/code/github/Termix/src/backend/ssh/host-resolver.ts:18`, `/Users/txchen/code/github/Termix/src/backend/ssh/host-resolver.ts:78`, `/Users/txchen/code/github/Termix/src/backend/ssh/host-resolver.ts:137`.

## Endpoint Change Decision

No backend change is required for the feasibility prototype. The current web-compatible flow is:

```text
login -> GET /host/db/host -> choose sanitized host -> WebSocket connectToHost(hostConfig)
```

However, an id-only backend path would be cleaner and safer for a production CLI:

```text
login -> GET /host/db/host -> choose host id -> WebSocket connectToHostId({ hostId, cols, rows })
```

or:

```text
login -> GET /host/db/host -> choose host id -> GET /terminal/hosts/:id/connect-config -> connectToHost(resolved safe config)
```

That backend path should:

1. Check owner/shared access with the existing permission model before connecting.
2. Resolve the host before validating `ip`, `port`, and `username`.
3. Keep stored credentials server-side.
4. Return or use only the safe terminal metadata needed by the WebSocket.

Termix already has permission helpers that can verify owner/shared host access. `checkHostAccess` delegates to `PermissionManager.canAccessHost`, and `canAccessHost` recognizes both owned hosts and current shared access records. Sources: `/Users/txchen/code/github/Termix/src/backend/ssh/host-resolver.ts:250`, `/Users/txchen/code/github/Termix/src/backend/utils/permission-manager.ts:162`.

The existing terminal WebSocket path should also be hardened to call an access check after resolving a host id and before attempting SSH. That hardening is not a blocker for a local proof-of-concept that only uses ids returned by `GET /host/db/host`, but it is the right production boundary for a CLI feature.

## Decision

Use the existing host list API for v1 host discovery and selection. The CLI should send a sanitized selected host object as `hostConfig`, because current `connectToHost` cannot accept id-only payloads. Do not fetch or store Termix host secrets locally.

Treat an id-only terminal connection path as a production hardening improvement, not as a prerequisite for proving the Node.js TTY bridge.
