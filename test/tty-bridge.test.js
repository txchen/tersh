import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, it } from "node:test";

import { TermixTtyBridge, terminalWebSocketUrl } from "../src/tty-bridge.js";

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  static CLOSED = 3;

  constructor() {
    super();
    this.readyState = 0;
    this.sent = [];
    this.closedWith = undefined;
  }

  emit(event, ...args) {
    if (event === "open") {
      this.readyState = FakeWebSocket.OPEN;
    }
    return super.emit(event, ...args);
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close(code, reason) {
    this.readyState = FakeWebSocket.CLOSED;
    this.closedWith = { code, reason };
  }

  serverMessage(message) {
    this.emit("message", JSON.stringify(message));
  }
}

class CaptureWritable extends Writable {
  constructor() {
    super();
    this.output = "";
    this.columns = 120;
    this.rows = 36;
  }

  _write(chunk, _encoding, callback) {
    this.output += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    callback();
  }
}

function bridgeFixture() {
  const ws = new FakeWebSocket();
  const stdin = new PassThrough();
  stdin.rawModes = [];
  stdin.isTTY = true;
  stdin.setRawMode = (enabled) => stdin.rawModes.push(enabled);
  const stdout = new CaptureWritable();
  const stderr = new CaptureWritable();
  const bridge = new TermixTtyBridge({
    ws,
    hostConfig: {
      id: 123,
      name: "prod",
      ip: "10.0.0.10",
      port: 22,
      username: "deploy",
      authType: "credential",
      password: "must-not-send",
    },
    stdin,
    stdout,
    stderr,
    cols: 100,
    rows: 40,
    pingIntervalMs: 0,
  });

  return { bridge, ws, stdin, stdout, stderr };
}

function signalTargetFixture() {
  const target = new EventEmitter();
  target.offCalls = [];
  const originalOff = target.off.bind(target);
  target.off = (event, handler) => {
    target.offCalls.push(event);
    return originalOff(event, handler);
  };
  return target;
}

