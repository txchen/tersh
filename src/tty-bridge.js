import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";

import { sanitizeHostForTerminal } from "./host-discovery.js";
import { createNodePrompts } from "./prompts.js";
import { normalizeServerUrl, webSocketUrlForServer } from "./tls-policy.js";

const webSocketOpenReadyState = 1;
const ctrlD = "\x04";
const secretPromptMessages = {
  password_required: {
    labelFor: (message) => message.prompt ?? "Password: ",
    responseType: "password_response",
  },
  totp_required: {
    labelFor: (message) => message.prompt ?? "TOTP or backup code: ",
    responseType: "totp_response",
  },
  totp_retry: {
    labelFor: (message) => `Invalid TOTP. ${message.prompt ?? "Try again: "}`,
    responseType: "totp_response",
  },
};
const browserAuthFlows = {
  warpgate_auth_required: "Warpgate",
  opkssh_auth_required: "OPKSSH",
  opkssh_status: "OPKSSH",
  opkssh_completed: "OPKSSH",
  opkssh_error: "OPKSSH",
  opkssh_timeout: "OPKSSH",
  opkssh_config_error: "OPKSSH",
  vault_auth_required: "Vault",
  vault_auth_url: "Vault",
  vault_completed: "Vault",
  vault_error: "Vault",
};
const loginRecoveryErrorCodes = new Set(["DATA_LOCKED", "DATA_EXPIRED"]);
const webSocketPolicyViolationCloseCode = 1008;

export function terminalWebSocketUrl(serverUrl, token) {
  const url = new URL(webSocketUrlForServer(normalizeServerUrl(serverUrl), "/ssh/websocket/"));
  url.searchParams.set("token", token);
  return url.toString();
}

