# Determine CLI Authentication Model

Type: research
Status: resolved
Part of: ../map.md

## Question

How should a CLI authenticate to Termix for terminal sessions: can it safely obtain and refresh a JWT with the required user data key behavior, can it reuse existing browser/desktop login state, or should Termix add API-key support to the terminal WebSocket?

## Expected Output

A recommendation with trade-offs, including any required Termix backend changes, token storage implications for a local CLI, and how the CLI would handle TOTP or SSO login constraints.

## Answer

Resolved in [Termix CLI Authentication Model](../research/02-cli-authentication-model.md).

Use native-style JWT login for v1. A Node CLI can `POST /users/login` with username/password and `X-Electron-App: true` to receive a JSON `token`; if TOTP is required, it should then `POST /users/totp/verify-login` with the temporary token and TOTP code, again with `X-Electron-App: true`, and store only the final JWT.

This JWT path matches Termix's current encrypted-data behavior because login unlocks the user's data key before JWT generation, and the JWT can carry a wrapped data key that `verifyJWTToken` restores before the terminal WebSocket checks data access.

Do not use API keys directly for the first CLI terminal bridge. The terminal WebSocket currently verifies JWTs directly, and existing `tmx_` API-key auth only establishes `userId`; it does not unlock or restore the user data key. Existing browser/desktop login reuse should also stay optional, because browser auth is cookie-based and desktop token storage is an implementation detail.

SSO/OIDC can be supported later with a local callback flow, but password/TOTP login is the smallest reliable auth model for the initial CLI.
