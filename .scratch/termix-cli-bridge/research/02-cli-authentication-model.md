# Termix CLI Authentication Model

## Question

How should a CLI authenticate to Termix for terminal sessions: can it safely obtain and refresh a JWT with the required user data key behavior, can it reuse existing browser/desktop login state, or should Termix add API-key support to the terminal WebSocket?

## Sources

- Termix terminal WebSocket authentication: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts`
- Termix auth manager: `/Users/txchen/code/github/Termix/src/backend/utils/auth-manager.ts`
- Termix password and OIDC routes: `/Users/txchen/code/github/Termix/src/backend/database/routes/users.ts`
- Termix TOTP login route: `/Users/txchen/code/github/Termix/src/backend/database/routes/user-totp-routes.ts`
- Termix data unlock route: `/Users/txchen/code/github/Termix/src/backend/database/routes/user-data-access-routes.ts`
- Termix platform detection: `/Users/txchen/code/github/Termix/src/backend/utils/user-agent-parser.ts`

## Summary

The recommended v1 authentication model is: make the CLI behave like a native Termix client for login, obtain a JWT from Termix, store that JWT in the local OS credential store or a tightly permissioned local config, and pass it to the terminal WebSocket as an `Authorization: Bearer` header or `?token=` query parameter.

This works with Termix's current encrypted-data model because password login unlocks the user's data key before generating the JWT, and JWT generation embeds a wrapped copy of that data key when the key is available. Later WebSocket verification can restore the data key from the JWT before the terminal code checks `userCrypto.getUserDataKey(userId)`.

API keys should not be the v1 path. Current terminal WebSocket auth does not accept `tmx_` API keys, and existing API-key middleware only identifies a user; it does not unlock or restore the encrypted user data key needed for saved hosts and credentials.

## Recommended CLI Flow

### Password login without TOTP

1. Prompt for Termix base URL, username, password, and optional `rememberMe`.
2. `POST /users/login` with JSON `{ "username": "...", "password": "...", "rememberMe": true|false }`.
3. Send `X-Electron-App: true` so the route treats the CLI as a native app and includes `token` in the JSON response.
4. Store `response.token`.
5. Open the terminal WebSocket with that JWT.

Why this works:

- `isNativeAppRequest` returns true for `X-Electron-App: true`, and `/users/login` conditionally includes `{ token }` in the JSON response for native app requests. Sources: `/Users/txchen/code/github/Termix/src/backend/database/routes/users.ts:110`, `/Users/txchen/code/github/Termix/src/backend/database/routes/users.ts:1728`.
- Password login calls `authenticateUser` or `authenticateOIDCUser` before token generation, so successful login has an unlocked data key in memory. Source: `/Users/txchen/code/github/Termix/src/backend/database/routes/users.ts:1648`.
- `generateJWTToken` creates a session id for device-aware clients and calls `addWrappedDataKey`; `addWrappedDataKey` adds `payload.dataKeyWrap` when `userCrypto.getUserDataKey(userId)` is present. Sources: `/Users/txchen/code/github/Termix/src/backend/utils/auth-manager.ts:284`, `/Users/txchen/code/github/Termix/src/backend/utils/auth-manager.ts:340`.
- The terminal WebSocket accepts a JWT from cookie, `Authorization: Bearer`, or `?token=`, verifies it, rejects pending-TOTP tokens, and then requires an available user data key. Source: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:115`.
- `verifyJWTToken` restores the user data key from `dataKeyWrap` if the server process does not already have it unlocked. Source: `/Users/txchen/code/github/Termix/src/backend/utils/auth-manager.ts:449`.

### Password login with TOTP

1. Call `POST /users/login` as above.
2. If the response contains `requires_totp: true`, prompt for a TOTP or backup code.
3. `POST /users/totp/verify-login` with `{ "temp_token": "...", "totp_code": "...", "rememberMe": true|false }`.
4. Again send `X-Electron-App: true`.
5. Store the final `response.token`, not the temporary token.

Important details:

