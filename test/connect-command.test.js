import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runCommand } from "../src/command-runner.js";

async function run(args, deps) {
  const stdout = [];
  const stderr = [];
  const exitCode = await runCommand(args, {
    stdout: { write: (chunk) => stdout.push(String(chunk)) },
    stderr: { write: (chunk) => stderr.push(String(chunk)) },
  }, deps);

  return { exitCode, stdout: stdout.join(""), stderr: stderr.join("") };
}

function depsForConnect(hosts, bridgeResult = 0) {
  const bridgeStarts = [];
  return {
    bridgeStarts,
    deps: {
      configStore: { load: async () => ({ serverUrl: "https://termix.example", tls: {}, tokenStorage: { type: "keychain" } }) },
      tokenStore: { get: async () => "stored.jwt" },
      hostClient: { listHosts: async () => hosts },
      startTerminalBridge: async (options) => {
        bridgeStarts.push(options);
        return bridgeResult;
      },
    },
  };
}

function connectHost() {
  return { id: 123, name: "prod", ip: "10.0.0.10", port: 22, username: "deploy" };
}

describe("tersh connect command", () => {
  it("connects to a host by id with sanitized hostConfig", async () => {
    const { deps, bridgeStarts } = depsForConnect([
      {
        id: 123,
        name: "prod",
        ip: "10.0.0.10",
        port: 22,
        username: "deploy",
        authType: "credential",
        password: "secret",
      },
    ]);

    const result = await run(["connect", "123"], deps);

    assert.equal(result.exitCode, 0);
    assert.equal(bridgeStarts.length, 1);
    assert.equal(bridgeStarts[0].webSocketUrl, "wss://termix.example/ssh/websocket/?token=stored.jwt");
    assert.equal(bridgeStarts[0].hostConfig.id, 123);
    assert.equal(bridgeStarts[0].hostConfig.ip, "10.0.0.10");
    assert.equal(bridgeStarts[0].hostConfig.password, undefined);
    assert.notDeepEqual(bridgeStarts[0].hostConfig, { id: 123 });
  });

  it("connects to a host by unambiguous name", async () => {
    const { deps, bridgeStarts } = depsForConnect([
      { id: 1, name: "dev", ip: "10.0.0.1", port: 22, username: "root" },
      { id: 2, name: "prod", ip: "10.0.0.2", port: 22, username: "deploy" },
    ]);

    const result = await run(["connect", "prod"], deps);

    assert.equal(result.exitCode, 0);
    assert.equal(bridgeStarts[0].hostConfig.id, 2);
  });

  it("fails locally on ambiguous host names", async () => {
    const { deps, bridgeStarts } = depsForConnect([
      { id: 1, name: "prod", ip: "10.0.0.1", port: 22, username: "root" },
      { id: 2, name: "prod", ip: "10.0.0.2", port: 22, username: "deploy" },
    ]);

    const result = await run(["connect", "prod"], deps);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Ambiguous host name/);
    assert.deepEqual(bridgeStarts, []);
  });

  it("validates selected host metadata before connection", async () => {
    const { deps, bridgeStarts } = depsForConnect([
      { id: 1, name: "bad", ip: "", port: 22, username: "root", enableSsh: true, enableTerminal: true },
    ]);

    deps.hostClient.listHosts = async () => [{ id: 1, name: "bad", ip: "", port: 22, username: "root" }];
    const result = await run(["connect", "bad"], deps);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Host is missing required terminal metadata/);
    assert.deepEqual(bridgeStarts, []);
  });

  it("ignores non-terminal hosts before resolving ambiguous names", async () => {
    const { deps, bridgeStarts } = depsForConnect([
      { id: 1, name: "prod", ip: "10.0.0.1", port: 3389, username: "administrator", enableSsh: false },
      { id: 2, name: "prod", ip: "10.0.0.2", port: 22, username: "deploy" },
    ]);

    const result = await run(["connect", "prod"], deps);

    assert.equal(result.exitCode, 0);
    assert.equal(bridgeStarts[0].hostConfig.id, 2);
  });

  it("prompts for a host when no connect argument is provided", async () => {
    const { deps, bridgeStarts } = depsForConnect([
      { id: 1, name: "dev", ip: "10.0.0.1", port: 22, username: "root", password: "secret" },
      { id: 2, name: "prod", ip: "10.0.0.2", port: 22, username: "deploy", tags: ["api"] },
    ]);
    const prompts = [];
    deps.prompts = {
      askText: async (label) => {
        prompts.push(label);
        return "2";
      },
    };

    const result = await run(["connect"], deps);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(prompts, ["Select host: "]);
    assert.match(result.stderr, /1\. dev/);
    assert.match(result.stderr, /2\. prod/);
    assert.doesNotMatch(result.stderr, /secret/);
    assert.equal(bridgeStarts[0].hostConfig.id, 2);
    assert.equal(bridgeStarts[0].hostConfig.password, undefined);
  });

  it("fails clearly when the interactive picker has no hosts", async () => {
    const { deps, bridgeStarts } = depsForConnect([]);

    const result = await run(["connect"], deps);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /No SSH-capable Termix hosts found/);
    assert.deepEqual(bridgeStarts, []);
  });

  it("exits predictably when the interactive picker is cancelled", async () => {
    const { deps, bridgeStarts } = depsForConnect([
      { id: 1, name: "dev", ip: "10.0.0.1", port: 22, username: "root" },
    ]);
    deps.prompts = { askText: async () => "q" };

    const result = await run(["connect"], deps);

    assert.equal(result.exitCode, 130);
    assert.match(result.stderr, /Cancelled/);
    assert.deepEqual(bridgeStarts, []);
  });

  it("prompts login and retries connect when no stored token exists", async () => {
    let loadCount = 0;
    const tokenStores = [
      { get: async () => undefined },
      { get: async () => "fresh.jwt" },
    ];
    const loginCalls = [];
    const listedTokens = [];
    const bridgeStarts = [];

    const result = await run(["connect", "123"], {
      configStore: {
        load: async () => {
          loadCount += 1;
          return { serverUrl: "https://termix.example", tls: {}, tokenStorage: { type: "keychain" } };
        },
      },
      createTokenStore: () => tokenStores.shift(),
      loginFlow: async () => {
        loginCalls.push("login");
        return 0;
      },
      hostClient: {
        listHosts: async ({ token }) => {
          listedTokens.push(token);
          return [connectHost()];
        },
      },
      startTerminalBridge: async (options) => {
        bridgeStarts.push(options);
        return 0;
      },
    });

    assert.equal(result.exitCode, 0);
    assert.equal(loadCount, 2);
    assert.deepEqual(loginCalls, ["login"]);
    assert.deepEqual(listedTokens, ["fresh.jwt"]);
    assert.equal(bridgeStarts[0].webSocketUrl, "wss://termix.example/ssh/websocket/?token=fresh.jwt");
    assert.match(result.stderr, /No stored Termix session token found/);
  });

  it("offers one login retry when connect host listing rejects the stored token", async () => {
    const tokenStores = [
      { get: async () => "expired.jwt" },
      { get: async () => "fresh.jwt" },
    ];
    const loginCalls = [];
    const listedTokens = [];
    const bridgeStarts = [];

    const result = await run(["connect", "123"], {
      configStore: { load: async () => ({ serverUrl: "https://termix.example", tls: {}, tokenStorage: { type: "keychain" } }) },
      createTokenStore: () => tokenStores.shift(),
      loginFlow: async () => {
        loginCalls.push("login");
        return 0;
      },
      hostClient: {
        listHosts: async ({ token }) => {
          listedTokens.push(token);
          if (token === "expired.jwt") {
            throw Object.assign(new Error("authentication required"), { statusCode: 401 });
          }
          return [connectHost()];
        },
      },
      startTerminalBridge: async (options) => {
        bridgeStarts.push(options);
        return 0;
      },
    });

    assert.equal(result.exitCode, 0);
    assert.deepEqual(loginCalls, ["login"]);
    assert.deepEqual(listedTokens, ["expired.jwt", "fresh.jwt"]);
    assert.equal(bridgeStarts[0].webSocketUrl, "wss://termix.example/ssh/websocket/?token=fresh.jwt");
    assert.match(result.stderr, /Stored Termix session token was rejected/);
  });

  it("offers one login retry after terminal auth recovery and retries the intended host", async () => {
    let loadCount = 0;
    const tokenStores = [
      { get: async () => "expired.jwt" },
      { get: async () => "fresh.jwt" },
    ];
    const loginCalls = [];
    const bridgeStarts = [];

    const result = await run(["connect", "123"], {
      configStore: {
        load: async () => {
          loadCount += 1;
          return { serverUrl: "https://termix.example", tls: {}, tokenStorage: { type: "keychain" } };
        },
      },
      createTokenStore: () => tokenStores.shift(),
      loginFlow: async () => {
        loginCalls.push("login");
        return 0;
      },
      hostClient: { listHosts: async () => [connectHost()] },
      startTerminalBridge: async (options) => {
        bridgeStarts.push(options);
        return bridgeStarts.length === 1
          ? { exitCode: 1, recoverableAuthFailure: true, reason: "DATA_LOCKED" }
          : 0;
      },
    });

    assert.equal(result.exitCode, 0);
    assert.equal(loadCount, 2);
    assert.deepEqual(loginCalls, ["login"]);
    assert.equal(bridgeStarts.length, 2);
    assert.equal(bridgeStarts[0].webSocketUrl, "wss://termix.example/ssh/websocket/?token=expired.jwt");
    assert.equal(bridgeStarts[1].webSocketUrl, "wss://termix.example/ssh/websocket/?token=fresh.jwt");
    assert.deepEqual(bridgeStarts.map((start) => start.hostConfig.id), [123, 123]);
    assert.match(result.stderr, /Termix terminal session requires login recovery/);
  });

  it("starts terminal recovery login after raw mode has been restored", async () => {
    const events = [];

    const result = await run(["connect", "123"], {
      configStore: { load: async () => ({ serverUrl: "https://termix.example", tls: {}, tokenStorage: { type: "keychain" } }) },
      tokenStore: { get: async () => "stored.jwt" },
      loginFlow: async () => {
        events.push("login");
        return 1;
      },
      hostClient: { listHosts: async () => [connectHost()] },
      startTerminalBridge: async () => {
        events.push("raw-restored");
        return { exitCode: 1, recoverableAuthFailure: true, reason: "DATA_LOCKED" };
      },
    });

    assert.equal(result.exitCode, 1);
    assert.deepEqual(events, ["raw-restored", "login"]);
  });

  it("exits clearly when terminal auth recovery login stores no token", async () => {
    const tokenStores = [
      { get: async () => "expired.jwt" },
      { get: async () => undefined },
    ];
    const bridgeStarts = [];

    const result = await run(["connect", "123"], {
      configStore: { load: async () => ({ serverUrl: "https://termix.example", tls: {}, tokenStorage: { type: "keychain" } }) },
      createTokenStore: () => tokenStores.shift(),
      loginFlow: async () => 0,
      hostClient: { listHosts: async () => [connectHost()] },
      startTerminalBridge: async () => {
        bridgeStarts.push("start");
        return { exitCode: 1, recoverableAuthFailure: true, reason: "DATA_LOCKED" };
      },
    });

    assert.equal(result.exitCode, 1);
    assert.deepEqual(bridgeStarts, ["start"]);
    assert.match(result.stderr, /terminal recovery failed: login did not store a session token/i);
  });

  it("exits clearly when terminal auth recovery repeats after one retry", async () => {
    const tokenStores = [
      { get: async () => "expired.jwt" },
      { get: async () => "fresh.jwt" },
    ];
    const bridgeStarts = [];

    const result = await run(["connect", "123"], {
      configStore: { load: async () => ({ serverUrl: "https://termix.example", tls: {}, tokenStorage: { type: "keychain" } }) },
      createTokenStore: () => tokenStores.shift(),
      loginFlow: async () => 0,
      hostClient: { listHosts: async () => [connectHost()] },
      startTerminalBridge: async () => {
        bridgeStarts.push("start");
        return { exitCode: 1, recoverableAuthFailure: true, reason: "DATA_EXPIRED" };
      },
    });

    assert.equal(result.exitCode, 1);
    assert.deepEqual(bridgeStarts, ["start", "start"]);
    assert.match(result.stderr, /still requires login recovery after retry/);
  });

  it("exits clearly when terminal auth recovery login fails", async () => {
    const { deps, bridgeStarts } = depsForConnect([connectHost()], { exitCode: 1, recoverableAuthFailure: true, reason: "AUTH" });
    const loginCalls = [];
    deps.loginFlow = async () => {
      loginCalls.push("login");
      return 1;
    };

    const result = await run(["connect", "123"], deps);

    assert.equal(result.exitCode, 1);
    assert.deepEqual(loginCalls, ["login"]);
    assert.equal(bridgeStarts.length, 1);
    assert.match(result.stderr, /login did not complete/);
  });
});
