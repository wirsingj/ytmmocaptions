import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(process.cwd());
const buildRoot = path.join(projectRoot, "build");

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function copyFile(sourcePath, destinationPath) {
  await ensureDir(path.dirname(destinationPath));
  await fs.copyFile(sourcePath, destinationPath);
}

async function clearDir(dirPath) {
  await fs.rm(dirPath, { recursive: true, force: true });
  await ensureDir(dirPath);
}

async function clearBuildTarget(dirPath) {
  await ensureDir(dirPath);
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await fs.rm(entryPath, { recursive: true, force: true });
    } else if (entry.isFile() && ![".zip", ".xpi"].includes(path.extname(entry.name).toLowerCase())) {
      await fs.rm(entryPath, { force: true });
    }
  }
}

async function copyDir(sourceDir, destinationDir) {
  await ensureDir(destinationDir);
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, destinationPath);
    }
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function getRuntimeFilesFromManifest(manifest) {
  const files = new Set();
  for (const contentScript of manifest.content_scripts || []) {
    for (const jsFile of contentScript.js || []) {
      files.add(jsFile);
    }
    for (const cssFile of contentScript.css || []) {
      files.add(cssFile);
    }
  }
  for (const block of manifest.web_accessible_resources || []) {
    for (const resource of block.resources || []) {
      files.add(resource);
    }
  }
  return Array.from(files);
}

async function copyManifestRuntimeFiles(targetRoot, manifest) {
  const runtimeFiles = getRuntimeFilesFromManifest(manifest);
  for (const runtimeFile of runtimeFiles) {
    const sourceFile = runtimeFile.replace(/^scripts\//, "src/");
    await copyFile(path.join(projectRoot, sourceFile), path.join(targetRoot, runtimeFile));
  }
}

async function createTargetBuild(targetName, manifestSource) {
  const targetRoot = path.join(buildRoot, targetName);
  const manifest = await readJson(path.join(projectRoot, manifestSource));
  await clearBuildTarget(targetRoot);

  await copyManifestRuntimeFiles(targetRoot, manifest);
  await copyDir(path.join(projectRoot, "styles"), path.join(targetRoot, "styles"));
  await copyDir(path.join(projectRoot, "assets"), path.join(targetRoot, "assets"));

  await copyFile(path.join(projectRoot, manifestSource), path.join(targetRoot, "manifest.json"));
  await copyFile(path.join(projectRoot, "LICENSE"), path.join(targetRoot, "LICENSE"));
  await copyFile(path.join(projectRoot, "PRIVACY.md"), path.join(targetRoot, "PRIVACY.md"));
  await copyFile(path.join(projectRoot, "README.md"), path.join(targetRoot, "README.md"));
}

async function run() {
  await ensureDir(buildRoot);

  await createTargetBuild("chrome", "manifest.chrome.json");
  await createTargetBuild("firefox", "manifest.firefox.json");

  console.log("Build complete:");
  console.log(" - build/chrome");
  console.log(" - build/firefox");
}

run().catch((error) => {
  console.error("Build failed:", error);
  process.exitCode = 1;
});
