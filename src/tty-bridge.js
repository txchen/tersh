import { EventEmitter } from "node:events";

import { sanitizeHostForTerminal } from "./host-discovery.js";
import { normalizeServerUrl, webSocketUrlForServer } from "./tls-policy.js";

const webSocketOpenReadyState = 1;

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
    this.sessionId = undefined;
    this.closed = false;
    this.rawModeWasSet = false;
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
    if (this.closed || !isOpen(this.ws)) {
      return;
    }

    const data = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    this.send({ type: "input", data });
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
      case "error":
        this.stderr.write(`[termix:error] ${message.message ?? "unknown error"}\n`);
        this.finish(1);
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
        this.stderr.write(`[termix] unhandled message type: ${message.type}\n`);
        break;
    }
  }

  handleClose(event = {}) {
    this.finish(event.code && event.code !== 1000 ? 1 : this.exitCode);
  }

  handleError(error) {
    this.stderr.write(`[termix:error] ${error?.message ?? String(error)}\n`);
    this.finish(1);
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
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
