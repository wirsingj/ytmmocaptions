import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(process.cwd());

const targetFiles = [
  "package.json",
  "package-lock.json",
  "manifest.chrome.json",
  "manifest.firefox.json",
  "manifest.json"
].map((relativePath) => path.join(projectRoot, relativePath));

function parsePatchSemver(version) {
  const match = String(version || "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error("Expected patch semver format x.y.z, received: " + String(version));
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  const serialized = JSON.stringify(data, null, 2) + "\n";
  await fs.writeFile(filePath, serialized, "utf8");
}

async function run() {
  const packagePath = path.join(projectRoot, "package.json");
  const packageJson = await readJson(packagePath);
  const currentVersion = String(packageJson.version || "");
  const parsed = parsePatchSemver(currentVersion);
  const nextVersion = parsed.major + "." + parsed.minor + "." + (parsed.patch + 1);

  for (let index = 0; index < targetFiles.length; index += 1) {
    const filePath = targetFiles[index];
    const json = await readJson(filePath);
    json.version = nextVersion;
    if (json.packages && json.packages[""]) {
      json.packages[""].version = nextVersion;
    }
    await writeJson(filePath, json);
  }

  console.log("Version bumped:", currentVersion, "->", nextVersion);
}

run().catch((error) => {
  console.error("Version bump failed:", error);
  process.exitCode = 1;
});
