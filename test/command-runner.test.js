import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { commands, runCommand } from "../src/command-runner.js";

function run(args) {
  const stdout = [];
  const stderr = [];

  const exitCode = runCommand(args, {
    stdout: { write: (chunk) => stdout.push(String(chunk)) },
    stderr: { write: (chunk) => stderr.push(String(chunk)) },
  });

  return {
    exitCode,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
  };
}

describe("tersh command runner", () => {
  it("prints help when no command is provided", () => {
    const result = run([]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Usage: tersh <command>/);
    assert.match(result.stdout, /login --server <url>/);
    assert.match(result.stdout, /hosts/);
    assert.match(result.stdout, /connect \[host-id-or-name\]/);
    assert.match(result.stdout, /logout/);
    assert.equal(result.stderr, "");
  });

  it("recognizes planned commands with predictable placeholder failures", () => {
    for (const command of commands) {
      const result = run([command.name]);

      assert.equal(result.exitCode, 2, command.name);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, new RegExp(`tersh ${command.name} is not implemented yet\\.`));
    }
  });

  it("rejects unknown commands without a stack trace", () => {
    const result = run(["bogus"]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Unknown command: bogus/);
    assert.doesNotMatch(result.stderr, /Error:/);
  });
});
