import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeServerUrl, webSocketUrlForServer } from "../src/tls-policy.js";

describe("TLS URL policy", () => {
  it("normalizes HTTPS server URLs and derives WSS URLs", () => {
    const serverUrl = normalizeServerUrl("https://termix.example/");

    assert.equal(serverUrl, "https://termix.example");
    assert.equal(webSocketUrlForServer(serverUrl, "/ssh/terminal"), "wss://termix.example/ssh/terminal");
  });

  it("allows HTTP only when the server URL explicitly starts with http", () => {
    const serverUrl = normalizeServerUrl("http://localhost:8080");

    assert.equal(serverUrl, "http://localhost:8080");
    assert.equal(webSocketUrlForServer(serverUrl, "/ssh/terminal"), "ws://localhost:8080/ssh/terminal");
  });

  it("rejects URLs that do not explicitly choose HTTP or HTTPS", () => {
    assert.throws(
      () => normalizeServerUrl("termix.example"),
      /must start with https:\/\/ or explicit http:\/\//,
    );
  });

  it("rejects unsupported URL protocols", () => {
    assert.throws(
      () => normalizeServerUrl("ws://termix.example"),
      /must start with https:\/\/ or explicit http:\/\//,
    );
  });

  it("rejects server URLs containing username or password material", () => {
    assert.throws(
      () => normalizeServerUrl("https://alice:secret@termix.example"),
      /must not include username or password/,
    );
  });
});
