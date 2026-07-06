import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("package shape", () => {
  it("declares the tersh binary and Node 24 runtime target", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    assert.equal(packageJson.bin.tersh, "./bin/tersh.js");
    assert.equal(packageJson.engines.node, ">=24");
  });

  it("does not depend on Electron or browser automation packages", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    const dependencyNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ];

    assert.deepEqual(
      dependencyNames.filter((name) => /electron|playwright|puppeteer|selenium|webdriver/i.test(name)),
      [],
    );
  });
});
