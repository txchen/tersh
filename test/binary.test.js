import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { describe, it } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

describe("tersh binary", () => {
  it("runs through the package binary entrypoint", async () => {
    const result = await execFileAsync("node", ["./bin/tersh.js", "--help"]);

    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Usage: tersh <command>/);
  });
});
