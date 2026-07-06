# Decide Interactive Prompt UX

Type: grilling
Status: resolved
Part of: ../map.md

## Question

Which Termix interactive states must the CLI support for the first usable version, and how should each be represented in a normal terminal: host-key verification, SSH password fallback, keyboard-interactive TOTP, encrypted key passphrases, Warpgate, OPKSSH, Vault, tmux session selection, and session takeover?

## Expected Output

A scoped UX decision for v1 behavior, including explicit exclusions and any prompts that should fail with a clear message instead of being implemented immediately.

## Answer

Resolved in [Termix CLI Interactive Prompt UX](../decisions/05-interactive-prompt-ux.md).

V1 should focus on the user's actual path: password + TOTP Termix-managed SSH connections.

Support local terminal prompts for `password_required`, `totp_required`, `totp_retry`, host-key verification and changed-host-key warnings, encrypted key passphrases, and session state messages. The CLI should pause raw TTY forwarding while prompting, write prompts to `stderr`, hide secret input, send the corresponding Termix response message, then resume raw forwarding.

Explicitly do not support manual credential fallback, browser-based Warpgate/OPKSSH/Vault flows, or tmux session selection in v1. These should fail with clear messages. For tmux specifically, the user prefers to connect normally and run `tmux attach` manually after the shell is available.
