import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { JsonConfigStore } from "../src/config-store.js";
import { FileTokenStore } from "../src/token-storage.js";

describe("file token fallback", () => {
  it("stores token material outside the project with 0600 permissions", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "tersh-token-test-"));
    const store = new FileTokenStore({ configDir });

    await store.set("final.jwt");

    assert.equal(await store.get(), "final.jwt");
    assert.equal(await readFile(join(configDir, "token"), "utf8"), "final.jwt");
    assert.equal((await stat(join(configDir, "token"))).mode & 0o777, 0o600);
    assert.notEqual(configDir, process.cwd());
  });

  it("refuses to store token material inside the project directory", async () => {
    const store = new FileTokenStore({ configDir: join(process.cwd(), ".tersh-test") });

    await assert.rejects(
      () => store.set("final.jwt"),
      /Refusing to store token material inside the project directory/,
    );
  });
});

describe("JSON config store", () => {
  it("persists non-secret config in the configured OS config directory", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "tersh-config-test-"));
    const store = new JsonConfigStore({ configDir });
    const config = {
      serverUrl: "https://termix.example",
      tls: { caFile: "/tmp/ca.pem", insecureSkipVerify: true },
      tokenStorage: { type: "keychain" },
    };

    await store.save(config);

    assert.deepEqual(await store.load(), config);
    assert.equal((await stat(join(configDir, "config.json"))).mode & 0o777, 0o600);
    assert.doesNotMatch(await readFile(join(configDir, "config.json"), "utf8"), /password|123456|pending\.jwt/);
  });
});

describe("keychain token store", () => {
  it("uses macOS security commands for token persistence", async () => {
    const calls = [];
    const { KeychainTokenStore } = await import("../src/token-storage.js");
    const store = new KeychainTokenStore({
      serverUrl: "https://termix.example",
      execFileImpl: async (...call) => {
        calls.push(call);
        return { stdout: "final.jwt\n", stderr: "" };
      },
      platformName: "darwin",
    });

    await store.set("final.jwt");
    assert.equal(await store.get(), "final.jwt");
    await store.delete();

    assert.deepEqual(calls, [
      ["security", ["add-generic-password", "-a", "https://termix.example", "-s", "tersh", "-w", "final.jwt", "-U"]],
      ["security", ["find-generic-password", "-a", "https://termix.example", "-s", "tersh", "-w"]],
      ["security", ["delete-generic-password", "-a", "https://termix.example", "-s", "tersh"]],
    ]);
  });

  it("uses Linux Secret Service commands for token persistence", async () => {
    const spawnCalls = [];
    const { KeychainTokenStore } = await import("../src/token-storage.js");
    const store = new KeychainTokenStore({
      serverUrl: "https://termix.example",
      platformName: "linux",
      spawnCommandImpl: async (command, args, options) => {
        spawnCalls.push([command, args, options]);
        return options.stdout === "capture" ? "final.jwt" : undefined;
      },
    });

    await store.set("final.jwt");
    assert.equal(await store.get(), "final.jwt");
    await store.delete();

    assert.deepEqual(spawnCalls, [
      ["secret-tool", ["store", "--label", "tersh", "service", "tersh", "server", "https://termix.example"], { input: "final.jwt" }],
      ["secret-tool", ["lookup", "service", "tersh", "server", "https://termix.example"], { stdout: "capture" }],
      ["secret-tool", ["clear", "service", "tersh", "server", "https://termix.example"], { input: "" }],
    ]);
  });
});
