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

function bridgeFixture(overrides = {}) {
  const ws = new FakeWebSocket();
  const stdin = new PassThrough();
  stdin.rawModes = [];
  stdin.pauseCalls = 0;
  stdin.isTTY = true;
  stdin.setRawMode = (enabled) => stdin.rawModes.push(enabled);
  const originalPause = stdin.pause.bind(stdin);
  stdin.pause = () => {
    stdin.pauseCalls += 1;
    return originalPause();
  };
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
    ...overrides,
  });

  return { bridge, ws, stdin, stdout, stderr };
}

function promptBridgeFixture(promptAnswers) {
  const prompts = [];
  const answerPrompt = async (label) => {
    prompts.push(label);
    return promptAnswers.shift();
  };
  const { bridge, ws, stdin, stdout, stderr } = bridgeFixture({
    prompts: {
      askSecret: answerPrompt,
      askText: answerPrompt,
    },
  });

  return { bridge, ws, stdin, stdout, stderr, prompts };
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

function flushImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  const promise = new Promise((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function assertCleanShutdown({ stdin, ws }) {
  assert.deepEqual(stdin.rawModes, [true, false]);
  assert.equal(ws.sent.at(-1).type, "disconnect");
  assert.deepEqual(ws.closedWith, { code: 1000, reason: "client finished" });
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

  it("normalizes legacy mouse reporting bytes before forwarding input", async () => {
    const { bridge, ws, stdin } = bridgeFixture();
    bridge.start();
    ws.emit("open");

    stdin.write(Buffer.from([0x1b, 0x5b, 0x4d, 0x20, 0xa0, 0x25]));

    assert.equal(ws.sent[1].type, "input");
    assert.equal(ws.sent[1].data, "\x1b[<0;128;5M");
  });

  it("restores terminal state on error and close", async () => {
    const { bridge, ws, stdin, stderr } = bridgeFixture();
    const done = bridge.start();
    ws.emit("open");

    ws.serverMessage({ type: "error", message: "BROKEN", code: "BROKEN" });

    assert.equal(await done, 1);
    assert.deepEqual(stdin.rawModes, [true, false]);
    assert.match(stderr.output, /BROKEN/);
  });

  it("classifies terminal auth and data-lock failures after restoring raw mode", async () => {
    const locked = bridgeFixture();
    const lockedDone = locked.bridge.start();
    locked.ws.emit("open");
    locked.ws.serverMessage({ type: "error", message: "Data locked", code: "DATA_LOCKED" });

    assert.deepEqual(await lockedDone, { exitCode: 1, recoverableAuthFailure: true, reason: "DATA_LOCKED" });
    assert.deepEqual(locked.stdin.rawModes, [true, false]);

    const expired = bridgeFixture();
    const expiredDone = expired.bridge.start();
    expired.ws.emit("open");
    expired.ws.serverMessage({ type: "error", message: "Data expired", code: "DATA_EXPIRED" });

    assert.deepEqual(await expiredDone, { exitCode: 1, recoverableAuthFailure: true, reason: "DATA_EXPIRED" });
    assert.deepEqual(expired.stdin.rawModes, [true, false]);

    const closed = bridgeFixture();
    const closedDone = closed.bridge.start();
    closed.ws.emit("open");
    closed.ws.readyState = FakeWebSocket.CLOSED;
    closed.ws.emit("close", { code: 1008, reason: "Authentication required" });

    assert.deepEqual(await closedDone, { exitCode: 1, recoverableAuthFailure: true, reason: "Authentication required" });
    assert.deepEqual(closed.stdin.rawModes, [true, false]);
  });

  it("does not classify remote SSH authentication failures as Termix login recovery", async () => {
    const { bridge, ws, stdin, stderr } = bridgeFixture();
    const done = bridge.start();
    ws.emit("open");

    ws.serverMessage({
      type: "error",
      message: "SSH error: Authentication failed. Please check your username and password/key.",
    });

    assert.equal(await done, 1);
    assert.match(stderr.output, /SSH error: Authentication failed/);
    assert.deepEqual(stdin.rawModes, [true, false]);
  });

  it("does not classify unrelated unauthorized terminal errors as Termix login recovery", async () => {
    const { bridge, ws, stdin, stderr } = bridgeFixture();
    const done = bridge.start();
    ws.emit("open");

    ws.serverMessage({
      type: "error",
      message: "Proxy denied: unauthorized host access",
    });

    assert.equal(await done, 1);
    assert.match(stderr.output, /unauthorized host access/);
    assert.deepEqual(stdin.rawModes, [true, false]);
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

  it("forwards raw Ctrl-D without locally closing the active session", async () => {
    const { bridge, ws, stdin } = bridgeFixture();
    bridge.start();
    ws.emit("open");

    stdin.write(Buffer.from([0x04]));
    await flushImmediate();

    assert.equal(bridge.closed, false);
    assert.deepEqual(ws.sent.slice(1), [
      { type: "input", data: "\x04" },
    ]);
    assert.deepEqual(stdin.rawModes, [true]);
    assert.equal(stdin.pauseCalls, 0);

    bridge.finish(0);
  });

  it("exits after Ctrl-D when the remote shell ends the session", async () => {
    const { bridge, ws, stdin } = bridgeFixture();
    const done = bridge.start();
    ws.emit("open");

    stdin.write(Buffer.from([0x04]));
    ws.serverMessage({ type: "session_ended", code: 0 });

    assert.equal(await done, 0);
    assert.deepEqual(ws.sent.slice(1), [
      { type: "input", data: "\x04" },
      { type: "disconnect" },
    ]);
    assert.deepEqual(stdin.rawModes, [true, false]);
    assert.equal(stdin.pauseCalls, 1);
  });

  it("exits clearly on expired or taken-over sessions", async () => {
    const expired = bridgeFixture();
    const expiredDone = expired.bridge.start();
    expired.ws.emit("open");
    expired.ws.serverMessage({ type: "sessionExpired", message: "expired" });

    assert.equal(await expiredDone, 1);
    assert.match(expired.stderr.output, /expired/);
    assertCleanShutdown(expired);

    const takenOver = bridgeFixture();
    const takenOverDone = takenOver.bridge.start();
    takenOver.ws.emit("open");
    takenOver.ws.serverMessage({ type: "sessionTakenOver", message: "taken over" });

    assert.equal(await takenOverDone, 1);
    assert.match(takenOver.stderr.output, /taken over/);
    assertCleanShutdown(takenOver);
  });

  it("fails clearly for unsupported manual credential fallback without collecting credentials", async () => {
    const { bridge, ws, stdin, stderr } = bridgeFixture({
      prompts: {
        askSecret: async () => {
          throw new Error("must not prompt");
        },
        askText: async () => {
          throw new Error("must not prompt");
        },
      },
    });
    const done = bridge.start();
    ws.emit("open");

    ws.serverMessage({ type: "auth_method_not_available" });

    assert.equal(await done, 1);
    assert.match(stderr.output, /manual credential fallback/i);
    assert.match(stderr.output, /not supported/i);
    assertCleanShutdown({ stdin, ws });
  });

  it("fails clearly for unsupported browser authentication flows", async () => {
    const browserMessages = [
      ["warpgate_auth_required", /Warpgate/i],
      ["opkssh_auth_required", /OPKSSH/i],
      ["opkssh_status", /OPKSSH/i],
      ["opkssh_completed", /OPKSSH/i],
      ["opkssh_error", /OPKSSH/i],
      ["opkssh_timeout", /OPKSSH/i],
      ["opkssh_config_error", /OPKSSH/i],
      ["vault_auth_required", /Vault/i],
      ["vault_auth_url", /Vault/i],
      ["vault_completed", /Vault/i],
      ["vault_error", /Vault/i],
    ];

    for (const [type, flowName] of browserMessages) {
      const { bridge, ws, stdin, stderr } = bridgeFixture();
      const done = bridge.start();
      ws.emit("open");

      ws.serverMessage({ type });

      assert.equal(await done, 1, type);
      assert.match(stderr.output, flowName, type);
      assert.match(stderr.output, /browser authentication/i, type);
      assert.match(stderr.output, /not supported/i, type);
      assertCleanShutdown({ stdin, ws });
    }
  });

  it("fails clearly for unsupported tmux session selection with manual guidance", async () => {
    const { bridge, ws, stdin, stderr } = bridgeFixture();
    const done = bridge.start();
    ws.emit("open");

    ws.serverMessage({ type: "tmux_sessions_available", data: { sessions: ["main"] } });

    assert.equal(await done, 1);
    assert.match(stderr.output, /auto-tmux/i);
    assert.match(stderr.output, /disable/i);
    assert.match(stderr.output, /tmux attach/i);
    assertCleanShutdown({ stdin, ws });
  });

  it("returns nonzero on abnormal WebSocket close", async () => {
    const { bridge, ws, stdin } = bridgeFixture();
    const done = bridge.start();
    ws.emit("open");
    ws.readyState = FakeWebSocket.CLOSED;
    ws.emit("close", { code: 1011 });

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

  it("handles password prompts without forwarding secrets to the PTY or stdout", async () => {
    const { bridge, ws, stdin, stdout, prompts } = promptBridgeFixture(["ssh-password"]);
    bridge.start();
    ws.emit("open");

    ws.serverMessage({ type: "password_required", prompt: "Password:" });
    stdin.write("during-prompt\r");

    await flushImmediate();
    stdin.write("after-prompt\r");

    assert.deepEqual(prompts, ["Password:"]);
    assert.deepEqual(ws.sent.slice(1), [
      { type: "password_response", data: { code: "ssh-password" } },
      { type: "input", data: "after-prompt\r" },
    ]);
    assert.equal(stdout.output, "");
    assert.deepEqual(stdin.rawModes, [true, false, true]);
  });

  it("writes default secret prompts to stderr without echoing secrets", async () => {
    const { bridge, ws, stdin, stdout, stderr } = bridgeFixture();
    bridge.start();
    ws.emit("open");

    ws.serverMessage({ type: "password_required", prompt: "Password: " });
    setImmediate(() => stdin.write("ssh-password\n"));

    await flushImmediate();

    assert.match(stderr.output, /Password: /);
    assert.doesNotMatch(stderr.output, /ssh-password/);
    assert.equal(stdout.output, "");
    assert.deepEqual(ws.sent.slice(1), [{ type: "password_response", data: { code: "ssh-password" } }]);

    bridge.finish(0);
  });

  it("handles TOTP prompts and retries with hidden input", async () => {
    const { bridge, ws, stdin, stdout, prompts } = promptBridgeFixture(["123456", "654321"]);
    bridge.start();
    ws.emit("open");

    ws.serverMessage({ type: "totp_required", prompt: "TOTP:" });
    await flushImmediate();
    ws.serverMessage({ type: "totp_retry", prompt: "Try again:" });
    await flushImmediate();
    stdin.write("after-totp\r");

    assert.deepEqual(prompts, ["TOTP:", "Invalid TOTP. Try again:"]);
    assert.deepEqual(ws.sent.slice(1), [
      { type: "totp_response", data: { code: "123456" } },
      { type: "totp_response", data: { code: "654321" } },
      { type: "input", data: "after-totp\r" },
    ]);
    assert.equal(stdout.output, "");
    assert.deepEqual(stdin.rawModes, [true, false, true, false, true]);
  });

  it("keeps raw forwarding paused until overlapping prompts drain", async () => {
    const first = deferred();
    const second = deferred();
    const prompts = [];
    const { bridge, ws, stdin } = bridgeFixture({
      prompts: {
        askSecret: async (label) => {
          prompts.push(label);
          return prompts.length === 1 ? first.promise : second.promise;
        },
      },
    });
    bridge.start();
    ws.emit("open");

    ws.serverMessage({ type: "password_required", prompt: "Password:" });
    ws.serverMessage({ type: "totp_required", prompt: "TOTP:" });
    await flushImmediate();
    stdin.write("during-first\r");

    first.resolve("ssh-password");
    await flushImmediate();
    stdin.write("during-second\r");

    second.resolve("123456");
    await flushImmediate();
    stdin.write("after-prompts\r");

    assert.deepEqual(prompts, ["Password:", "TOTP:"]);
    assert.deepEqual(ws.sent.slice(1), [
      { type: "password_response", data: { code: "ssh-password" } },
      { type: "totp_response", data: { code: "123456" } },
      { type: "input", data: "after-prompts\r" },
    ]);
    assert.deepEqual(stdin.rawModes, [true, false, true]);
  });

  it("handles host key verification and changed-key rejection defaults", async () => {
    const explicit = promptBridgeFixture(["maybe", "reject"]);
    explicit.bridge.start();
    explicit.ws.emit("open");
    explicit.ws.serverMessage({
      type: "host_key_verification_required",
      data: { host: "example.com", fingerprint: "SHA256:abc" },
    });
    await flushImmediate();

    assert.match(explicit.stderr.output, /SHA256:abc/);
    assert.match(explicit.stderr.output, /Please type accept or reject/);
    assert.deepEqual(explicit.ws.sent.at(-1), { type: "host_key_verification_response", data: { action: "reject" } });
    assert.equal(explicit.stdout.output, "");
    assert.deepEqual(explicit.stdin.rawModes, [true, false, true]);

    const rejected = promptBridgeFixture([""]);
    rejected.bridge.start();
    rejected.ws.emit("open");
    rejected.ws.serverMessage({
      type: "host_key_changed",
      data: { host: "example.com", fingerprint: "SHA256:def" },
    });
    await flushImmediate();

    assert.match(rejected.stderr.output, /WARNING/);
    assert.deepEqual(rejected.ws.sent.at(-1), { type: "host_key_verification_response", data: { action: "reject" } });
    assert.equal(rejected.stdout.output, "");
    assert.deepEqual(rejected.stdin.rawModes, [true, false, true]);
  });

  it("handles encrypted key passphrase prompts without persisting the passphrase", async () => {
    const { bridge, ws, stdin, stdout, prompts } = promptBridgeFixture(["key-passphrase"]);
    bridge.start();
    ws.emit("open");

    ws.serverMessage({ type: "passphrase_required", prompt: "Key passphrase:" });
    await flushImmediate();

    assert.deepEqual(prompts, ["Key passphrase:"]);
    assert.deepEqual(ws.sent.at(-1), {
      type: "reconnect_with_credentials",
      data: {
        keyPassword: "key-passphrase",
        cols: 100,
        rows: 40,
        hostConfig: {
          id: 123,
          name: "prod",
          ip: "10.0.0.10",
          port: 22,
          username: "deploy",
          authType: "credential",
        },
      },
    });
    assert.equal(stdout.output, "");
    assert.deepEqual(stdin.rawModes, [true, false, true]);
  });
});
