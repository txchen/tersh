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
});
