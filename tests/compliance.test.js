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

  await runCase("release manifests stay YouTube-only and avoid broad site access", () => {
    for (const fileName of manifests) {
      const manifest = readJson(fileName);
      assert.equal(manifest.name, "YTMMOCC", fileName);
      assert.deepEqual(manifest.host_permissions, ["https://www.youtube.com/*"], fileName);
      assert.deepEqual(manifest.content_scripts[0].matches, ["https://www.youtube.com/*"], fileName);
      assert.equal(Object.prototype.hasOwnProperty.call(manifest, "optional_permissions"), false, fileName);
      assert.equal(Object.prototype.hasOwnProperty.call(manifest, "background"), false, fileName);
      assert.equal(Object.prototype.hasOwnProperty.call(manifest, "externally_connectable"), false, fileName);
      assert.ok(!manifest.permissions.includes("tabs"), fileName);
      assert.ok(!manifest.permissions.includes("activeTab"), fileName);
      assert.ok(!manifest.permissions.includes("scripting"), fileName);
      const serialized = JSON.stringify(manifest);
      assert.ok(!serialized.includes("<all_urls>"), fileName);
      assert.ok(!serialized.includes("*://*/*"), fileName);
      assert.ok(!serialized.includes("http://*/*"), fileName);
      assert.ok(!serialized.includes("https://*/*"), fileName);
      for (const block of manifest.web_accessible_resources || []) {
        assert.deepEqual(block.matches, ["https://www.youtube.com/*"], fileName);
      }
    }
    const contentScript = fs.readFileSync(path.join(ROOT_DIR, "src", "content-script.js"), "utf8");
    assert.ok(contentScript.includes("transcript.isWatchPage(url)"));
    assert.ok(contentScript.includes("transcript.getVideoId(url)"));
    assert.ok(!contentScript.includes("startGenericRegistryIfAllowed"));
    assert.ok(!contentScript.includes("universalCaptions"));
  });

  await runCase("content script order loads bubble-state before content-script", () => {
    for (const fileName of manifests) {
      const manifest = readJson(fileName);
      const js = manifest.content_scripts[0].js;
      const platformIndex = js.findIndex((item) => item.includes("platform.js"));
      const diagnosticsIndex = js.findIndex((item) => item.includes("diagnostics.js"));
      const pageContextIndex = js.findIndex((item) => item.includes("page-context.js"));
      const captionTextIndex = js.findIndex((item) => item.includes("caption-text.js"));
      const bubbleIndex = js.findIndex((item) => item.includes("bubble-state.js"));
      const scrubIndex = js.findIndex((item) => item.includes("timeline-scrub.js"));
      const transcriptIndex = js.findIndex((item) => item.includes("transcript.js"));
      const timelineIndex = js.findIndex((item) => item.includes("caption-timeline.js"));
      const universalIndex = js.findIndex((item) => item.includes("universal-captions.js"));
      const contentIndex = js.findIndex((item) => item.includes("content-script.js"));
      assert.ok(platformIndex >= 0, fileName + " missing platform.js");
      assert.ok(diagnosticsIndex >= 0, fileName + " missing diagnostics.js");
      assert.ok(pageContextIndex >= 0, fileName + " missing page-context.js");
      assert.ok(captionTextIndex >= 0, fileName + " missing caption-text.js");
      assert.ok(bubbleIndex >= 0, fileName + " missing bubble-state.js");
      assert.ok(scrubIndex >= 0, fileName + " missing timeline-scrub.js");
      assert.ok(transcriptIndex >= 0, fileName + " missing transcript.js");
      assert.ok(timelineIndex >= 0, fileName + " missing caption-timeline.js");
      assert.ok(contentIndex >= 0, fileName + " missing content-script.js");
      assert.ok(platformIndex < diagnosticsIndex, fileName + " loads platform before diagnostics");
      assert.ok(diagnosticsIndex < pageContextIndex, fileName + " loads diagnostics before page-context");
      assert.ok(captionTextIndex < contentIndex, fileName + " loads content-script before caption-text");
      assert.ok(bubbleIndex < contentIndex, fileName + " loads content-script too early");
      assert.ok(bubbleIndex < scrubIndex, fileName + " loads timeline scrub before bubble-state");
      assert.ok(scrubIndex < contentIndex, fileName + " loads content-script before timeline scrub");
      assert.ok(transcriptIndex < timelineIndex, fileName + " loads caption timeline before transcript");
      assert.ok(timelineIndex < contentIndex, fileName + " loads content-script before caption timeline");
      assert.equal(universalIndex, -1, fileName + " should not load generic-video experiment in release manifest");
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
    const packageJson = readJson("package.json");
    assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
    for (const fileName of manifests) {
      const manifest = readJson(fileName);
      assert.equal(manifest.version, packageJson.version, fileName);
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
    assert.ok(packageJson.scripts["release:sanity"].includes("verify-release-artifacts.ps1"));
    assert.ok(packageJson.scripts["verify:release-version"].includes("verify-release-version.mjs"));
    assert.ok(packageJson.scripts["package:source"].includes("package-source.ps1"));
    assert.ok(!packageJson.scripts["release:check"].includes("version:bump"));
    assert.ok(!packageJson.scripts["release:check"].includes("bump-version"));
    assert.ok(!packageJson.scripts["release:sanity"].includes("version:bump"));
    assert.ok(!packageJson.scripts["release:sanity"].includes("bump-version"));
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
    assert.ok(source.includes('path.endsWith("/api/timedtext")'));
    assert.ok(source.includes('path === "/youtubei/v1/get_transcript"'));
    assert.ok(source.includes('path === "/youtubei/v1/get_panel"'));
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
    for (const fileName of ["package-chrome.ps1", "package-firefox.ps1", "package-source.ps1"]) {
      const source = fs.readFileSync(path.join(ROOT_DIR, "scripts", fileName), "utf8");
      assert.ok(source.includes("hasBackslashEntries"), fileName);
      assert.ok(source.includes("Windows-style backslash archive paths"), fileName);
    }
    const sourcePackage = fs.readFileSync(path.join(ROOT_DIR, "scripts", "package-source.ps1"), "utf8");
    assert.ok(sourcePackage.includes('StartsWith("artifacts/"'), "source package must exclude local test artifacts");
  });

  await runCase("release automation is tag-gated and manually approved before store publishing", () => {
    const ci = fs.readFileSync(path.join(ROOT_DIR, ".github", "workflows", "ci.yml"), "utf8");
    const release = fs.readFileSync(path.join(ROOT_DIR, ".github", "workflows", "release.yml"), "utf8");
    const releaseDocs = fs.readFileSync(path.join(ROOT_DIR, "RELEASE.md"), "utf8");
    assert.ok(ci.includes("pull_request:"));
    assert.ok(ci.includes("npm run release:sanity"));
    assert.ok(!ci.includes("store-publish"));
    assert.ok(!ci.includes("CHROME_CLIENT_SECRET"));
    assert.ok(release.includes('tags:'));
    assert.ok(release.includes('- "v*"'));
    assert.ok(release.includes("environment: store-publish"));
    assert.ok(release.includes("scripts/verify-release-version.mjs"));
    assert.ok(release.includes("STORE_PUBLISH_MODE"));
    assert.ok(release.includes("CHROME_PUBLISHER_ID"));
    assert.ok(release.includes("CHROME_EXTENSION_ID"));
    assert.ok(release.includes("AMO_JWT_ISSUER"));
    assert.ok(release.includes("Check store credentials"));
    assert.ok(release.includes("chrome_ready"));
    assert.ok(release.includes("firefox_ready"));
    assert.ok(release.includes("Skipping Chrome Web Store upload"));
    assert.ok(release.includes("Skipping Firefox AMO upload"));
    assert.ok(releaseDocs.includes("STORE_PUBLISH_MODE"));
    assert.ok(releaseDocs.includes("cocgdaogbkknnhdpmojlmodalmblndgf"));
    assert.ok(releaseDocs.includes("https://www.googleapis.com/auth/chromewebstore"));
    assert.ok(releaseDocs.includes("Recovery If One Store Succeeds And The Other Fails"));
  });

  await runCase("store publish scripts avoid secret logging and default to safe upload mode", () => {
    const chrome = fs.readFileSync(path.join(ROOT_DIR, "scripts", "publish-chrome.mjs"), "utf8");
    const firefox = fs.readFileSync(path.join(ROOT_DIR, "scripts", "publish-firefox.ps1"), "utf8");
    assert.ok(chrome.includes('process.env.STORE_PUBLISH_MODE || "upload"'));
    assert.ok(chrome.includes("CHROME_PUBLISHER_ID"));
    assert.ok(chrome.includes("https://oauth2.googleapis.com/token"));
    assert.ok(chrome.includes("chromewebstore.googleapis.com/upload/v2/publishers"));
    assert.ok(chrome.includes("chromewebstore.googleapis.com/v2/publishers"));
    assert.ok(!chrome.includes("console.log(accessToken"));
    assert.ok(!chrome.includes("CHROME_CLIENT_SECRET\";"));
    assert.ok(firefox.includes('if ($Mode -eq "upload")'));
    assert.ok(firefox.includes("web-ext lint"));
    assert.ok(firefox.includes("web-ext"));
    assert.ok(firefox.includes("sign"));
    assert.ok(firefox.includes("AMO_JWT_SECRET"));
  });

  await runCase("runtime does not use page localStorage for settings or debug state", () => {
    for (const fileName of ["settings-store.js", "transcript.js", "content-script.js", "diagnostics.js"]) {
      const source = fs.readFileSync(path.join(ROOT_DIR, "src", fileName), "utf8");
      assert.ok(!source.includes("localStorage"), fileName + " should use extension storage only");
      assert.ok(!source.includes("sessionStorage"), fileName + " should not use page session storage");
    }
  });

  await runCase("diagnostics are local-only, opt-in, and redact sensitive detail", () => {
    const source = fs.readFileSync(path.join(ROOT_DIR, "src", "diagnostics.js"), "utf8");
    const readme = fs.readFileSync(path.join(ROOT_DIR, "README.md"), "utf8");
    const privacy = fs.readFileSync(path.join(ROOT_DIR, "PRIVACY.md"), "utf8");
    assert.ok(source.includes('searchParams.get("dcdebug") === "1"'));
    assert.ok(source.includes("if (!isDebugEnabled())"));
    assert.ok(source.includes("/text|caption|transcript|body|token|cookie|title|url/i"));
    assert.ok(!source.includes("fetch("));
    assert.ok(readme.includes("window.DialogueCaptions.diagnostics.getReport()"));
    assert.ok(privacy.includes("Local Diagnostics"));
  });

  await runCase("source submission docs do not pin stale package versions", () => {
    const sourceSubmission = fs.readFileSync(path.join(ROOT_DIR, "SOURCE_SUBMISSION.md"), "utf8");
    assert.ok(sourceSubmission.includes("ytmmocaptions-firefox-v<package-version>.xpi"));
    assert.ok(!/v1\\.0\\.2/.test(sourceSubmission));
  });

  await runCase("optional e2e diagnostic is explicit, local, and avoids raw transcript assertions", () => {
    const source = fs.readFileSync(path.join(ROOT_DIR, "tests", "e2e-extension-debug.js"), "utf8");
    const readme = fs.readFileSync(path.join(ROOT_DIR, "README.md"), "utf8");
    const gitignore = fs.readFileSync(path.join(ROOT_DIR, ".gitignore"), "utf8");
    assert.ok(source.includes("--browser must be chrome, firefox, or both."));
    assert.ok(source.includes("e2e-report.json"));
    assert.ok(source.includes("shared-source-injected-diagnostic"));
    assert.ok(source.includes("textLength"));
    assert.ok(source.includes("scorePercent"));
    assert.ok(!source.includes("document.title"));
    assert.ok(!source.includes("dQw4w9WgXcQ"));
    assert.ok(readme.includes("npm run diagnostic:e2e -- --browser=both --url=https://www.youtube.com/watch?v=VIDEO_ID --headed"));
    assert.ok(readme.includes("tests/artifacts/e2e-report.json"));
    assert.ok(gitignore.includes("tests/artifacts/"));
  });

  await runCase("panel cleans temporary pointer listeners during route teardown", () => {
    const panelSource = fs.readFileSync(path.join(ROOT_DIR, "src", "ui-panel.js"), "utf8");
    assert.ok(panelSource.includes("activePointerCleanupFns"));
    assert.ok(panelSource.includes("cleanupActivePointerListeners()"));
    assert.ok(panelSource.includes("trackActivePointerListeners"));
    assert.ok(panelSource.includes("this.dragState = null;"));
    assert.ok(panelSource.includes("this.resizeState = null;"));
    assert.ok(panelSource.includes("this.futureDividerDragState = null;"));
    assert.ok(panelSource.includes("this.launcherDragState = null;"));
  });

  await runCase("future preview UI uses a movable divider and visually ghosted rows", () => {
    const panelSource = fs.readFileSync(path.join(ROOT_DIR, "src", "ui-panel.js"), "utf8");
    const css = fs.readFileSync(path.join(ROOT_DIR, "styles", "panel.css"), "utf8");
    assert.ok(panelSource.includes("dc-future-divider"));
    assert.ok(panelSource.includes("dc-future-section"));
    assert.ok(panelSource.includes("futurePreviewEnabled"));
    assert.ok(panelSource.includes("dc-future-toggle-input"));
    assert.ok(panelSource.includes("handleFutureDividerPointerDown"));
    assert.ok(panelSource.includes("futureDividerDragState"));
    assert.ok(panelSource.includes("dc-chunk-future"));
    assert.ok(panelSource.includes('role", "separator"'));
    assert.ok(!panelSource.includes('divider.textContent = "Next up"'));
    assert.ok(!panelSource.includes('divider.addEventListener("click"'));
    assert.ok(!panelSource.includes("dc-chunk-seek-icon"));
    assert.ok(css.includes(".dc-chunk-future"));
    assert.ok(!css.includes(".dc-chunk-seek-icon"));
    assert.ok(css.includes(".dc-future-divider"));
    assert.ok(css.includes(".dc-future-section"));
    assert.ok(css.includes("height: var(--dc-future-preview-height"));
    assert.ok(css.includes("display: block;"));
    assert.ok(css.includes("grid-template-columns: auto minmax(0, 1fr)"));
    assert.ok(css.includes("border-style: solid"));
    assert.ok(css.includes("text-overflow: ellipsis"));
    assert.ok(css.includes("white-space: nowrap"));
    assert.ok(css.includes("cursor: ns-resize"));
    assert.ok(css.includes("touch-action: none"));
  });

  await runCase("panel reset preserves the selected theme", () => {
    const panelSource = fs.readFileSync(path.join(ROOT_DIR, "src", "ui-panel.js"), "utf8");
    const resetStart = panelSource.indexOf("resetPanelDefaults() {");
    const resetEnd = panelSource.indexOf("applyFuturePreviewHeight()", resetStart);
    assert.ok(resetStart >= 0);
    assert.ok(resetEnd > resetStart);
    const resetBody = panelSource.slice(resetStart, resetEnd);
    assert.ok(resetBody.includes("panelOpacity"));
    assert.ok(resetBody.includes("panelPosition: null"));
    assert.ok(!resetBody.includes("themeName"));
    assert.ok(!resetBody.includes("customThemeColor"));
  });

  await runCase("reading glow cannot persist without an active timing range", () => {
    const panelSource = fs.readFileSync(path.join(ROOT_DIR, "src", "ui-panel.js"), "utf8");
    assert.ok(panelSource.includes("lastGlowWordEnd"));
    assert.ok(panelSource.includes("this.renderChunkText(textElement, chunk, Boolean(range))"));
    assert.ok(panelSource.includes("this.lastGlowWordEnd = nextGlowWordEnd"));
  });

  await runCase("panel exposes basic accessibility labels and reduced-motion CSS", () => {
    const panelSource = fs.readFileSync(path.join(ROOT_DIR, "src", "ui-panel.js"), "utf8");
    const css = fs.readFileSync(path.join(ROOT_DIR, "styles", "panel.css"), "utf8");
    assert.ok(panelSource.includes('aria-label", "MMO dialogue captions panel"'));
    assert.ok(panelSource.includes('aria-live", "polite"'));
    assert.ok(panelSource.includes('title.textContent = "YTMMOCC"'));
    assert.ok(panelSource.includes('aria-label", "Panel theme"'));
    assert.ok(panelSource.includes('aria-label", "Custom theme color"'));
    assert.ok(panelSource.includes('opacityWrap.textContent = "Opacity"'));
    assert.ok(panelSource.includes("dc-theme-select"));
    assert.ok(!panelSource.includes('opacityWrap.textContent = "Blend"'));
    assert.ok(css.includes("@media (prefers-reduced-motion: reduce)"));
  });

  await runCase("README does not imply global keyboard shortcuts or Android targeting", () => {
    const readme = fs.readFileSync(path.join(ROOT_DIR, "README.md"), "utf8");
    assert.ok(readme.includes("Hover the panel and press `Space`"));
    assert.ok(readme.includes("desktop Chrome and desktop Firefox only"));
    assert.ok(readme.includes("Timeline Scrub mode remains experimental and is hidden from the normal release UI."));
    assert.ok(!readme.includes("Optional Timeline Scrub mode turns"));
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
    assert.ok(source.includes("futurePreviewHeight"));
    assert.ok(source.includes("futurePreviewEnabled"));
    assert.ok(source.includes("fadeTowardVideoCenter"));
    assert.ok(source.includes("timelineModeEnabled"));
    const privacy = fs.readFileSync(path.join(ROOT_DIR, "PRIVACY.md"), "utf8");
    assert.ok(!privacy.includes("chunk size"));
    assert.ok(!privacy.includes("keyboard step"));
    assert.ok(!privacy.includes("auto-scroll"));
    assert.ok(privacy.includes("panel theme preset and custom theme color"));
    assert.ok(privacy.includes("next-up preview height"));
    assert.ok(privacy.includes("whether Future / Next Up previews are enabled"));
    assert.ok(privacy.includes("timeline scrub mode"));
    assert.ok(privacy.includes("whether the panel fades toward the center"));
  });

  await runCase("generic video experiment is source-only and not in release manifests", () => {
    const source = fs.readFileSync(path.join(ROOT_DIR, "src", "universal-captions.js"), "utf8");
    assert.ok(source.includes("HTMLVideoElement"));
    assert.ok(source.includes("TextTrack"));
    assert.ok(source.includes("GenericTextTrackAdapter"));
    assert.ok(!source.includes("getUserMedia"));
    assert.ok(!source.includes("MediaRecorder"));
    assert.ok(!source.includes("fetch("));
    for (const fileName of manifests) {
      const manifest = readJson(fileName);
      assert.ok(!JSON.stringify(manifest).includes("universal-captions.js"), fileName);
    }
  });

  await runCase("timeline scrub mode reuses panel chunks and stays optional", () => {
    const panelSource = fs.readFileSync(path.join(ROOT_DIR, "src", "ui-panel.js"), "utf8");
    const scrubSource = fs.readFileSync(path.join(ROOT_DIR, "src", "timeline-scrub.js"), "utf8");
    const css = fs.readFileSync(path.join(ROOT_DIR, "styles", "panel.css"), "utf8");
    assert.ok(panelSource.includes("setTimelineData"));
    assert.ok(panelSource.includes("dc-timeline-lens"));
    assert.ok(panelSource.includes("TIMELINE_MODE_EXPERIMENT_ENABLED = false"));
    assert.ok(panelSource.includes("timelineFeatureEnabled"));
    assert.ok(panelSource.includes("timelineModeEnabled"));
    assert.ok(panelSource.includes("handleTimelineClick"));
    assert.ok(panelSource.includes('this.body.style.display = timelineActive ? "none" : "flex"'));
    assert.ok(panelSource.includes("this.body.hidden = timelineActive"));
    assert.ok(panelSource.includes("timelineDataKey"));
    assert.ok(panelSource.includes("this.timelineHoverIndex = -1;"));
    assert.ok(panelSource.includes("this.timelineHoverTime = Number.NaN;"));
    assert.ok(panelSource.includes("const lensTime = Number.isFinite(this.timelineHoverTime)"));
    assert.ok(panelSource.includes("dc-timeline-lens-text dc-chunk-text"));
    assert.ok(panelSource.includes("this.renderChunkText(text, focusChunk, true, clampedLensTime)"));
    assert.ok(panelSource.includes('this.timelineLayer.style.setProperty("--dc-text-scale"'));
    assert.ok(panelSource.includes('this.timelineLayer.style.setProperty("--dc-accent"'));
    assert.ok(panelSource.includes('this.timelineTooltip.classList.add("is-visible")'));
    assert.ok(panelSource.includes('this.timelineTooltip.classList.toggle("is-hover"'));
    assert.ok(panelSource.includes("Math.pow(blend, 0.72)"));
    assert.ok(panelSource.includes("const fadeX = Math.max(0, Math.min(100"));
    assert.ok(panelSource.includes("const centerAlpha = enabled ?"));
    assert.ok(panelSource.includes('this.root.style.setProperty("--dc-edge-mask-alpha"'));
    assert.ok(panelSource.includes('setAlpha("--dc-panel-alpha-outer", 0.16 + eased * 0.84)'));
    assert.ok(panelSource.includes('setAlpha("--dc-card-alpha", 0.2 + eased * 0.8)'));
    assert.ok(scrubSource.includes("hoverXToTime"));
    assert.ok(scrubSource.includes("findChunkIndexAtTime"));
    assert.ok(css.includes(".dc-timeline-layer"));
    assert.ok(css.includes(".dc-timeline-lens"));
    assert.equal(css.includes(".dc-timeline-lens::after"), false);
    assert.ok(css.includes(".dc-timeline-lens-time"));
    assert.ok(css.includes(".dc-timeline-lens-text"));
    assert.ok(css.includes("background: transparent;"));
    assert.ok(css.includes("radial-gradient("));
    assert.ok(css.includes('font-family: "Trebuchet MS", "Segoe UI", sans-serif;'));
    assert.ok(css.includes("font-size: calc(15px * var(--dc-text-scale, 1.2))"));
    assert.ok(css.includes("width: min(860px, 82vw)"));
    assert.ok(css.includes(".dc-timeline-lens.is-hover"));
    assert.ok(css.includes(".dc-panel.is-timeline-scrub .dc-controls"));
    assert.ok(!css.includes(".dc-rail-popover"));
    assert.ok(css.includes(".dc-panel-open .ytp-caption-window-rollup"));
    assert.ok(css.includes(".dc-panel-open .ytp-caption-segment"));
  });

  await runCase("video-anchored panel mounts inside the player instead of floating over comments", () => {
    const panelSource = fs.readFileSync(path.join(ROOT_DIR, "src", "ui-panel.js"), "utf8");
    const css = fs.readFileSync(path.join(ROOT_DIR, "styles", "panel.css"), "utf8");
    assert.ok(panelSource.includes("resolveMountElement()"));
    assert.ok(panelSource.includes('(this.mountElement || document.body).append(this.root)'));
    assert.ok(panelSource.includes("getElementLocalRect"));
    assert.ok(panelSource.includes("localToPlayerPanelPosition"));
    assert.ok(panelSource.includes("isAnchorUsablyVisible()"));
    assert.ok(panelSource.includes("is-anchor-offscreen"));
    assert.ok(css.includes("dc-player-host"));
    assert.ok(css.includes("position: absolute;"));
    assert.ok(css.includes(".dc-panel.is-anchor-offscreen"));
    assert.ok(css.includes(".dc-launcher.is-anchor-offscreen"));
  });
};
