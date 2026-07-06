#!/usr/bin/env node
// PROTOTYPE - throwaway Termix terminal bridge feasibility probe.
// It intentionally avoids package dependencies so it can run from scratch.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PassThrough, Writable } from "node:stream";
import { randomUUID } from "node:crypto";

const SENSITIVE_HOST_FIELDS = new Set([
  "password",
  "key",
  "keyPassword",
  "sudoPassword",
  "socks5Password",
  "rdpPassword",
  "vncPassword",
  "telnetPassword",
  "autostartPassword",
  "autostartKey",
  "autostartKeyPassword",
]);

class TermixTtyBridge {
  constructor({
    ws,
    hostConfig,
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
    cols = stdout.columns || 80,
    rows = stdout.rows || 24,
    initialPath,
    executeCommand,
    tmuxAttachSession,
    shouldSetRawMode = Boolean(stdin.isTTY && stdin.setRawMode),
    exitOnClose = true,
  }) {
    this.ws = ws;
    this.hostConfig = sanitizeHostConfig(hostConfig);
    this.stdin = stdin;
    this.stdout = stdout;
    this.stderr = stderr;
    this.cols = cols;
    this.rows = rows;
    this.initialPath = initialPath;
    this.executeCommand = executeCommand;
    this.tmuxAttachSession = tmuxAttachSession;
    this.shouldSetRawMode = shouldSetRawMode;
    this.exitOnClose = exitOnClose;
    this.rawModeWasSet = false;
    this.startedInput = false;
    this.sessionId = null;
    this.closed = false;
    this.exitCode = 0;
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });

    this.handleOpen = this.handleOpen.bind(this);
    this.handleMessage = this.handleMessage.bind(this);
    this.handleClose = this.handleClose.bind(this);
    this.handleError = this.handleError.bind(this);
    this.handleInput = this.handleInput.bind(this);
    this.handleResizeSignal = this.handleResizeSignal.bind(this);
  }

  start() {
    addWsListener(this.ws, "open", this.handleOpen);
    addWsListener(this.ws, "message", this.handleMessage);
    addWsListener(this.ws, "close", this.handleClose);
    addWsListener(this.ws, "error", this.handleError);

    if (this.ws.readyState === WebSocket.OPEN) {
      this.handleOpen();
    }

    if (typeof process.on === "function") {
      process.on("SIGWINCH", this.handleResizeSignal);
    }

    return this.done;
  }

  handleOpen() {
    this.send({
      type: "connectToHost",
      data: {
        cols: this.cols,
        rows: this.rows,
        hostConfig: this.hostConfig,
        initialPath: this.initialPath,
        executeCommand: this.executeCommand,
        tmuxAttachSession: this.tmuxAttachSession,
      },
    });

    this.startInput();
  }

  startInput() {
    if (this.startedInput) return;
    this.startedInput = true;

    if (this.shouldSetRawMode) {
      this.stdin.setRawMode(true);
      this.rawModeWasSet = true;
    }

    this.stdin.resume?.();
    this.stdin.on("data", this.handleInput);
  }

  handleInput(chunk) {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    const data = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    this.send({ type: "input", data });
  }

  handleResizeSignal() {
    const cols = this.stdout.columns || this.cols;
    const rows = this.stdout.rows || this.rows;
    this.resize(cols, rows);
  }

  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    this.send({ type: "resize", data: { cols, rows } });
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
        this.stderr.write(`[termix] connected\n`);
        break;
      case "connection_log":
        if (message.data?.message) {
          this.stderr.write(`[termix:${message.data.level || "info"}] ${message.data.message}\n`);
        }
        break;
      case "resized":
      case "pong":
        break;
      case "error":
        this.stderr.write(`[termix:error] ${message.message || "unknown error"}\n`);
        this.finish(1);
        break;
      case "disconnected":
        this.stderr.write(`[termix] ${message.message || "disconnected"}\n`);
        this.finish(message.graceful === false ? 1 : 0);
        break;
      case "session_ended":
        this.finish(Number.isInteger(message.code) ? message.code : 0);
        break;
      default:
        this.stderr.write(`[termix] unhandled message type: ${message.type}\n`);
        break;
    }
  }

  handleClose(event) {
    const code = event?.code;
    this.finish(code && code !== 1000 ? 1 : this.exitCode);
  }

  handleError(error) {
    this.stderr.write(`[termix:error] ${error?.message || String(error)}\n`);
    this.finish(1);
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
  }

  finish(code) {
    if (this.closed) return;
    this.closed = true;
    this.exitCode = code;

    this.stdin.off?.("data", this.handleInput);
    if (this.rawModeWasSet) {
      this.stdin.setRawMode(false);
      this.rawModeWasSet = false;
    }
    if (typeof process.off === "function") {
      process.off("SIGWINCH", this.handleResizeSignal);
    }

    if (this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: "disconnect" }));
        this.ws.close(1000, "client finished");
      } catch {
        // Prototype cleanup only.
      }
    }

    this.resolveDone(code);
    if (this.exitOnClose) process.exitCode = code;
  }
}

function addWsListener(ws, event, handler) {
  if (typeof ws.addEventListener === "function") {
    ws.addEventListener(event, handler);
  } else if (typeof ws.on === "function") {
    ws.on(event, handler);
  }
}

function sanitizeHostConfig(hostConfig) {
  const clean = { ...hostConfig };
  for (const field of SENSITIVE_HOST_FIELDS) {
    delete clean[field];
  }
  if (typeof clean.id === "string") clean.id = Number.parseInt(clean.id, 10);
  if (typeof clean.port === "string") clean.port = Number.parseInt(clean.port, 10);
  if (!clean.instanceId) clean.instanceId = randomUUID();
  return clean;
}

