import fs from "node:fs";

const expectedRaw = process.argv[2] || process.env.GITHUB_REF_NAME || "";
const expected = expectedRaw.replace(/^refs\/tags\//, "").replace(/^v/, "");

if (!expected || !/^\d+\.\d+\.\d+$/.test(expected)) {
  console.error("Expected a release tag like v1.2.3.");
  process.exit(1);
}

const files = [
  "package.json",
  "manifest.json",
  "manifest.chrome.json",
  "manifest.firefox.json"
];

for (const file of files) {
  const json = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  if (json.version !== expected) {
    console.error(`${file} version ${json.version} does not match tag ${expectedRaw}.`);
    process.exit(1);
  }
}

console.log(`Release version verified: ${expected}`);
