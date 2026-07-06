import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { describe, it } from "node:test";

import { createNodePrompts } from "../src/prompts.js";

class CaptureWritable extends Writable {
  constructor() {
    super();
    this.output = "";
  }

  _write(chunk, _encoding, callback) {
    this.output += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    callback();
  }
}

function promptFixture() {
  const stdin = new PassThrough();
  const stderr = new CaptureWritable();
  return { stdin, stderr, prompts: createNodePrompts({ stdin, stderr }) };
}

describe("terminal prompts", () => {
  it("writes visible prompts to stderr", async () => {
    const { stdin, stderr, prompts } = promptFixture();
    const answer = prompts.askText("Accept? ");

    setImmediate(() => stdin.write("accept\n"));

    assert.equal(await answer, "accept");
    assert.equal(stderr.output, "Accept? ");
  });

  it("hides secret input while still returning it to the caller", async () => {
    const { stdin, stderr, prompts } = promptFixture();
    const answer = prompts.askSecret("Password: ");

    setImmediate(() => stdin.write("ssh-password\n"));

    assert.equal(await answer, "ssh-password");
    assert.match(stderr.output, /Password: /);
    assert.doesNotMatch(stderr.output, /ssh-password/);
  });
});
