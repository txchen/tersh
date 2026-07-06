import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export function defaultConfigDir(env = process.env) {
  if (env.TERSH_CONFIG_DIR !== undefined) {
    return env.TERSH_CONFIG_DIR;
  }

  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "tersh");
  }

  if (platform() === "win32") {
    return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "tersh");
  }

  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "tersh");
}

export class JsonConfigStore {
  constructor({ configDir = defaultConfigDir() } = {}) {
    this.configDir = configDir;
    this.configPath = join(configDir, "config.json");
  }

  async load() {
    try {
      return JSON.parse(await readFile(this.configPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      }
      throw error;
    }
  }

  async save(config) {
    await mkdir(this.configDir, { recursive: true, mode: 0o700 });
    await writeFile(this.configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await chmod(this.configPath, 0o600);
  }
}
