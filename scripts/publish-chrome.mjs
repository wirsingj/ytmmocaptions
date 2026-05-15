import fs from "node:fs";
import path from "node:path";

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

async function requestAccessToken() {
  const body = new URLSearchParams({
    client_id: requireEnv("CHROME_CLIENT_ID"),
    client_secret: requireEnv("CHROME_CLIENT_SECRET"),
    refresh_token: requireEnv("CHROME_REFRESH_TOKEN"),
    grant_type: "refresh_token"
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });
  const payload = await readJsonResponse(response);
  if (!response.ok || !payload.access_token) {
    throw new Error(`Chrome OAuth token request failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload.access_token;
}

async function uploadPackage({ accessToken, extensionId, zipPath }) {
  const publisherId = requireEnv("CHROME_PUBLISHER_ID");
  const bytes = fs.readFileSync(zipPath);
  const response = await fetch(
    `https://chromewebstore.googleapis.com/upload/v2/publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}:upload`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/zip"
      },
      body: bytes
    }
  );
  const payload = await readJsonResponse(response);
  if (!response.ok || payload.uploadState === "FAILURE") {
    throw new Error(`Chrome upload failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  console.log(`Chrome upload accepted with state: ${payload.uploadState || "unknown"}`);
}

async function publishPackage({ accessToken, extensionId }) {
  const publisherId = requireEnv("CHROME_PUBLISHER_ID");
  const response = await fetch(
    `https://chromewebstore.googleapis.com/v2/publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}:publish`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-length": "0"
      }
    }
  );
  const payload = await readJsonResponse(response);
  if (!response.ok || payload.status?.some((item) => String(item).toLowerCase().includes("error"))) {
    throw new Error(`Chrome publish failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  console.log(`Chrome publish response: ${JSON.stringify(payload.status || payload)}`);
}

async function run() {
  const mode = readArg("mode", process.env.STORE_PUBLISH_MODE || "upload");
  if (!["upload", "publish"].includes(mode)) {
    throw new Error("Chrome publish mode must be upload or publish.");
  }

  const extensionId = requireEnv("CHROME_EXTENSION_ID");
  const zipPath = path.resolve(readArg("zip", process.env.CHROME_ZIP_PATH || ""));
  if (!zipPath || !fs.existsSync(zipPath)) {
    throw new Error(`Chrome ZIP not found: ${zipPath}`);
  }

  const accessToken = await requestAccessToken();
  await uploadPackage({ accessToken, extensionId, zipPath });

  if (mode === "publish") {
    await publishPackage({ accessToken, extensionId });
  } else {
    console.log("Chrome publish skipped because mode=upload. Set STORE_PUBLISH_MODE=publish to publish after upload.");
  }
}

run().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
});
