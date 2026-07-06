import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { defaultConfigDir } from "./config-store.js";

const execFileAsync = promisify(execFile);
const keychainService = "tersh";

export class FileTokenStore {
  constructor({ configDir = defaultConfigDir() } = {}) {
    this.configDir = configDir;
    this.tokenPath = join(configDir, "token");
  }

  async set(token) {
    if (isInsideProject(this.tokenPath)) {
      throw new Error("Refusing to store token material inside the project directory");
    }

    await mkdir(this.configDir, { recursive: true, mode: 0o700 });
    await writeFile(this.tokenPath, token, { mode: 0o600 });
    await chmod(this.tokenPath, 0o600);
  }

  async get() {
    try {
      return await readFile(this.tokenPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async delete() {
    await rm(this.tokenPath, { force: true });
  }
}

export class KeychainTokenStore {
  constructor({ serverUrl, execFileImpl = execFileAsync, spawnCommandImpl = runCommand, platformName = platform() } = {}) {
    this.provider = keychainProviderForPlatform({ serverUrl, execFileImpl, spawnCommandImpl, platformName });
  }

  async set(token) {
    return this.provider.set(token);
  }

  async get() {
    return this.provider.get();
  }

  async delete() {
    return this.provider.delete();
  }
}

export function createTokenStore({ config, configDir = defaultConfigDir() } = {}) {
  if (config?.tokenStorage?.type === "file") {
    return new FileTokenStore({ configDir });
  }

  return new KeychainTokenStore({ serverUrl: config?.serverUrl });
}

function isInsideProject(path) {
  const relativePath = relative(resolve(process.cwd()), resolve(path));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function keychainProviderForPlatform({ serverUrl, execFileImpl, spawnCommandImpl, platformName }) {
  const providers = {
    darwin: {
      set: async (token) => execFileImpl("security", [
        "add-generic-password",
        "-a",
        serverUrl,
        "-s",
        keychainService,
        "-w",
        token,
        "-U",
      ]),
      get: async () => {
        try {
          const result = await execFileImpl("security", ["find-generic-password", "-a", serverUrl, "-s", keychainService, "-w"]);
          return result.stdout.trimEnd();
        } catch (error) {
          if (String(error.stderr ?? error.message).includes("could not be found")) {
            return undefined;
          }
          throw error;
        }
      },
      delete: async () => {
        try {
          await execFileImpl("security", ["delete-generic-password", "-a", serverUrl, "-s", keychainService]);
        } catch (error) {
          if (!String(error.stderr ?? error.message).includes("could not be found")) {
            throw error;
          }
        }
      },
    },
    linux: {
      set: (token) => runWithStdin("secret-tool", [
        "store",
        "--label",
        "tersh",
        "service",
        keychainService,
        "server",
        serverUrl,
      ], token, spawnCommandImpl),
      get: async () => {
        try {
          return await spawnCommandImpl("secret-tool", ["lookup", "service", keychainService, "server", serverUrl], { stdout: "capture" });
        } catch (error) {
          if (String(error.message).includes("exited with code 1")) {
            return undefined;
          }
          throw error;
        }
      },
      delete: () => runWithStdin("secret-tool", ["clear", "service", keychainService, "server", serverUrl], "", spawnCommandImpl),
    },
  };

  const provider = providers[platformName];

  if (provider !== undefined) {
    return provider;
  }

  throw new Error("No supported OS keychain provider is available; rerun with --token-store file to use the explicit file fallback");
}

function runWithStdin(command, args, input, spawnCommandImpl = runCommand) {
  return spawnCommandImpl(command, args, { input });
}

function runCommand(command, args, { input, stdout = "ignore" } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: [input === undefined ? "ignore" : "pipe", stdout === "capture" ? "pipe" : "ignore", "pipe"],
    });
    const stdoutChunks = [];
    const stderr = [];

    if (stdout === "capture") {
      child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    }
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout === "capture" ? Buffer.concat(stdoutChunks).toString("utf8").trimEnd() : undefined);
        return;
      }

      reject(new Error(`${command} exited with code ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });

    if (input !== undefined) {
      child.stdin.end(input);
    }
  });
}
