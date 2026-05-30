exports.run = async function runSettingsStoreTests(ctx) {
  const { assert, loadModule, runCase } = ctx;

  function makeStore(overrides, storedSettings, options) {
    const saved = {};
    let currentStored = storedSettings || null;
    let pendingStorageSet = null;
    const platform = {
      async storageGet() {
        return currentStored
          ? { "dialogueCaptions.settings.v1": currentStored }
          : {};
      },
      async storageSet(values) {
        if (options && options.deferStorageSet) {
          await new Promise((resolve) => {
            pendingStorageSet = resolve;
          });
        }
        Object.assign(saved, values);
        if (values && values["dialogueCaptions.settings.v1"]) {
          currentStored = values["dialogueCaptions.settings.v1"];
        }
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
      releaseStorageSet() {
        if (pendingStorageSet) {
          const release = pendingStorageSet;
          pendingStorageSet = null;
          release();
        }
      },
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
      panelPosition: { anchor: "player", left: -50, top: 20.4 },
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
    assert.deepEqual(result.panelPosition, { anchor: "player", left: 0, top: 20 });
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
    assert.equal(result.futurePreviewHeight, 96);
    assert.equal(result.futurePreviewEnabled, true);
    assert.equal(result.fadeTowardVideoCenter, true);
    assert.equal(result.videoCenterFadeStrength, 84);
    assert.equal(result.videoCenterFadeMidpoint, 50);
    assert.equal(result.videoCenterFadeMinOpacity, 12);
    assert.equal(result.layoutLocked, false);
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
      layoutLocked: false,
      panelPosition: { anchor: "player", left: 42, top: 80 },
      panelSize: { width: 620, height: 340 },
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
    assert.equal(persisted.layoutLocked, false);
    assert.equal(persisted.timelineModeEnabled, true);
    assert.equal(persisted.schemaVersion, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, "plan"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, "featureOverrides"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, "globalKeyboardEnabled"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, "chunkSize"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, "keyboardStepSeconds"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, "autoScroll"), false);
    const stored = saved["dialogueCaptions.settings.v1"];
    assert.ok(stored);
    assert.equal(stored.panelOpacity, 12);
    assert.equal(stored.themeName, "ocean");
    assert.equal(stored.customThemeColor, "#336699");
    assert.equal(stored.fadeTowardVideoCenter, false);
    assert.equal(stored.layoutLocked, false);
    assert.equal(Object.prototype.hasOwnProperty.call(stored, "textScale"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(stored, "panelPosition"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(stored, "panelSize"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(stored, "futurePreviewHeight"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(stored, "futurePreviewEnabled"), false);
  });

  await runCase("settings patch save keeps unlocked layout changes session-local", async () => {
    const { store, saved } = makeStore(null, {
      panelOpacity: 42,
      textScale: 120,
      themeName: "custom",
      customThemeColor: "#44aa99",
      layoutLocked: false,
      panelPosition: { anchor: "player", left: 14, top: 22 }
    });
    const afterOpacity = await store.savePatch({ panelOpacity: 88 });
    assert.equal(afterOpacity.panelOpacity, 88);
    assert.equal(afterOpacity.themeName, "custom");
    assert.equal(afterOpacity.customThemeColor, "#44aa99");

    const afterLayout = await store.savePatch({ panelPosition: { anchor: "player", left: 120, top: 34 } });
    assert.equal(afterLayout.panelOpacity, 88);
    assert.equal(afterLayout.themeName, "custom");
    assert.equal(afterLayout.customThemeColor, "#44aa99");
    assert.deepEqual(afterLayout.panelPosition, { anchor: "player", left: 120, top: 34 });
    assert.equal(saved["dialogueCaptions.settings.v1"].panelOpacity, 88);
    assert.equal(saved["dialogueCaptions.settings.v1"].customThemeColor, "#44aa99");
    assert.equal(Object.prototype.hasOwnProperty.call(saved["dialogueCaptions.settings.v1"], "panelPosition"), false);
  });

  await runCase("settings patch save persists full layout when layout lock is enabled", async () => {
    const { store, saved } = makeStore(null, {
      panelOpacity: 48,
      themeName: "stone",
      customThemeColor: "#ded6c3"
    });
    const locked = await store.savePatch({
      panelOpacity: 72,
      themeName: "custom",
      customThemeColor: "#445566",
      fadeTowardVideoCenter: false,
      layoutLocked: true,
      textScale: 145,
      panelPosition: { anchor: "player", left: 88, top: 44 },
      panelSize: { width: 640, height: 360 },
      futurePreviewHeight: 150,
      futurePreviewEnabled: false,
      launcherPosition: { left: 12, top: 34 },
      panelClosed: false
    });

    assert.equal(locked.layoutLocked, true);
    assert.equal(locked.textScale, 145);
    assert.deepEqual(locked.panelPosition, { anchor: "player", left: 88, top: 44 });
    assert.deepEqual(locked.panelSize, { width: 640, height: 360 });
    assert.equal(locked.futurePreviewHeight, 150);
    assert.equal(locked.futurePreviewEnabled, false);
    assert.deepEqual(locked.launcherPosition, { left: 12, top: 34 });
    assert.equal(locked.panelClosed, false);

    const stored = saved["dialogueCaptions.settings.v1"];
    assert.equal(stored.layoutLocked, true);
    assert.equal(stored.textScale, 145);
    assert.deepEqual(stored.panelPosition, { anchor: "player", left: 88, top: 44 });
    assert.deepEqual(stored.panelSize, { width: 640, height: 360 });
    assert.equal(stored.futurePreviewHeight, 150);
    assert.equal(stored.futurePreviewEnabled, false);
    assert.deepEqual(stored.launcherPosition, { left: 12, top: 34 });
    assert.equal(stored.panelClosed, false);
  });

  await runCase("locked layout survives follow-up geometry patch saves", async () => {
    const { store, saved } = makeStore(null, {
      panelOpacity: 70,
      themeName: "custom",
      customThemeColor: "#445566",
      fadeTowardVideoCenter: true,
      layoutLocked: true,
      textScale: 135,
      panelPosition: { anchor: "player", left: 30, top: 40 },
      panelSize: { width: 560, height: 330 },
      futurePreviewHeight: 125,
      futurePreviewEnabled: true,
      panelClosed: false
    });

    const persisted = await store.savePatch({
      panelPosition: { anchor: "player", left: 144, top: 70 }
    });

    assert.equal(persisted.layoutLocked, true);
    assert.equal(persisted.panelClosed, false);
    assert.equal(persisted.textScale, 135);
    assert.deepEqual(persisted.panelSize, { width: 560, height: 330 });
    assert.deepEqual(persisted.panelPosition, { anchor: "player", left: 144, top: 70 });
    assert.equal(saved["dialogueCaptions.settings.v1"].panelClosed, false);
    assert.deepEqual(saved["dialogueCaptions.settings.v1"].panelPosition, { anchor: "player", left: 144, top: 70 });
  });

  await runCase("settings load waits for pending local preference writes", async () => {
    const { store, releaseStorageSet } = makeStore(null, {
      panelOpacity: 35,
      themeName: "stone",
      customThemeColor: "#ded6c3"
    }, { deferStorageSet: true });

    const savePromise = store.savePatch({
      panelOpacity: 92,
      themeName: "custom",
      customThemeColor: "#2255aa"
    });
    const loadPromise = store.load();
    await Promise.resolve();
    releaseStorageSet();

    const loaded = await loadPromise;
    await savePromise;
    assert.equal(loaded.panelOpacity, 92);
    assert.equal(loaded.themeName, "custom");
    assert.equal(loaded.customThemeColor, "#2255aa");
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
      layoutLocked: false,
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
    assert.equal(loaded.panelClosed, true);
    assert.equal(loaded.panelOpacity, 77);
    assert.equal(loaded.textScale, 120);
    assert.equal(loaded.themeName, "ember");
    assert.equal(loaded.customThemeColor, "#aa5500");
    assert.equal(loaded.panelPosition, null);
    assert.equal(loaded.panelSize, null);
    assert.equal(loaded.futurePreviewHeight, 96);
    assert.equal(loaded.futurePreviewEnabled, true);
    assert.equal(loaded.fadeTowardVideoCenter, false);
    assert.equal(loaded.videoCenterFadeStrength, 84);
    assert.equal(loaded.videoCenterFadeMidpoint, 50);
    assert.equal(loaded.videoCenterFadeMinOpacity, 12);
    assert.equal(loaded.layoutLocked, false);
    assert.equal(loaded.timelineModeEnabled, false);
    assert.equal(loaded.launcherPosition, null);
    assert.equal(Object.prototype.hasOwnProperty.call(loaded, "chunkSize"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(loaded, "keyboardStepSeconds"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(loaded, "autoScroll"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(loaded, "activeVideoId"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(loaded, "activeBubbleIndex"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(loaded, "transcriptText"), false);
  });
};
