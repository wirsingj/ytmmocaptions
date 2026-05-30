exports.run = async function runSettingsStoreTests(ctx) {
  const { assert, loadModule, runCase } = ctx;

  function makeStore(overrides, storedSettings) {
    const saved = {};
    const platform = {
      async storageGet() {
        return storedSettings
          ? { "dialogueCaptions.settings.v1": storedSettings }
          : {};
      },
      async storageSet(values) {
        Object.assign(saved, values);
      }
    };
    const module = loadModule("settings-store.js", {
      windowProps: {
        DialogueCaptions: {
          platform
        }
      }
    });
    const store = module.settingsStore;
    return {
      store,
      saved,
      normalize(input) {
        return store.normalizeSettings({ ...(overrides || {}), ...(input || {}) });
      }
    };
  }

  await runCase("settings normalization clamps numeric ranges", () => {
    const { normalize } = makeStore();
    const result = normalize({
      panelOpacity: 1000,
      textScale: 25,
      keyboardStepSeconds: 999,
      themeName: "forest",
      customThemeColor: "#AABBCC",
      autoScroll: false
    });
    assert.equal(result.panelOpacity, 100);
    assert.equal(result.textScale, 100);
    assert.equal(result.themeName, "forest");
    assert.equal(result.customThemeColor, "#aabbcc");
    assert.equal(Object.prototype.hasOwnProperty.call(result, "keyboardStepSeconds"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result, "autoScroll"), false);
  });

  await runCase("settings normalization sanitizes position objects", () => {
    const { normalize } = makeStore();
    const result = normalize({
      panelPosition: { left: -50, top: 20.4 },
      panelSize: { width: 200, height: 150 },
      futurePreviewHeight: 999,
      futurePreviewEnabled: false,
      fadeTowardVideoCenter: false,
      videoCenterFadeStrength: 999,
      videoCenterFadeMidpoint: 999,
      videoCenterFadeMinOpacity: -10,
      timelineModeEnabled: true,
      launcherPosition: { left: 12.6, top: -3 }
    });
    assert.deepEqual(result.panelPosition, { left: 0, top: 20 });
    assert.deepEqual(result.panelSize, { width: 280, height: 220 });
    assert.equal(result.futurePreviewHeight, 360);
    assert.equal(result.futurePreviewEnabled, false);
    assert.equal(result.fadeTowardVideoCenter, false);
    assert.equal(result.videoCenterFadeStrength, 90);
    assert.equal(result.videoCenterFadeMidpoint, 80);
    assert.equal(result.videoCenterFadeMinOpacity, 8);
    assert.equal(result.timelineModeEnabled, true);
    assert.deepEqual(result.launcherPosition, { left: 13, top: 0 });
  });

  await runCase("settings defaults to closed pill launch", () => {
    const { normalize } = makeStore();
    const result = normalize({});
    assert.equal(result.panelClosed, true);
    assert.equal(result.panelOpacity, 55);
    assert.equal(result.textScale, 120);
    assert.equal(result.themeName, "stone");
    assert.equal(result.customThemeColor, "#ded6c3");
    assert.equal(result.futurePreviewHeight, 150);
    assert.equal(result.futurePreviewEnabled, true);
    assert.equal(result.fadeTowardVideoCenter, true);
    assert.equal(result.videoCenterFadeStrength, 84);
    assert.equal(result.videoCenterFadeMidpoint, 50);
    assert.equal(result.videoCenterFadeMinOpacity, 12);
    assert.equal(result.timelineModeEnabled, false);
    assert.equal(result.schemaVersion, 1);
  });

  await runCase("settings normalization sanitizes theme preferences", () => {
    const { normalize } = makeStore();
    const invalid = normalize({
      themeName: "neon-chaos",
      customThemeColor: "javascript:alert(1)"
    });
    assert.equal(invalid.themeName, "stone");
    assert.equal(invalid.customThemeColor, "#ded6c3");

    const custom = normalize({
      themeName: "custom",
      customThemeColor: "#77CCAA"
    });
    assert.equal(custom.themeName, "custom");
    assert.equal(custom.customThemeColor, "#77ccaa");
  });

  await runCase("settings save writes normalized values", async () => {
    const { store, saved } = makeStore();
    const persisted = await store.save({
      panelOpacity: 12,
      textScale: 999,
      themeName: "ocean",
      customThemeColor: "#336699",
      futurePreviewHeight: 42,
      futurePreviewEnabled: false,
      fadeTowardVideoCenter: false,
      videoCenterFadeStrength: -5,
      videoCenterFadeMidpoint: 10,
      videoCenterFadeMinOpacity: 99,
      timelineModeEnabled: true,
      plan: "legacy-ignored",
      featureOverrides: { oldGate: true },
      globalKeyboardEnabled: true,
      chunkSize: "long",
      keyboardStepSeconds: 30,
      autoScroll: false
    });
    assert.equal(persisted.panelOpacity, 12);
    assert.equal(persisted.textScale, 200);
    assert.equal(persisted.themeName, "ocean");
    assert.equal(persisted.customThemeColor, "#336699");
    assert.equal(persisted.futurePreviewHeight, 52);
    assert.equal(persisted.futurePreviewEnabled, false);
    assert.equal(persisted.fadeTowardVideoCenter, false);
    assert.equal(persisted.videoCenterFadeStrength, 0);
    assert.equal(persisted.videoCenterFadeMidpoint, 20);
    assert.equal(persisted.videoCenterFadeMinOpacity, 70);
    assert.equal(persisted.timelineModeEnabled, true);
    assert.equal(persisted.schemaVersion, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, "plan"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, "featureOverrides"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, "globalKeyboardEnabled"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, "chunkSize"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, "keyboardStepSeconds"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, "autoScroll"), false);
    assert.ok(saved["dialogueCaptions.settings.v1"]);
  });

  await runCase("settings load migrates legacy preferences and drops transient video state", async () => {
    const { store } = makeStore(null, {
      panelClosed: false,
      panelOpacity: 77,
      textScale: 145,
      themeName: "ember",
      customThemeColor: "#aa5500",
      panelPosition: { left: 45, top: 80 },
      panelSize: { width: 640, height: 420 },
      futurePreviewHeight: 205,
      futurePreviewEnabled: false,
      fadeTowardVideoCenter: false,
      videoCenterFadeStrength: 77,
      videoCenterFadeMidpoint: 52,
      videoCenterFadeMinOpacity: 18,
      timelineModeEnabled: true,
      launcherPosition: { left: 15, top: 300 },
      chunkSize: "short",
      keyboardStepSeconds: 12,
      autoScroll: false,
      activeVideoId: "should-not-persist",
      activeBubbleIndex: 4,
      transcriptText: "should not be stored"
    });
    const loaded = await store.load();
    assert.equal(loaded.schemaVersion, 1);
    assert.equal(loaded.panelClosed, false);
    assert.equal(loaded.panelOpacity, 77);
    assert.equal(loaded.textScale, 145);
    assert.equal(loaded.themeName, "ember");
    assert.equal(loaded.customThemeColor, "#aa5500");
    assert.deepEqual(loaded.panelPosition, { left: 45, top: 80 });
    assert.deepEqual(loaded.panelSize, { width: 640, height: 420 });
    assert.equal(loaded.futurePreviewHeight, 205);
    assert.equal(loaded.futurePreviewEnabled, false);
    assert.equal(loaded.fadeTowardVideoCenter, false);
    assert.equal(loaded.videoCenterFadeStrength, 77);
    assert.equal(loaded.videoCenterFadeMidpoint, 52);
    assert.equal(loaded.videoCenterFadeMinOpacity, 18);
    assert.equal(loaded.timelineModeEnabled, true);
    assert.deepEqual(loaded.launcherPosition, { left: 15, top: 300 });
    assert.equal(Object.prototype.hasOwnProperty.call(loaded, "chunkSize"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(loaded, "keyboardStepSeconds"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(loaded, "autoScroll"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(loaded, "activeVideoId"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(loaded, "activeBubbleIndex"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(loaded, "transcriptText"), false);
  });
};
