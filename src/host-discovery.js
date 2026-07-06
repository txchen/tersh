import { getJson } from "./http-json.js";

const secretHostFields = [
  "password",
  "key",
  "keyPassword",
  "sudoPassword",
  "socks5Password",
  "rdpPassword",
  "vncPassword",
  "telnetPassword",
  "autostartPassword",
  "autostartKey",
  "autostartKeyPassword",
];

export class TermixHostClient {
  constructor({ getJsonImpl = getJson } = {}) {
    this.getJson = getJsonImpl;
  }

  async listHosts({ serverUrl, token, tls = {} }) {
    return this.getJson(serverUrl, "/host/db/host", { token, tls });
  }
}

export function sshCapableHosts(hosts) {
  return hosts
    .filter((host) => host.enableSsh !== false && host.enableTerminal !== false)
    .filter((host) => hasHostId(host.id) && hasText(host.ip) && hasText(host.username) && Number(host.port) > 0)
    .map(sanitizeHostForTerminal);
}

export function sanitizeHostForTerminal(host) {
  const sanitized = { ...host };

  for (const field of secretHostFields) {
    delete sanitized[field];
  }

  if (sanitized.socks5 !== undefined && typeof sanitized.socks5 === "object") {
    sanitized.socks5 = { ...sanitized.socks5 };
    delete sanitized.socks5.password;
  }

  return sanitized;
}

export function formatHostList(hosts) {
  if (hosts.length === 0) {
    return "No SSH-capable Termix hosts found.\n";
  }

  return `${hosts.map(formatHostLine).join("\n")}\n`;
}

function formatHostLine(host) {
  return [
    host.name ?? host.id,
    `${host.username}@${host.ip}:${host.port}`,
    metadata("folder", folderName(host)),
    metadata("tags", tagNames(host).join(", ")),
    metadata("auth", host.authType),
    host.isShared ? "shared" : "owned",
    metadata("credentials", credentialHints(host).join(", ")),
  ].filter(Boolean).join(" | ");
}

function folderName(host) {
  if (typeof host.folderName === "string") {
    return host.folderName;
  }

  if (typeof host.folder === "string") {
    return host.folder;
  }

  if (host.folder !== undefined && typeof host.folder.name === "string") {
    return host.folder.name;
  }

  return undefined;
}

function tagNames(host) {
  if (!Array.isArray(host.tags)) {
    return [];
  }

  return host.tags
    .map((tag) => (typeof tag === "string" ? tag : tag?.name))
    .filter(hasText);
}

function credentialHints(host) {
  return [
    host.hasPassword ? "password" : undefined,
    host.hasKey ? "key" : undefined,
    host.hasKeyPassword ? "key-passphrase" : undefined,
    host.hasSudoPassword ? "sudo" : undefined,
    host.credentialId !== undefined ? "credential" : undefined,
  ].filter(Boolean);
}

function metadata(label, value) {
  return hasText(value) ? `${label}: ${value}` : undefined;
}

function hasText(value) {
  return typeof value === "string" && value.length > 0;
}

function hasHostId(value) {
  return hasText(value) || (typeof value === "number" && Number.isFinite(value));
}
