import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";

const nativeHeaders = {
  "Content-Type": "application/json",
  "User-Agent": "tersh",
  "X-Electron-App": "true",
};

export class TermixAuthClient {
  constructor({ postJsonImpl = postJson } = {}) {
    this.postJson = postJsonImpl;
  }

  async passwordLogin({ serverUrl, username, password, rememberMe = true, tls = {} }) {
    return this.postJson(serverUrl, "/users/login", { username, password, rememberMe }, tls, nativeHeaders);
  }

  async verifyTotp({ serverUrl, tempToken, totpCode, rememberMe = true, tls = {} }) {
    return this.postJson(serverUrl, "/users/totp/verify-login", {
      temp_token: tempToken,
      totp_code: totpCode,
      rememberMe,
    }, tls, nativeHeaders);
  }
}

export async function postJson(serverUrl, path, body, tls = {}, headers = nativeHeaders) {
  const url = new URL(path, serverUrl);
  const bodyText = JSON.stringify(body);
  const options = {
    method: "POST",
    headers: {
      ...headers,
      "Content-Length": Buffer.byteLength(bodyText),
    },
  };

  if (url.protocol === "https:") {
    options.rejectUnauthorized = !tls.insecureSkipVerify;
    if (tls.caFile !== undefined) {
      options.ca = await readFile(tls.caFile, "utf8");
    }
  }

  const responseBody = await request(url, options, bodyText);
  const parsed = responseBody.length === 0 ? {} : JSON.parse(responseBody);

  if (parsed.success === false || parsed.error !== undefined) {
    throw new Error(parsed.error ?? "Termix login failed");
  }

  return parsed;
}

function request(url, options, bodyText) {
  const transport = url.protocol === "http:" ? http : https;

  return new Promise((resolve, reject) => {
    const requestHandle = transport.request(url, options, (response) => {
      const chunks = [];

      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const responseBody = Buffer.concat(chunks).toString("utf8");

        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(responseBody || `Termix login failed with HTTP ${response.statusCode}`));
          return;
        }

        resolve(responseBody);
      });
    });

    requestHandle.on("error", reject);
    requestHandle.end(bodyText);
  });
}
