import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TermixAuthClient } from "../src/auth-client.js";

describe("Termix auth client", () => {
  it("posts password login with the native-app request marker", async () => {
    const { client, requests } = recordingAuthClient();

    assert.deepEqual(await client.passwordLogin({
      serverUrl: "https://termix.example",
      username: "alice",
      password: "password",
      rememberMe: true,
      tls: { caFile: "/tmp/ca.pem", insecureSkipVerify: false },
    }), { token: "final.jwt" });

    assert.deepEqual(requests, [[
      "https://termix.example",
      "/users/login",
      { username: "alice", password: "password", rememberMe: true },
      { caFile: "/tmp/ca.pem", insecureSkipVerify: false },
      {
        "Content-Type": "application/json",
        "User-Agent": "tersh",
        "X-Electron-App": "true",
      },
    ]]);
  });

  it("posts TOTP verification with the native-app request marker", async () => {
    const { client, requests } = recordingAuthClient();

    assert.deepEqual(await client.verifyTotp({
      serverUrl: "https://termix.example",
      tempToken: "pending.jwt",
      totpCode: "123456",
      rememberMe: true,
    }), { token: "final.jwt" });

    assert.deepEqual(requests, [[
      "https://termix.example",
      "/users/totp/verify-login",
      { temp_token: "pending.jwt", totp_code: "123456", rememberMe: true },
      {},
      {
        "Content-Type": "application/json",
        "User-Agent": "tersh",
        "X-Electron-App": "true",
      },
    ]]);
  });
});

function recordingAuthClient() {
  const requests = [];
  const client = new TermixAuthClient({
    postJsonImpl: async (...request) => {
      requests.push(request);
      return { token: "final.jwt" };
    },
  });

  return { client, requests };
}
