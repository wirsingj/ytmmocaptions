import fs from "node:fs";
import path from "node:path";

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function requireEnv(name) {
  const value = process.env[name];
  if (value == null) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  const trimmed = String(value).trim();
  const normalized =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  if (!normalized) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return normalized;
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

function getPublisherName(extensionId) {
  const publisherId = requireEnv("CHROME_PUBLISHER_ID");
  return `publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}`;
}

async function uploadPackage({ accessToken, extensionId, zipPath }) {
  const bytes = fs.readFileSync(zipPath);
  const response = await fetch(
    `https://chromewebstore.googleapis.com/upload/v2/${getPublisherName(extensionId)}:upload`,
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
  return payload;
}

async function fetchItemStatus({ accessToken, extensionId }) {
  const response = await fetch(
    `https://chromewebstore.googleapis.com/v2/${getPublisherName(extensionId)}:fetchStatus`,
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    }
  );
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Chrome fetchStatus failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUploadReady({ accessToken, extensionId, uploadPayload }) {
  const initialState = uploadPayload && uploadPayload.uploadState ? String(uploadPayload.uploadState) : "";
  if (initialState && initialState !== "UPLOAD_IN_PROGRESS") {
    if (initialState === "FAILURE") {
      throw new Error(`Chrome upload failed: ${JSON.stringify(uploadPayload)}`);
    }
    return uploadPayload;
  }

  for (let attempt = 1; attempt <= 36; attempt += 1) {
    await sleep(5000);
    const status = await fetchItemStatus({ accessToken, extensionId });
    const state = status.lastAsyncUploadState ? String(status.lastAsyncUploadState) : "";
    console.log(`Chrome upload status poll ${attempt}: ${state || "unknown"}`);
    if (state && state !== "UPLOAD_IN_PROGRESS") {
      if (state === "FAILURE") {
        throw new Error(`Chrome upload failed after polling: ${JSON.stringify(status)}`);
      }
      return status;
    }
  }

  throw new Error("Chrome upload did not finish within 3 minutes.");
}

async function publishPackage({ accessToken, extensionId }) {
  const response = await fetch(
    `https://chromewebstore.googleapis.com/v2/${getPublisherName(extensionId)}:publish`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({})
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
  const uploadPayload = await uploadPackage({ accessToken, extensionId, zipPath });
  await waitForUploadReady({ accessToken, extensionId, uploadPayload });

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
