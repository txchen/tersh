import { TermixAuthClient } from "./auth-client.js";
import { JsonConfigStore } from "./config-store.js";
import { formatHostList, sshCapableHosts, TermixHostClient } from "./host-discovery.js";
import { createNodePrompts } from "./prompts.js";
import { createTokenStore } from "./token-storage.js";
import { normalizeServerUrl } from "./tls-policy.js";

export const commands = [
  {
    name: "login",
    usage: "login --server <url> [--ca-file <path>] [--insecure-skip-tls-verify] [--token-store keychain|file]",
    summary: "Authenticate to a Termix server",
    detail: "Authenticate to a Termix server with username/password and optional TOTP.",
  },
  {
    name: "hosts",
    usage: "hosts",
    summary: "List SSH-capable Termix hosts",
    detail: "List SSH-capable Termix hosts visible to the stored Termix session.",
  },
  {
    name: "connect",
    usage: "connect [host-id-or-name]",
    summary: "Connect to a Termix-managed host",
    detail: "Connect to a Termix-managed host. TTY bridge implementation will be added in a later slice.",
  },
  {
    name: "logout",
    usage: "logout",
    summary: "Remove the stored Termix session token",
    detail: "Remove the stored Termix session token while leaving non-secret server config intact.",
  },
];

const commandsByName = new Map(commands.map((command) => [command.name, command]));

const usage = `Usage: tersh <command> [options]

Commands:
${commands.map((command) => `  ${command.usage.padEnd(27)} ${command.summary}`).join("\n")}

Run "tersh <command> --help" for command-specific help.
`;

export async function runCommand(args, io = {}, deps = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const [command] = args;

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    stdout.write(usage);
    return 0;
  }

  if (!commandsByName.has(command)) {
    stderr.write(`Unknown command: ${command}\n\n${usage}`);
    return 1;
  }

  if (args.includes("--help") || args.includes("-h")) {
    stdout.write(commandHelp(command));
    return 0;
  }

  if (command === "login") {
    return runLogin(args.slice(1), { stderr }, deps);
  }

  if (command === "hosts") {
    return runHosts({ stdout, stderr }, deps);
  }

  if (command === "logout") {
    return runLogout({ stderr }, deps);
  }

  stderr.write(`tersh ${command} is not implemented yet.\n`);
  return 2;
}

function commandHelp(command) {
  const commandMetadata = commandsByName.get(command);

  if (commandMetadata === undefined) {
    return usage;
  }

  if (commandMetadata.name === "login") {
    return `Usage: tersh ${commandMetadata.usage}

${commandMetadata.detail}

Options:
  --server <url>                 Termix server URL
  --ca-file <path>               CA certificate file for private CA deployments
  --insecure-skip-tls-verify     Disable TLS certificate verification with a warning
  --token-store keychain|file    Store the session token in the OS keychain or explicit 0600 file fallback
`;
  }

  return `Usage: tersh ${commandMetadata.usage}

${commandMetadata.detail}
`;
}

