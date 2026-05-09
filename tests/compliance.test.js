const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, relativePath), "utf8"));
}

function runtimePathExists(manifestName, runtimePath) {
  if (manifestName === "manifest.json") {
    return fs.existsSync(path.join(ROOT_DIR, runtimePath));
  }
  const sourcePath = runtimePath.replace(/^scripts\//, "src/");
  return fs.existsSync(path.join(ROOT_DIR, sourcePath));
}

exports.run = async function runComplianceTests(ctx) {
  const { assert, runCase } = ctx;
  const manifests = ["manifest.json", "manifest.chrome.json", "manifest.firefox.json"];

  await runCase("all manifests request storage permission only", () => {
    for (const fileName of manifests) {
      const manifest = readJson(fileName);
      assert.deepEqual(manifest.permissions, ["storage"], fileName);
    }
  });

  await runCase("content script order loads bubble-state before content-script", () => {
    for (const fileName of manifests) {
      const manifest = readJson(fileName);
      const js = manifest.content_scripts[0].js;
      const captionTextIndex = js.findIndex((item) => item.includes("caption-text.js"));
      const bubbleIndex = js.findIndex((item) => item.includes("bubble-state.js"));
      const contentIndex = js.findIndex((item) => item.includes("content-script.js"));
      assert.ok(captionTextIndex >= 0, fileName + " missing caption-text.js");
      assert.ok(bubbleIndex >= 0, fileName + " missing bubble-state.js");
      assert.ok(contentIndex >= 0, fileName + " missing content-script.js");
      assert.ok(captionTextIndex < contentIndex, fileName + " loads content-script before caption-text");
      assert.ok(bubbleIndex < contentIndex, fileName + " loads content-script too early");
    }
  });

  await runCase("manifest runtime JS/CSS paths exist in source or build context", () => {
    for (const fileName of manifests) {
      const manifest = readJson(fileName);
      for (const script of manifest.content_scripts[0].js) {
        assert.ok(runtimePathExists(fileName, script), fileName + " missing " + script);
      }
      for (const css of manifest.content_scripts[0].css) {
        assert.ok(runtimePathExists(fileName, css), fileName + " missing " + css);
      }
      for (const block of manifest.web_accessible_resources || []) {
        for (const resource of block.resources || []) {
          assert.ok(runtimePathExists(fileName, resource), fileName + " missing " + resource);
        }
      }
      for (const iconPath of Object.values(manifest.icons || {})) {
        assert.ok(runtimePathExists(fileName, iconPath), fileName + " missing icon " + iconPath);
      }
    }
  });

  await runCase("v1 release manifests include marketplace icons", () => {
    for (const fileName of manifests) {
      const manifest = readJson(fileName);
      assert.equal(manifest.version, "1.0.0", fileName);
      assert.deepEqual(Object.keys(manifest.icons || {}).sort(), ["128", "48", "96"], fileName);
      for (const iconPath of Object.values(manifest.icons)) {
        assert.ok(iconPath.startsWith("assets/icons/"), fileName);
        assert.ok(fs.existsSync(path.join(ROOT_DIR, iconPath)), iconPath);
      }
    }
  });

  await runCase("marketplace listing assets exist but are not packaged as runtime files", () => {
    assert.ok(fs.existsSync(path.join(ROOT_DIR, "store-assets", "amo-listing-draft.md")));
    assert.ok(fs.existsSync(path.join(ROOT_DIR, "store-assets", "screenshot-panel-over-video.png")));
    for (const dirName of ["build/chrome", "build/firefox"]) {
      const buildPath = path.join(ROOT_DIR, dirName);
      if (!fs.existsSync(buildPath)) {
        continue;
      }
      assert.equal(fs.existsSync(path.join(buildPath, "store-assets")), false, dirName);
      assert.ok(fs.existsSync(path.join(buildPath, "assets", "icons", "icon-128.png")), dirName);
    }
  });

  await runCase("Firefox manifest declares no data collection and non-placeholder ID", () => {
    const manifest = readJson("manifest.firefox.json");
    assert.deepEqual(
      manifest.browser_specific_settings.gecko.data_collection_permissions.required,
      ["none"]
    );
    const id = manifest.browser_specific_settings.gecko.id;
    assert.notEqual(id, "dialogue-captions@example.local");
    assert.ok(/@/.test(id), "Firefox extension ID should be stable");
    assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "142.0");
    assert.equal(Object.prototype.hasOwnProperty.call(manifest.browser_specific_settings, "gecko_android"), false);
  });

  await runCase("package build script does not bump versions", () => {
    const packageJson = readJson("package.json");
    assert.equal(packageJson.scripts.build, "node scripts/build.mjs");
    assert.equal(packageJson.scripts["diagnostic:e2e"], "node tests/e2e-extension-debug.js");
    assert.ok(!packageJson.scripts["release:check"].includes("version:bump"));
    assert.ok(!packageJson.scripts["release:check"].includes("bump-version"));
  });

  await runCase("test runner auto-discovers every test file", () => {
    const runner = fs.readFileSync(path.join(ROOT_DIR, "tests", "run-tests.js"), "utf8");
    const testFiles = fs.readdirSync(path.join(ROOT_DIR, "tests")).filter((fileName) => fileName.endsWith(".test.js"));
    assert.ok(runner.includes(".filter((fileName) => fileName.endsWith(\".test.js\"))"));
    for (const fileName of testFiles) {
      assert.ok(runner.includes(fileName) || runner.includes("discovered"), "runner may omit " + fileName);
    }
  });

  await runCase("content script does not inject page bridge at module startup", () => {
    const source = fs.readFileSync(path.join(ROOT_DIR, "src", "content-script.js"), "utf8");
    const startupRegion = source.slice(0, source.indexOf("class DialogueCaptionsApp"));
    assert.ok(!startupRegion.includes("ensureBridgeInjected()"));
    assert.ok(source.includes("ensurePageBridgeForWatchPage()"));
  });

  await runCase("page bridge omits XSRF_TOKEN and narrows fetch host checks", () => {
    const source = fs.readFileSync(path.join(ROOT_DIR, "src", "page-bridge.js"), "utf8");
    assert.ok(!source.includes('"XSRF_TOKEN"'));
    assert.ok(source.includes('host !== "www.youtube.com"'));
    assert.ok(source.includes('path.endsWith("/api/timedtext") || path === "/youtubei/v1/get_transcript"'));
  });

  await runCase("global keyboard is pointer-over-panel only", () => {
    const source = fs.readFileSync(path.join(ROOT_DIR, "src", "content-script.js"), "utf8");
    assert.ok(source.includes("return this.panel.isPointerInside();"));
    assert.ok(!source.includes("globalKeyboardEnabled"));
  });

  await runCase("build output manifests keep storage permission when present", () => {
    for (const dirName of ["build/chrome", "build/firefox"]) {
      const manifestPath = path.join(ROOT_DIR, dirName, "manifest.json");
      if (!fs.existsSync(manifestPath)) {
        continue;
      }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      assert.deepEqual(manifest.permissions, ["storage"], dirName);
    }
  });

  await runCase("release hygiene ignores signing keys and documents current downloads only", () => {
    const gitignore = fs.readFileSync(path.join(ROOT_DIR, ".gitignore"), "utf8");
    const readme = fs.readFileSync(path.join(ROOT_DIR, "README.md"), "utf8");
    assert.ok(gitignore.includes("*.pem"), "private signing keys must stay ignored");
    assert.ok(gitignore.includes("downloads/*/"), "extracted local packages should stay ignored");
    assert.ok(!readme.includes("dialogue-captions-friend-v0.25.61.zip"));
  });

  await runCase("package scripts reject Windows-style archive paths", () => {
    for (const fileName of ["package-chrome.ps1", "package-firefox.ps1"]) {
      const source = fs.readFileSync(path.join(ROOT_DIR, "scripts", fileName), "utf8");
      assert.ok(source.includes("hasBackslashEntries"), fileName);
      assert.ok(source.includes("Windows-style backslash archive paths"), fileName);
    }
  });

  await runCase("runtime does not use page localStorage for settings or debug state", () => {
    for (const fileName of ["settings-store.js", "transcript.js", "content-script.js"]) {
      const source = fs.readFileSync(path.join(ROOT_DIR, "src", fileName), "utf8");
      assert.ok(!source.includes("localStorage"), fileName + " should use extension storage only");
      assert.ok(!source.includes("sessionStorage"), fileName + " should not use page session storage");
    }
  });

  await runCase("panel cleans temporary pointer listeners during route teardown", () => {
    const panelSource = fs.readFileSync(path.join(ROOT_DIR, "src", "ui-panel.js"), "utf8");
    assert.ok(panelSource.includes("activePointerCleanupFns"));
    assert.ok(panelSource.includes("cleanupActivePointerListeners()"));
    assert.ok(panelSource.includes("trackActivePointerListeners"));
    assert.ok(panelSource.includes("this.dragState = null;"));
    assert.ok(panelSource.includes("this.resizeState = null;"));
    assert.ok(panelSource.includes("this.launcherDragState = null;"));
  });

  await runCase("README does not imply global keyboard shortcuts or Android targeting", () => {
    const readme = fs.readFileSync(path.join(ROOT_DIR, "README.md"), "utf8");
    assert.ok(readme.includes("Hover the panel and press `Space`"));
    assert.ok(readme.includes("desktop Chrome and desktop Firefox only"));
    assert.ok(!readme.includes("gecko_android"));
  });

  await runCase("release has no dormant monetization or ad-network scaffolding", () => {
    const files = [
      "README.md",
      "PRIVACY.md",
      "manifest.json",
      "manifest.chrome.json",
      "manifest.firefox.json",
      "src/settings-store.js",
      "src/content-script.js"
    ];
    for (const fileName of files) {
      const source = fs.readFileSync(path.join(ROOT_DIR, fileName), "utf8");
      assert.ok(!source.includes("feature-flags"), fileName);
      assert.ok(!source.includes("premium"), fileName);
      assert.ok(!source.includes("featureOverrides"), fileName);
      assert.ok(!source.includes("globalKeyboardEnabled"), fileName);
    }
    assert.equal(fs.existsSync(path.join(ROOT_DIR, "src", "feature-flags.js")), false);
  });

  await runCase("release stores only visible local panel preferences", () => {
    const source = fs.readFileSync(path.join(ROOT_DIR, "src", "settings-store.js"), "utf8");
    assert.ok(!source.includes("chunkSize"));
    assert.ok(!source.includes("keyboardStepSeconds"));
    assert.ok(!source.includes("autoScroll"));
    const privacy = fs.readFileSync(path.join(ROOT_DIR, "PRIVACY.md"), "utf8");
    assert.ok(!privacy.includes("chunk size"));
    assert.ok(!privacy.includes("keyboard step"));
    assert.ok(!privacy.includes("auto-scroll"));
  });
};
