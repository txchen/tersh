import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { commands, runCommand } from "../src/command-runner.js";

async function run(args, deps) {
  const stdout = [];
  const stderr = [];

  const exitCode = await runCommand(args, {
    stdout: { write: (chunk) => stdout.push(String(chunk)) },
    stderr: { write: (chunk) => stderr.push(String(chunk)) },
  }, deps);

  return {
    exitCode,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
  };
}

describe("tersh command runner", () => {
  it("prints help when no command is provided", async () => {
    const result = await run([]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Usage: tersh <command>/);
    assert.match(result.stdout, /login --server <url>/);
    assert.match(result.stdout, /hosts/);
    assert.match(result.stdout, /connect \[host-id-or-name\]/);
    assert.match(result.stdout, /logout/);
    assert.equal(result.stderr, "");
  });

  it("recognizes unimplemented planned commands with predictable placeholder failures", async () => {
    for (const command of commands.filter((command) => !["login", "logout"].includes(command.name))) {
      const result = await run([command.name]);

      assert.equal(result.exitCode, 2, command.name);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, new RegExp(`tersh ${command.name} is not implemented yet\\.`));
    }
  });

  it("rejects unknown commands without a stack trace", async () => {
    const result = await run(["bogus"]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Unknown command: bogus/);
    assert.doesNotMatch(result.stderr, /Error:/);
  });

  it("shows current login and logout help", async () => {
    const login = await run(["login", "--help"]);
    const logout = await run(["logout", "--help"]);

    assert.match(login.stdout, /Authenticate to a Termix server with username\/password and optional TOTP/);
    assert.match(login.stdout, /--ca-file <path>/);
    assert.match(login.stdout, /--insecure-skip-tls-verify/);
    assert.match(login.stdout, /--token-store keychain\|file/);
    assert.match(logout.stdout, /Remove the stored Termix session token while leaving non-secret server config intact/);
    assert.doesNotMatch(`${login.stdout}\n${logout.stdout}`, /later slice/);
  });

  it("logs in with username and password and stores only the final token", async () => {
    const authRequests = [];
    const savedConfigs = [];
    const savedTokens = [];
    const prompts = [];

    const result = await run(["login", "--server", "https://termix.example"], {
      prompts: {
        askText: async (label) => {
          prompts.push(label);
          return "alice";
        },
        askSecret: async (label) => {
          prompts.push(label);
          return "correct horse";
        },
      },
      authClient: {
        passwordLogin: async (request) => {
          authRequests.push(request);
          return { token: "final.jwt" };
        },
      },
      configStore: {
        save: async (config) => savedConfigs.push(config),
      },
      tokenStore: {
        set: async (token) => savedTokens.push(token),
      },
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.deepEqual(prompts, ["Username: ", "Password: "]);
    assert.deepEqual(authRequests, [
      {
        serverUrl: "https://termix.example",
        username: "alice",
        password: "correct horse",
        rememberMe: true,
        tls: { caFile: undefined, insecureSkipVerify: false },
      },
    ]);
    assert.deepEqual(savedConfigs, [
      {
        serverUrl: "https://termix.example",
        tls: { caFile: undefined, insecureSkipVerify: false },
        tokenStorage: { type: "keychain" },
      },
    ]);
    assert.deepEqual(savedTokens, ["final.jwt"]);
    assert.doesNotMatch(JSON.stringify(savedConfigs), /correct horse|alice/);
  });

  it("completes TOTP login without storing the pending token or TOTP code", async () => {
    const savedTokens = [];
    const verifyRequests = [];

    const result = await run(["login", "--server", "https://termix.example"], {
      prompts: {
        askText: async () => "alice",
        askSecret: async (label) => (label === "Password: " ? "password" : "123456"),
      },
      authClient: {
        passwordLogin: async () => ({ requires_totp: true, temp_token: "pending.jwt" }),
        verifyTotp: async (request) => {
          verifyRequests.push(request);
          return { token: "final.jwt" };
        },
      },
      configStore: { save: async () => undefined },
      tokenStore: { set: async (token) => savedTokens.push(token) },
    });

    assert.equal(result.exitCode, 0);
    assert.deepEqual(verifyRequests, [
      {
        serverUrl: "https://termix.example",
        tempToken: "pending.jwt",
        totpCode: "123456",
        rememberMe: true,
        tls: { caFile: undefined, insecureSkipVerify: false },
      },
    ]);
    assert.deepEqual(savedTokens, ["final.jwt"]);
    assert.doesNotMatch(JSON.stringify(savedTokens), /pending|123456/);
  });

  it("rejects a login response that never returns a final token", async () => {
    const savedTokens = [];

    const result = await run(["login", "--server", "https://termix.example"], {
      prompts: {
        askText: async () => "alice",
        askSecret: async () => "password",
      },
      authClient: {
        passwordLogin: async () => ({ requires_totp: true, temp_token: "pending.jwt" }),
        verifyTotp: async () => ({ requires_totp: true, temp_token: "still-pending.jwt" }),
      },
      configStore: { save: async () => undefined },
      tokenStore: { set: async (token) => savedTokens.push(token) },
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /did not return a final session token/);
    assert.deepEqual(savedTokens, []);
  });

  it("supports explicit file token fallback with a warning", async () => {
    const savedConfigs = [];

    const result = await run(["login", "--server", "https://termix.example", "--token-store", "file"], {
      prompts: {
        askText: async () => "alice",
        askSecret: async () => "password",
      },
      authClient: {
        passwordLogin: async () => ({ token: "final.jwt" }),
      },
      configStore: { save: async (config) => savedConfigs.push(config) },
      tokenStore: { set: async () => undefined },
    });

    assert.equal(result.exitCode, 0);
    assert.match(result.stderr, /Warning: storing the Termix session token in a local 0600 file fallback/);
    assert.deepEqual(savedConfigs[0].tokenStorage, { type: "file" });
  });

  it("logs out by deleting token material while leaving config intact", async () => {
    const removedTokens = [];
    const savedConfigs = [];

    const result = await run(["logout"], {
      configStore: {
        load: async () => ({
          serverUrl: "https://termix.example",
          tls: { caFile: "/tmp/ca.pem", insecureSkipVerify: false },
          tokenStorage: { type: "keychain" },
        }),
        save: async (config) => savedConfigs.push(config),
      },
      tokenStore: { delete: async () => removedTokens.push("deleted") },
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.deepEqual(removedTokens, ["deleted"]);
    assert.deepEqual(savedConfigs, []);
    assert.match(result.stderr, /Logged out/);
  });
});
