# Map Termix Terminal Transport Protocol

Type: research
Status: resolved
Part of: ../map.md

## Question

What exact Terminal transport protocol does a local terminal CLI need to speak to connect through Termix: WebSocket URL construction, authentication inputs, `connectToHost` payload, input/output message shapes, resize behavior, session attachment, ping/pong, disconnect semantics, and error/state messages?

## Expected Output

A Markdown research note that names the relevant Termix files and summarizes the smallest compatible client protocol for a Node.js TTY bridge.

## Answer

Resolved in [Termix Terminal WebSocket Protocol](../research/01-terminal-websocket-protocol.md).

Termix's terminal transport is JSON over WebSocket. A minimal Node.js CLI can connect to `/ssh/websocket/` with a JWT, send `connectToHost` with `cols`, `rows`, and a valid `hostConfig`, forward local raw TTY input as `input` messages, write server `data` messages to stdout, send `resize` messages on terminal resize, and handle `connected`, `sessionCreated`, `error`, `disconnected`, and `session_ended`.

The protocol is technically bridgeable, but it exposes two constraints for later tickets: the WebSocket currently requires a JWT plus an unlocked Termix user data key, and `connectToHost` cannot be id-only because `username`, `ip`, and `port` are validated before server-side host resolution.