export class TermixTtyBridge {
  constructor({
    ws,
    hostConfig,
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
    cols = stdout.columns || 80,
    rows = stdout.rows || 24,
    pingIntervalMs = 30000,
    signalTarget = process,
    prompts = createNodePrompts({ stdin, stderr }),
  }) {
    this.ws = ws;
    this.hostConfig = sanitizeHostForTerminal(hostConfig);
    this.stdin = stdin;
    this.stdout = stdout;
    this.stderr = stderr;
    this.cols = cols;
    this.rows = rows;
    this.pingIntervalMs = pingIntervalMs;
    this.signalTarget = signalTarget;
    this.prompts = prompts;
    this.sessionId = undefined;
    this.closed = false;
    this.forwardingPaused = false;
    this.pendingPrompts = 0;
    this.promptQueue = Promise.resolve();
    this.rawModeWasSet = false;
    this.inputDecoder = new StringDecoder("utf8");
    this.exitCode = 0;
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });

    this.handleOpen = this.handleOpen.bind(this);
    this.handleMessage = this.handleMessage.bind(this);
    this.handleClose = this.handleClose.bind(this);
    this.handleError = this.handleError.bind(this);
    this.handleInput = this.handleInput.bind(this);
    this.handleResize = this.handleResize.bind(this);
    this.handleInterrupt = this.handleInterrupt.bind(this);
    this.handleLocalEnd = this.handleLocalEnd.bind(this);
  }

  start() {
    addListener(this.ws, "open", this.handleOpen);
    addListener(this.ws, "message", this.handleMessage);
    addListener(this.ws, "close", this.handleClose);
    addListener(this.ws, "error", this.handleError);

    if (this.ws.readyState === webSocketOpenReadyState) {
      this.handleOpen();
    }

    this.signalTarget.on?.("SIGWINCH", this.handleResize);
    this.signalTarget.on?.("SIGINT", this.handleInterrupt);
    this.signalTarget.on?.("SIGTERM", this.handleInterrupt);
    this.stdin.on?.("end", this.handleLocalEnd);
    return this.done;
  }

  handleOpen() {
    this.send({
      type: "connectToHost",
      data: {
        cols: this.cols,
        rows: this.rows,
        hostConfig: this.hostConfig,
      },
    });
    this.startInput();

    if (this.pingIntervalMs > 0) {
      this.pingTimer = setInterval(() => this.sendPing(), this.pingIntervalMs);
      this.pingTimer.unref?.();
    }
  }

  startInput() {
    if (this.stdin.isTTY && typeof this.stdin.setRawMode === "function") {
      this.stdin.setRawMode(true);
      this.rawModeWasSet = true;
    }
    this.stdin.resume?.();
    this.stdin.on?.("data", this.handleInput);
  }

  handleInput(chunk) {
    if (this.closed || this.forwardingPaused || !isOpen(this.ws)) {
      return;
    }

    const data = Buffer.isBuffer(chunk) ? normalizeTerminalInput(chunk, this.inputDecoder) : String(chunk);
    if (data === "") {
      return;
    }

    this.send({ type: "input", data });
    if (data === ctrlD) {
      this.finish(0);
    }
  }

  resize(cols = this.stdout.columns || this.cols, rows = this.stdout.rows || this.rows) {
    this.cols = cols;
    this.rows = rows;
    if (!this.closed && isOpen(this.ws)) {
      this.send({ type: "resize", data: { cols, rows } });
    }
  }

  sendPing() {
    if (!this.closed && isOpen(this.ws)) {
      this.send({ type: "ping" });
    }
  }

  handleResize() {
    this.resize();
  }

  handleInterrupt() {
    this.stderr.write("[termix] interrupted\n");
    this.finish(130);
  }

  handleLocalEnd() {
    this.finish(0);
  }

  handleMessage(event) {
    const raw = event?.data ?? event;
    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
    let message;

    try {
      message = JSON.parse(text);
    } catch {
      this.stderr.write(`[termix] non-json message: ${text}\n`);
      return;
    }

    switch (message.type) {
      case "data":
        this.stdout.write(message.data ?? "");
        break;
      case "sessionCreated":
      case "sessionAttached":
        this.sessionId = message.sessionId ?? this.sessionId;
        break;
      case "connected":
        this.stderr.write("[termix] connected\n");
        break;
      case "connection_log":
        if (message.data?.message) {
          this.stderr.write(`[termix:${message.data.level ?? "info"}] ${message.data.message}\n`);
        }
        break;
      case "resized":
      case "pong":
        break;
      case "password_required":
      case "totp_required":
      case "totp_retry":
        void this.handleSecretPrompt(message, secretPromptMessages[message.type]);
        break;
      case "host_key_verification_required":
        void this.handleHostKeyPrompt(message, { changed: false });
        break;
      case "host_key_changed":
        void this.handleHostKeyPrompt(message, { changed: true });
        break;
      case "passphrase_required":
        void this.handlePassphrasePrompt(message);
        break;
      case "auth_method_not_available":
        this.failUnsupportedFlow("manual credential fallback is not supported in tersh v1; configure Termix-managed credentials for this host and reconnect");
        break;
      case "tmux_sessions_available":
        this.failUnsupportedFlow("auto-tmux session selection is not supported in tersh v1; disable Termix auto-tmux for this host or connect normally and run tmux attach manually");
        break;
      case "error":
        this.stderr.write(`[termix:error] ${message.message ?? "unknown error"}\n`);
        if (isRecoverableTerminalFailure(message)) {
          this.finish(recoverableTerminalFailureResult(message.code ?? message.message ?? "terminal auth failure"));
        } else {
          this.finish(1);
        }
        break;
      case "disconnected":
        this.stderr.write(`[termix] ${message.message ?? "disconnected"}\n`);
        this.finish(message.graceful === false ? 1 : 0);
        break;
      case "sessionExpired":
        this.stderr.write(`[termix] ${message.message ?? "session expired"}\n`);
        this.finish(1);
        break;
      case "sessionTakenOver":
        this.stderr.write(`[termix] ${message.message ?? "session taken over"}\n`);
        this.finish(1);
        break;
      case "session_ended":
        this.finish(Number.isInteger(message.code) ? message.code : 0);
        break;
      default:
        if (browserAuthFlows[message.type]) {
          this.failUnsupportedFlow(`${browserAuthFlows[message.type]} browser authentication is not supported in tersh v1; use the Termix web terminal for this host`);
          break;
        }

        this.stderr.write(`[termix] unhandled message type: ${message.type}\n`);
        break;
    }
  }

  handleClose(event = {}) {
    if (event.code === webSocketPolicyViolationCloseCode || isRecoverableTerminalFailure(event)) {
      this.finish(recoverableTerminalFailureResult(event.reason ?? "terminal auth failure"));
      return;
    }

    this.finish(event.code && event.code !== 1000 ? 1 : this.exitCode);
  }

  handleError(error) {
    this.stderr.write(`[termix:error] ${error?.message ?? String(error)}\n`);
    this.finish(1);
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
  }

  failUnsupportedFlow(message) {
    this.stderr.write(`[termix] ${message}\n`);
    this.finish(1);
  }

  async handleSecretPrompt(message, { labelFor, responseType }) {
    await this.withPausedForwarding(async () => {
      const secret = await this.prompts.askSecret(labelFor(message));
      this.send({ type: responseType, data: { code: secret } });
    });
  }

  async handleHostKeyPrompt(message, { changed }) {
    await this.withPausedForwarding(async () => {
      const data = message.data ?? {};
      const details = [
        changed ? "WARNING: host key changed." : "Host key verification required.",
        data.host ? `Host: ${data.host}` : undefined,
        data.fingerprint ? `Fingerprint: ${data.fingerprint}` : undefined,
        data.keyType ? `Key type: ${data.keyType}` : undefined,
      ].filter(Boolean).join("\n");
      this.stderr.write(`${details}\n`);
      const action = await this.askHostKeyAction({ changed });
      this.send({ type: "host_key_verification_response", data: { action } });
    });
  }

  async askHostKeyAction({ changed }) {
    const answer = (await this.prompts.askText(changed ? "Type accept to continue: " : "Accept host key? (accept/reject): ")).trim().toLowerCase();
    if (answer === "accept") {
      return "accept";
    }
    if (changed || answer === "reject") {
      return "reject";
    }

    this.stderr.write("Please type accept or reject.\n");
    return this.askHostKeyAction({ changed });
  }

  async handlePassphrasePrompt(message) {
    await this.withPausedForwarding(async () => {
      const keyPassword = await this.prompts.askSecret(message.prompt ?? "SSH key passphrase: ");
      this.send({
        type: "reconnect_with_credentials",
        data: {
          keyPassword,
          cols: this.cols,
          rows: this.rows,
          hostConfig: this.hostConfig,
        },
      });
    });
  }

  async withPausedForwarding(action) {
    this.pendingPrompts += 1;
    if (this.pendingPrompts === 1) {
      this.pauseForwarding();
    }

    const promptRun = this.promptQueue.then(action);
    this.promptQueue = promptRun.catch(() => {});

    try {
      await promptRun;
    } catch (error) {
      this.stderr.write(`[termix:error] ${error?.message ?? String(error)}\n`);
      this.finish(1);
    } finally {
      this.pendingPrompts -= 1;
      if (this.pendingPrompts === 0) {
        this.resumeForwarding();
      }
    }
  }

  pauseForwarding() {
    this.forwardingPaused = true;
    if (this.rawModeWasSet) {
      this.stdin.setRawMode(false);
      this.rawModeWasSet = false;
    }
  }

  resumeForwarding() {
    if (!this.closed) {
      if (this.stdin.isTTY && typeof this.stdin.setRawMode === "function") {
        this.stdin.setRawMode(true);
        this.rawModeWasSet = true;
      }
    }
    this.forwardingPaused = false;
  }

  finish(code) {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.exitCode = code;
    clearInterval(this.pingTimer);
    this.stdin.off?.("data", this.handleInput);
    this.stdin.off?.("end", this.handleLocalEnd);
    this.stdin.pause?.();
    this.signalTarget.off?.("SIGWINCH", this.handleResize);
    this.signalTarget.off?.("SIGINT", this.handleInterrupt);
    this.signalTarget.off?.("SIGTERM", this.handleInterrupt);

    if (this.rawModeWasSet) {
      this.stdin.setRawMode(false);
      this.rawModeWasSet = false;
    }

    if (isOpen(this.ws)) {
      this.send({ type: "disconnect" });
      this.ws.close?.(1000, "client finished");
    }

    this.resolveDone(code);
  }
}

