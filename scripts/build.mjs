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

async function createTargetBuild(targetName, manifestSource) {
  const targetRoot = path.join(buildRoot, targetName);
  await ensureDir(targetRoot);
  await clearDir(path.join(targetRoot, "scripts"));
  await clearDir(path.join(targetRoot, "styles"));

  await copyDir(path.join(projectRoot, "src"), path.join(targetRoot, "scripts"));
  await copyDir(path.join(projectRoot, "styles"), path.join(targetRoot, "styles"));

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