function validateHostConfig(hostConfig) {
  if (!Number.isFinite(hostConfig.id)) throw new Error("hostConfig.id is required");
  if (!hostConfig.ip || typeof hostConfig.ip !== "string") {
    throw new Error("hostConfig.ip is required");
  }
  if (!Number.isFinite(hostConfig.port) || hostConfig.port <= 0) {
    throw new Error("hostConfig.port must be a positive number");
  }
  if (!hostConfig.username || typeof hostConfig.username !== "string") {
    throw new Error("hostConfig.username is required");
  }
}

async function loadHostConfig({ server, token, hostId, hostJson }) {
  if (hostJson) {
    const parsed = JSON.parse(await readFile(hostJson, "utf8"));
    const hostConfig = sanitizeHostConfig(parsed);
    validateHostConfig(hostConfig);
    return hostConfig;
  }

  if (!server || !token || !hostId) {
    throw new Error("connect mode requires --server, --token, and --host-id or --host-json");
  }

  const url = new URL("/host/db/host", server);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`failed to fetch hosts: HTTP ${response.status}`);
  }

  const hosts = await response.json();
  const selected = hosts.find(
    (host) => String(host.id) === String(hostId) || host.name === hostId,
  );
  if (!selected) throw new Error(`host not found: ${hostId}`);
  if (selected.enableSsh === false || selected.enableTerminal === false) {
    throw new Error(`host is not SSH-terminal enabled: ${hostId}`);
  }

  const hostConfig = sanitizeHostConfig(selected);
  validateHostConfig(hostConfig);
  return hostConfig;
}

function websocketUrl(server, token) {
  const url = new URL("/ssh/websocket/", server);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  return url.toString();
}

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  constructor() {
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.listeners = new Map();
  }

  addEventListener(event, handler) {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(handler);
    this.listeners.set(event, handlers);
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close(code = 1000, reason = "") {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close", { code, reason });
  }

  dispatch(event, payload = {}) {
    if (event === "open") this.readyState = FakeWebSocket.OPEN;
    for (const handler of this.listeners.get(event) ?? []) handler(payload);
  }

  serverMessage(message) {
    this.dispatch("message", { data: JSON.stringify(message) });
  }
}

class CaptureWritable extends Writable {
  constructor() {
    super();
    this.output = "";
    this.columns = 80;
    this.rows = 24;
  }

  _write(chunk, _encoding, callback) {
    this.output += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    callback();
  }
}

async function runMockTest() {
  globalThis.WebSocket ??= { OPEN: 1 };
  const ws = new FakeWebSocket();
  const stdin = new PassThrough();
  const stdout = new CaptureWritable();
  const stderr = new CaptureWritable();
  const hostConfig = {
    id: 7,
    name: "mock",
    ip: "127.0.0.1",
    port: 22,
    username: "tester",
    authType: "credential",
    credentialId: 9,
    password: "must-not-be-sent",
  };

  const bridge = new TermixTtyBridge({
    ws,
    hostConfig,
    stdin,
    stdout,
    stderr,
    cols: 100,
    rows: 40,
    shouldSetRawMode: false,
    exitOnClose: false,
  });

  const done = bridge.start();
  ws.dispatch("open");
  assert.equal(ws.sent[0].type, "connectToHost");
  assert.equal(ws.sent[0].data.cols, 100);
  assert.equal(ws.sent[0].data.rows, 40);
  assert.equal(ws.sent[0].data.hostConfig.id, 7);
  assert.equal(ws.sent[0].data.hostConfig.password, undefined);

  stdin.write("ls -la\r");
  assert.deepEqual(ws.sent[1], { type: "input", data: "ls -la\r" });

  bridge.resize(132, 43);
  assert.deepEqual(ws.sent[2], { type: "resize", data: { cols: 132, rows: 43 } });

  ws.serverMessage({ type: "sessionCreated", sessionId: "abc123" });
  ws.serverMessage({ type: "data", data: "remote output\r\n" });
  assert.equal(bridge.sessionId, "abc123");
  assert.equal(stdout.output, "remote output\r\n");

  ws.serverMessage({ type: "session_ended", code: 0 });
  const exitCode = await done;
  assert.equal(exitCode, 0);
  assert.equal(ws.sent.at(-1).type, "disconnect");

  process.stdout.write("mock-test passed\n");
}

async function runConnect(args) {
  if (!globalThis.WebSocket) {
    throw new Error("this Node runtime does not provide global WebSocket");
  }

  const options = parseArgs(args);
  const hostConfig = await loadHostConfig(options);
  const ws = new WebSocket(websocketUrl(options.server, options.token));
  const bridge = new TermixTtyBridge({
    ws,
    hostConfig,
    initialPath: options.initialPath,
    executeCommand: options.executeCommand,
    tmuxAttachSession: options.tmuxAttachSession,
  });

  const code = await bridge.start();
  process.exitCode = code;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    options[key] = args[index + 1];
    index += 1;
  }
  return options;
}

function printUsage() {
  process.stdout.write(`Usage:
  node termix-tty-bridge-prototype.mjs mock-test
  node termix-tty-bridge-prototype.mjs connect --server https://termix.example --token <jwt> --host-id <id-or-name>
  node termix-tty-bridge-prototype.mjs connect --server https://termix.example --token <jwt> --host-json ./host.json

This is a throwaway prototype. It stores nothing and intentionally sends host metadata without stored secret fields.
`);
}

const mode = process.argv[2];
try {
  if (mode === "mock-test") {
    await runMockTest();
  } else if (mode === "connect") {
    await runConnect(process.argv.slice(3));
  } else {
    printUsage();
    process.exitCode = mode ? 1 : 0;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