async function runLogin(args, io, deps) {
  try {
    const options = parseLoginOptions(args);
    const serverUrl = normalizeServerUrl(options.server);
    const tls = {
      caFile: options.caFile,
      insecureSkipVerify: options.insecureSkipVerify,
    };
    const tokenStorage = { type: options.tokenStore };
    const prompts = deps.prompts ?? createNodePrompts({ stderr: io.stderr });
    const authClient = deps.authClient ?? new TermixAuthClient();
    const config = { serverUrl, tls, tokenStorage };
    const configStore = deps.configStore ?? new JsonConfigStore();
    const tokenStore = deps.tokenStore ?? createTokenStore({ config });

    if (options.tokenStore === "file") {
      io.stderr.write("Warning: storing the Termix session token in a local 0600 file fallback.\n");
    }

    if (options.insecureSkipVerify) {
      io.stderr.write("Warning: TLS certificate verification is disabled for this Termix server.\n");
    }

    const username = await prompts.askText("Username: ");
    const password = await prompts.askSecret("Password: ");
    const loginResponse = await authClient.passwordLogin({
      serverUrl,
      username,
      password,
      rememberMe: true,
      tls,
    });
    const finalToken = await resolveFinalToken({ loginResponse, authClient, prompts, serverUrl, tls });

    await configStore.save(config);
    await tokenStore.set(finalToken);

    io.stderr.write(`Logged in to ${serverUrl}\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 1;
  }
}

async function runLogout(io, deps) {
  try {
    const configStore = deps.configStore ?? new JsonConfigStore();
    const config = await configStore.load();
    const tokenStore = deps.tokenStore ?? createTokenStore({ config });

    await tokenStore.delete();

    io.stderr.write("Logged out\n");
    return 0;
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 1;
  }
}

async function runHosts(io, deps) {
  try {
    const configStore = deps.configStore ?? new JsonConfigStore();
    let config = await configStore.load();
    const buildTokenStore = deps.createTokenStore ?? ((storeConfig) => createTokenStore({ config: storeConfig }));
    let tokenStore = deps.tokenStore ?? buildTokenStore(config);
    let token = await tokenStore.get();

    if (token === undefined) {
      io.stderr.write("No stored Termix session token found. Starting login.\n");
      const loginExitCode = deps.loginFlow === undefined
        ? await runLogin(["--server", config.serverUrl], io, deps)
        : await deps.loginFlow();

      if (loginExitCode !== 0) {
        return loginExitCode;
      }

      config = await configStore.load();
      tokenStore = deps.tokenStore ?? buildTokenStore(config);
      token = await tokenStore.get();
      if (token === undefined) {
        return 0;
      }
    }

    const hostClient = deps.hostClient ?? new TermixHostClient();
    const hosts = sshCapableHosts(await listHostsWithOneAuthRetry({
      config,
      token,
      hostClient,
      io,
      deps,
      configStore,
      buildTokenStore,
    }));

    io.stdout.write(formatHostList(hosts));
    return 0;
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 1;
  }
}

async function listHostsWithOneAuthRetry({ config, token, hostClient, io, deps, configStore, buildTokenStore }) {
  try {
    return await hostClient.listHosts({
      serverUrl: config.serverUrl,
      token,
      tls: config.tls ?? {},
    });
  } catch (error) {
    if (!isAuthFailure(error)) {
      throw error;
    }

    io.stderr.write("Stored Termix session token was rejected. Starting login.\n");
    const loginExitCode = deps.loginFlow === undefined
      ? await runLogin(["--server", config.serverUrl], io, deps)
      : await deps.loginFlow();

    if (loginExitCode !== 0) {
      throw new Error("Termix host listing failed: login did not complete");
    }

    const refreshedConfig = await configStore.load();
    const refreshedTokenStore = deps.tokenStore ?? buildTokenStore(refreshedConfig);
    const refreshedToken = await refreshedTokenStore.get();

    if (refreshedToken === undefined) {
      return [];
    }

    return hostClient.listHosts({
      serverUrl: refreshedConfig.serverUrl,
      token: refreshedToken,
      tls: refreshedConfig.tls ?? {},
    });
  }
}

function isAuthFailure(error) {
  return error.statusCode === 401 || error.statusCode === 403 || /auth|unauthorized|forbidden/i.test(error.message);
}

async function resolveFinalToken({ loginResponse, authClient, prompts, serverUrl, tls }) {
  if (isFinalTokenResponse(loginResponse)) {
    return loginResponse.token;
  }

  if (loginResponse?.requires_totp === true && typeof loginResponse.temp_token === "string") {
    const totpCode = await prompts.askSecret("TOTP or backup code: ");
    const verifyResponse = await authClient.verifyTotp({
      serverUrl,
      tempToken: loginResponse.temp_token,
      totpCode,
      rememberMe: true,
      tls,
    });

    if (isFinalTokenResponse(verifyResponse)) {
      return verifyResponse.token;
    }
  }

  throw new Error("Termix login did not return a final session token");
}

function isFinalTokenResponse(response) {
  return response?.requires_totp !== true && response?.temp_token === undefined && typeof response?.token === "string";
}

function parseLoginOptions(args) {
  const options = {
    caFile: undefined,
    insecureSkipVerify: false,
    tokenStore: "keychain",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--server") {
      options.server = readOptionValue(args, index, "--server");
      index += 1;
      continue;
    }

    if (arg === "--ca-file") {
      options.caFile = readOptionValue(args, index, "--ca-file");
      index += 1;
      continue;
    }

    if (arg === "--insecure-skip-tls-verify") {
      options.insecureSkipVerify = true;
      continue;
    }

    if (arg === "--token-store") {
      options.tokenStore = readOptionValue(args, index, "--token-store");
      index += 1;
      continue;
    }

    throw new Error(`Unknown login option: ${arg}`);
  }

  if (options.server === undefined) {
    throw new Error("Usage: tersh login --server <url>");
  }

  if (!["keychain", "file"].includes(options.tokenStore)) {
    throw new Error("--token-store must be either keychain or file");
  }

  return options;
}

function readOptionValue(args, index, optionName) {
  const value = args[index + 1];

  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value`);
  }

  return value;
}