export async function startTerminalBridge({
  webSocketUrl,
  hostConfig,
  stdin,
  stdout,
  stderr,
  WebSocketImpl = globalThis.WebSocket,
}) {
  if (WebSocketImpl === undefined) {
    throw new Error("This Node runtime does not provide WebSocket support");
  }

  const ws = new WebSocketImpl(webSocketUrl);
  const bridge = new TermixTtyBridge({ ws, hostConfig, stdin, stdout, stderr });
  return bridge.start();
}

function addListener(target, event, handler) {
  if (typeof target.addEventListener === "function") {
    target.addEventListener(event, handler);
    return;
  }

  if (target instanceof EventEmitter || typeof target.on === "function") {
    target.on(event, handler);
  }
}

function isOpen(ws) {
  return ws.readyState === webSocketOpenReadyState || ws.readyState === ws.constructor?.OPEN;
}

function isRecoverableTerminalFailure(message) {
  return loginRecoveryErrorCodes.has(message.code)
    || /authentication required|data locked|data access required|data access expired|data expired/i.test(message.message ?? message.reason ?? "");
}

function recoverableTerminalFailureResult(reason) {
  return {
    exitCode: 1,
    recoverableAuthFailure: true,
    reason,
  };
}

function normalizeTerminalInput(chunk, decoder) {
  let input = "";
  let segmentStart = 0;

  for (let index = 0; index <= chunk.length - 6; index += 1) {
    if (!isLegacyMouseReportAt(chunk, index)) {
      continue;
    }

    input += decoder.write(chunk.subarray(segmentStart, index));
    input += legacyMouseReportToSgr(chunk[index + 3], chunk[index + 4], chunk[index + 5]);
    index += 5;
    segmentStart = index + 1;
  }

  input += decoder.write(chunk.subarray(segmentStart));
  return input;
}

function isLegacyMouseReportAt(chunk, index) {
  return chunk[index] === 0x1b && chunk[index + 1] === 0x5b && chunk[index + 2] === 0x4d;
}

function legacyMouseReportToSgr(buttonByte, xByte, yByte) {
  const button = buttonByte - 32;
  const x = xByte - 32;
  const y = yByte - 32;
  const suffix = (button & 3) === 3 ? "m" : "M";

  return `\x1b[<${button};${x};${y}${suffix}`;
}
