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
      keyboardStepSeconds: 999
    });
    assert.equal(result.panelOpacity, 100);
    assert.equal(result.textScale, 100);
    assert.equal(result.keyboardStepSeconds, 30);
  });

  await runCase("settings normalization sanitizes position objects", () => {
    const { normalize } = makeStore();
    const result = normalize({
      panelPosition: { left: -50, top: 20.4 },
      panelSize: { width: 200, height: 150 },
      launcherPosition: { left: 12.6, top: -3 }
    });
    assert.deepEqual(result.panelPosition, { left: 0, top: 20 });
    assert.deepEqual(result.panelSize, { width: 280, height: 220 });
    assert.deepEqual(result.launcherPosition, { left: 13, top: 0 });
  });

  await runCase("settings defaults to closed pill launch", () => {
    const { normalize } = makeStore();
    const result = normalize({});
    assert.equal(result.panelClosed, true);
    assert.equal(result.textScale, 120);
    assert.equal(result.schemaVersion, 1);
  });

  await runCase("settings save writes normalized values", async () => {
    const { store, saved } = makeStore();
    const persisted = await store.save({
      plan: "premium",
      panelOpacity: 12,
      textScale: 999
    });
    assert.equal(persisted.plan, "premium");
    assert.equal(persisted.panelOpacity, 35);
    assert.equal(persisted.textScale, 200);
    assert.equal(persisted.schemaVersion, 1);
    assert.ok(saved["dialogueCaptions.settings.v1"]);
  });

  await runCase("settings load migrates legacy preferences and drops transient video state", async () => {
    const { store } = makeStore(null, {
      panelClosed: false,
      panelOpacity: 77,
      textScale: 145,
      panelPosition: { left: 45, top: 80 },
      panelSize: { width: 640, height: 420 },
      launcherPosition: { left: 15, top: 300 },
      activeVideoId: "should-not-persist",
      activeBubbleIndex: 4,
      transcriptText: "should not be stored"
    });
    const loaded = await store.load();
    assert.equal(loaded.schemaVersion, 1);
    assert.equal(loaded.panelClosed, false);
    assert.equal(loaded.panelOpacity, 77);
    assert.equal(loaded.textScale, 145);
    assert.deepEqual(loaded.panelPosition, { left: 45, top: 80 });
    assert.deepEqual(loaded.panelSize, { width: 640, height: 420 });
    assert.deepEqual(loaded.launcherPosition, { left: 15, top: 300 });
    assert.equal(Object.prototype.hasOwnProperty.call(loaded, "activeVideoId"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(loaded, "activeBubbleIndex"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(loaded, "transcriptText"), false);
  });
};
