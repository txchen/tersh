export const commands = [
  {
    name: "login",
    usage: "login --server <url>",
    summary: "Authenticate to a Termix server",
    detail: "Authenticate to a Termix server. Login implementation will be added in a later slice.",
  },
  {
    name: "hosts",
    usage: "hosts",
    summary: "List SSH-capable Termix hosts",
    detail: "List SSH-capable Termix hosts. Host discovery implementation will be added in a later slice.",
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
    detail: "Remove the stored Termix session token. Logout implementation will be added in a later slice.",
  },
];

const commandsByName = new Map(commands.map((command) => [command.name, command]));

const usage = `Usage: tersh <command> [options]

Commands:
${commands.map((command) => `  ${command.usage.padEnd(27)} ${command.summary}`).join("\n")}

Run "tersh <command> --help" for command-specific help.
`;

export function runCommand(args, io = {}) {
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

  stderr.write(`tersh ${command} is not implemented yet.\n`);
  return 2;
}

function commandHelp(command) {
  const commandMetadata = commandsByName.get(command);

  if (commandMetadata === undefined) {
    return usage;
  }

  return `Usage: tersh ${commandMetadata.usage}

${commandMetadata.detail}
`;
}
