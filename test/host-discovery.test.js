import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatHostList, sanitizeHostForTerminal, sshCapableHosts, TermixHostClient } from "../src/host-discovery.js";

describe("Termix host client", () => {
  it("fetches visible hosts from the authenticated host list endpoint", async () => {
    const requests = [];
    const client = new TermixHostClient({
      getJsonImpl: async (...request) => {
        requests.push(request);
        return [{ id: "1" }];
      },
    });

    assert.deepEqual(await client.listHosts({
      serverUrl: "https://termix.example",
      token: "stored.jwt",
      tls: { caFile: "/tmp/ca.pem", insecureSkipVerify: false },
    }), [{ id: "1" }]);

    assert.deepEqual(requests, [[
      "https://termix.example",
      "/host/db/host",
      { token: "stored.jwt", tls: { caFile: "/tmp/ca.pem", insecureSkipVerify: false } },
    ]]);
  });
});

describe("host discovery", () => {
  it("filters to SSH-terminal-capable hosts", () => {
    const hosts = sshCapableHosts([
      { id: "1", ip: "10.0.0.1", port: 22, username: "deploy" },
      { id: 123, ip: "10.0.0.123", port: 22, username: "deploy" },
      { id: "2", ip: "10.0.0.2", port: 22, username: "deploy", enableSsh: false },
      { id: "3", ip: "10.0.0.3", port: 22, username: "deploy", enableTerminal: false },
      { id: "4", ip: "", port: 22, username: "deploy" },
      { id: "5", ip: "10.0.0.5", port: 0, username: "deploy" },
    ]);

    assert.deepEqual(hosts.map((host) => host.id), ["1", 123]);
  });

  it("removes secret fields before terminal use", () => {
    const sanitized = sanitizeHostForTerminal({
      id: "1",
      name: "prod",
      password: "secret",
      key: "private-key",
      keyPassword: "key-secret",
      sudoPassword: "sudo-secret",
      socks5Password: "socks-secret",
      autostartKeyPassword: "auto-secret",
      hasPassword: true,
    });

    assert.deepEqual(sanitized, {
      id: "1",
      name: "prod",
      hasPassword: true,
    });
  });

  it("formats shared hosts, folders, tags, auth type, and credential hints", () => {
    const output = formatHostList([
      {
        id: "shared-1",
        name: "shared-db",
        username: "postgres",
        ip: "10.0.0.11",
        port: 2222,
        folder: { name: "Shared" },
        tags: [{ name: "db" }, "critical"],
        authType: "key",
        isShared: true,
        hasKey: true,
      },
    ]);

    assert.match(output, /shared-db/);
    assert.match(output, /postgres@10\.0\.0\.11:2222/);
    assert.match(output, /Shared/);
    assert.match(output, /db, critical/);
    assert.match(output, /key/);
    assert.match(output, /shared/);
  });
});
