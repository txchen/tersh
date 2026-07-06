export function normalizeServerUrl(rawServerUrl) {
  if (typeof rawServerUrl !== "string" || !/^https?:\/\//.test(rawServerUrl)) {
    throw new Error("Server URL must start with https:// or explicit http://");
  }

  const parsed = new URL(rawServerUrl);

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Server URL must start with https:// or explicit http://");
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error("Server URL must not include username or password");
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";

  return parsed.toString().replace(/\/$/, "");
}

export function webSocketUrlForServer(serverUrl, path) {
  const parsed = new URL(path, normalizeServerUrl(serverUrl));
  parsed.protocol = parsed.protocol === "http:" ? "ws:" : "wss:";
  return parsed.toString();
}