- `/users/login` returns a 10 minute pending-TOTP `temp_token` when the device is not trusted. Source: `/Users/txchen/code/github/Termix/src/backend/database/routes/users.ts:1673`.
- `/users/totp/verify-login` verifies the pending token, then requires the user data key to still be present in memory so it can decrypt the TOTP secret. Source: `/Users/txchen/code/github/Termix/src/backend/database/routes/user-totp-routes.ts:567`.
- After successful TOTP verification, it generates the final JWT and includes it in the JSON response for native app requests. Source: `/Users/txchen/code/github/Termix/src/backend/database/routes/user-totp-routes.ts:663`.
- The WebSocket rejects pending-TOTP JWTs, so the CLI must never try to connect using `temp_token`. Source: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:142`.

### Token lifetime and refresh

The CLI can reuse the stored JWT until it expires or the Termix session is revoked. Native/desktop-like detection also affects session duration: `X-Electron-App: true` or a `Termix-Desktop` user agent makes platform detection return `desktop`; desktop and mobile authentication sessions use a 30 day in-memory data-key duration, while web uses 24 hours. Sources: `/Users/txchen/code/github/Termix/src/backend/utils/user-agent-parser.ts:14`, `/Users/txchen/code/github/Termix/src/backend/utils/auth-manager.ts:127`.

There is a `refreshSessionToken` helper, but the route that calls it is `/unlock-data`, which requires an already-authenticated request plus a password and returns a refreshed cookie rather than a native-style JSON token. Sources: `/Users/txchen/code/github/Termix/src/backend/utils/auth-manager.ts:501`, `/Users/txchen/code/github/Termix/src/backend/database/routes/user-data-access-routes.ts:42`.

For v1, the simpler and more robust behavior is:

- On missing token, expired token, WebSocket `1008`, or `DATA_LOCKED`, run the login flow again.
- If the CLI later wants "unlock without full login", it can call `/unlock-data` and parse the `Set-Cookie` JWT, but that is not needed for a first implementation.

## Existing Browser/Desktop Login State

Reusing existing browser login state is not the right primary path:

- The browser session is stored in an HTTP-only `jwt` cookie, which a normal CLI should not try to read from browser storage.
- `/users/me/token` can return the current cookie token, but the CLI must already have a valid authenticated cookie jar to call it. Source: `/Users/txchen/code/github/Termix/src/backend/database/routes/users.ts:1843`.
- Electron stores tokens for native clients in app-controlled storage, but a CLI depending on Electron internals would be brittle and platform-specific.

Existing state can still be an optional convenience later. For example, a CLI could accept `--token`, import a token pasted from a trusted source, or run an OIDC callback flow. It should not be the core v1 auth model.

## OIDC, LDAP, and WebAuthn Constraints

Password login works for users that have a password hash. OIDC-only users cannot use `/users/login`; the route returns `403` for an OIDC user without a password hash. Source: `/Users/txchen/code/github/Termix/src/backend/database/routes/users.ts:1605`.

OIDC is technically possible but should be deferred behind password/TOTP:

- `/users/oidc/authorize` supports a `desktopCallbackPort` and records `http://127.0.0.1:<port>/oidc-callback` as the frontend callback target. Source: `/Users/txchen/code/github/Termix/src/backend/database/routes/users.ts:628`.
- The OIDC callback generates a JWT after `authenticateOIDCUser`, and when the frontend origin starts with `http://127.0.0.1:` or `termix-mobile:`, it redirects with `token=<jwt>` in the query string. Source: `/Users/txchen/code/github/Termix/src/backend/database/routes/users.ts:1453`.
- A CLI OIDC implementation would need to open a browser, listen on a local callback port, capture the redirect token, and handle provider-specific failures. That is viable but larger than the minimal terminal bridge.

LDAP password auth may also be possible in the server, but its route currently returns only success JSON and sets a cookie; it does not include a native-app JSON token in the inspected code path. If the user's Termix deployment relies on LDAP-only auth, the CLI would need either cookie parsing from that login response, a new native-token response shape, or the OIDC-style callback route.

WebAuthn/passkey login can return a token for native app requests after WebAuthn verification, but implementing WebAuthn in a terminal CLI is not a good v1 dependency. Source: `/Users/txchen/code/github/Termix/src/backend/database/routes/user-webauthn-routes.ts:465`.

## API-Key Option

Current API keys are insufficient for terminal sessions:

- HTTP middleware recognizes `tmx_` tokens and calls `handleApiKeyAuth`. Source: `/Users/txchen/code/github/Termix/src/backend/utils/auth-manager.ts:847`.
- `handleApiKeyAuth` validates the API key and sets `req.userId`, but it does not restore or unlock the user's data key. Source: `/Users/txchen/code/github/Termix/src/backend/utils/auth-manager.ts:756`.
- The terminal WebSocket bypasses HTTP auth middleware and calls `verifyJWTToken` directly, so a `tmx_` API key will fail JWT verification. Source: `/Users/txchen/code/github/Termix/src/backend/ssh/terminal.ts:142`.

If Termix wants API-key-based CLI auth later, the backend should add an explicit token exchange rather than accepting raw API keys on the terminal socket. A safer design would be:

1. CLI authenticates with `tmx_` API key plus an explicit password/data-key unlock step, or another server-approved unlock factor.
2. Backend issues a short-lived terminal JWT with `dataKeyWrap`.
3. Terminal WebSocket continues to accept only JWTs that can restore the user data key.

This preserves the existing terminal assumption: a terminal session is authorized only when both identity and encrypted data access are available.

## Decision

Use native-style JWT login for v1.

The CLI should implement password/TOTP login first, send `X-Electron-App: true`, store the returned JWT securely, and reconnect with fresh login when the JWT expires or the WebSocket reports locked data. SSO/OIDC can be a later callback-based feature. API keys should not be used directly for terminal WebSocket authentication unless Termix adds a dedicated API-key-to-terminal-JWT exchange that also handles data-key unlocking.
