# Tersh Context

This context records vocabulary for the Termix CLI bridge investigation so future agents use the same terms consistently.

## Language

**Termix server**:
The self-hosted Termix backend instance that owns stored hosts, credentials, user sessions, and SSH brokering.
_Avoid_: desktop tool, remote server

**Local terminal CLI**:
A Node.js command-line program run from a normal terminal that connects through the Termix server instead of opening Termix's web or desktop terminal UI.
_Avoid_: desktop SSH, web terminal

**Terminal transport**:
Termix's WebSocket message protocol for terminal input, output, resize events, connection state, authentication prompts, and session attachment.
_Avoid_: SSH protocol, tunnel

**TTY bridge**:
The CLI runtime component that pipes local raw-mode stdin, stdout, stderr, and window size to and from the Terminal transport.
_Avoid_: terminal emulator
