import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";

export async function getJson(serverUrl, path, { token, tls = {} } = {}) {
  const url = new URL(path, serverUrl);
  const options = {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "tersh",
      Authorization: `Bearer ${token}`,
    },
  };

  if (url.protocol === "https:") {
    options.rejectUnauthorized = !tls.insecureSkipVerify;
    if (tls.caFile !== undefined) {
      options.ca = await readFile(tls.caFile, "utf8");
    }
  }

  const responseBody = await request(url, options);
  return responseBody.length === 0 ? [] : JSON.parse(responseBody);
}

function request(url, options) {
  const transport = url.protocol === "http:" ? http : https;

  return new Promise((resolve, reject) => {
    const requestHandle = transport.request(url, options, (response) => {
      const chunks = [];

      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const responseBody = Buffer.concat(chunks).toString("utf8");

        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(Object.assign(
            new Error(responseBody || `Termix request failed with HTTP ${response.statusCode}`),
            { statusCode: response.statusCode },
          ));
          return;
        }

        resolve(responseBody);
      });
    });

    requestHandle.on("error", reject);
    requestHandle.end();
  });
}