describe("TTY bridge", () => {
  it("builds the authenticated Terminal transport URL", () => {
    assert.equal(
      terminalWebSocketUrl("https://termix.example", "jwt token"),
      "wss://termix.example/ssh/websocket/?token=jwt+token",
    );
    assert.equal(
      terminalWebSocketUrl("http://localhost:8080", "jwt"),
      "ws://localhost:8080/ssh/websocket/?token=jwt",
    );
  });

  it("sends connectToHost with dimensions and sanitized host config on open", async () => {
    const { bridge, ws, stdin } = bridgeFixture();

    bridge.start();
    ws.emit("open");

    assert.equal(ws.sent[0].type, "connectToHost");
    assert.equal(ws.sent[0].data.cols, 100);
    assert.equal(ws.sent[0].data.rows, 40);
    assert.equal(ws.sent[0].data.hostConfig.id, 123);
    assert.equal(ws.sent[0].data.hostConfig.ip, "10.0.0.10");
    assert.equal(ws.sent[0].data.hostConfig.password, undefined);
    assert.deepEqual(stdin.rawModes, [true]);

    bridge.finish(0);
    assert.deepEqual(stdin.rawModes, [true, false]);
  });

  it("forwards stdin, stdout data, resize, pings, lifecycle logs, and exit codes", async () => {
    const { bridge, ws, stdin, stdout, stderr } = bridgeFixture();
    const done = bridge.start();
    ws.emit("open");

    stdin.write("ls -la\r");
    bridge.resize(132, 43);
    bridge.sendPing();
    ws.serverMessage({ type: "sessionCreated", sessionId: "abc123" });
    ws.serverMessage({ type: "connection_log", data: { level: "info", message: "Resolving host" } });
    ws.serverMessage({ type: "data", data: "remote output\r\n" });
    ws.serverMessage({ type: "connected" });
    ws.serverMessage({ type: "pong" });
    ws.serverMessage({ type: "resized", cols: 132, rows: 43 });
    ws.serverMessage({ type: "session_ended", code: 7 });

    assert.deepEqual(ws.sent.slice(1, 4), [
      { type: "input", data: "ls -la\r" },
      { type: "resize", data: { cols: 132, rows: 43 } },
      { type: "ping" },
    ]);
    assert.equal(bridge.sessionId, "abc123");
    assert.equal(stdout.output, "remote output\r\n");
    assert.match(stderr.output, /Resolving host/);
    assert.match(stderr.output, /connected/);
    assert.equal(await done, 7);
    assert.equal(ws.sent.at(-1).type, "disconnect");
    assert.deepEqual(ws.closedWith, { code: 1000, reason: "client finished" });
  });

  it("restores terminal state on error and close", async () => {
    const { bridge, ws, stdin, stderr } = bridgeFixture();
    const done = bridge.start();
    ws.emit("open");

    ws.serverMessage({ type: "error", message: "DATA_LOCKED", code: "DATA_LOCKED" });

    assert.equal(await done, 1);
    assert.deepEqual(stdin.rawModes, [true, false]);
    assert.match(stderr.output, /DATA_LOCKED/);
  });

  it("cleans up on interrupt", async () => {
    const signalTarget = signalTargetFixture();
    const { ws, stdin, stdout, stderr } = bridgeFixture();
    const bridge = new TermixTtyBridge({
      ws,
      hostConfig: { id: 1, ip: "10.0.0.1", port: 22, username: "root" },
      stdin,
      stdout,
      stderr,
      signalTarget,
      pingIntervalMs: 0,
    });
    const done = bridge.start();
    ws.emit("open");

    signalTarget.emit("SIGINT");

    assert.equal(await done, 130);
    assert.deepEqual(stdin.rawModes, [true, false]);
    assert.equal(ws.sent.at(-1).type, "disconnect");
    assert.match(stderr.output, /interrupted/);
    assert.ok(signalTarget.offCalls.includes("SIGINT"));
    assert.ok(signalTarget.offCalls.includes("SIGTERM"));
  });

  it("cleans up on local stdin end", async () => {
    const { bridge, ws, stdin } = bridgeFixture();
    const done = bridge.start();
    ws.emit("open");

    stdin.end();

    assert.equal(await done, 0);
    assert.deepEqual(stdin.rawModes, [true, false]);
    assert.equal(ws.sent.at(-1).type, "disconnect");
  });

  it("exits clearly on expired or taken-over sessions", async () => {
    const expired = bridgeFixture();
    const expiredDone = expired.bridge.start();
    expired.ws.emit("open");
    expired.ws.serverMessage({ type: "sessionExpired", message: "expired" });

    assert.equal(await expiredDone, 1);
    assert.match(expired.stderr.output, /expired/);

    const takenOver = bridgeFixture();
    const takenOverDone = takenOver.bridge.start();
    takenOver.ws.emit("open");
    takenOver.ws.serverMessage({ type: "sessionTakenOver", message: "taken over" });

    assert.equal(await takenOverDone, 1);
    assert.match(takenOver.stderr.output, /taken over/);
  });

  it("returns nonzero on abnormal WebSocket close", async () => {
    const { bridge, ws, stdin } = bridgeFixture();
    const done = bridge.start();
    ws.emit("open");
    ws.readyState = FakeWebSocket.CLOSED;
    ws.emit("close", { code: 1008 });

    assert.equal(await done, 1);
    assert.deepEqual(stdin.rawModes, [true, false]);
  });

  it("can construct the WebSocket and start the bridge", async () => {
    const created = [];
    class ConstructorFakeWebSocket extends FakeWebSocket {
      constructor(url) {
        super();
        this.url = url;
        created.push(this);
      }
    }

    const { startTerminalBridge } = await import("../src/tty-bridge.js");
    const done = startTerminalBridge({
      webSocketUrl: "wss://termix.example/ssh/websocket/?token=jwt",
      hostConfig: { id: 1, ip: "10.0.0.1", port: 22, username: "root" },
      stdin: new PassThrough(),
      stdout: new CaptureWritable(),
      stderr: new CaptureWritable(),
      WebSocketImpl: ConstructorFakeWebSocket,
    });

    assert.equal(created[0].url, "wss://termix.example/ssh/websocket/?token=jwt");
    created[0].emit("open");
    created[0].serverMessage({ type: "session_ended", code: 0 });
    assert.equal(await done, 0);
  });

  it("handles EventTarget-style WebSocket message events", async () => {
    const listeners = new Map();
    const ws = {
      readyState: 0,
      sent: [],
      addEventListener(event, handler) {
        listeners.set(event, handler);
      },
      send(payload) {
        this.sent.push(JSON.parse(payload));
      },
      close() {
        this.readyState = 3;
      },
    };
    const stdout = new CaptureWritable();
    const bridge = new TermixTtyBridge({
      ws,
      hostConfig: { id: 1, ip: "10.0.0.1", port: 22, username: "root" },
      stdin: new PassThrough(),
      stdout,
      stderr: new CaptureWritable(),
      pingIntervalMs: 0,
    });

    const done = bridge.start();
    ws.readyState = 1;
    listeners.get("open")();
    listeners.get("message")({ data: JSON.stringify({ type: "data", data: "hello" }) });
    listeners.get("message")({ data: JSON.stringify({ type: "session_ended", code: 0 }) });

    assert.equal(stdout.output, "hello");
    assert.equal(await done, 0);
  });
});
