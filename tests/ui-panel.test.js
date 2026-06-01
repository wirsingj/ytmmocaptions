exports.run = async function runUiPanelTests(ctx) {
  const { assert, loadModule, runCase } = ctx;

  function loadPanelModule() {
    const settingsModule = loadModule("settings-store.js", {
      windowProps: {
        DialogueCaptions: {
          platform: {
            async storageGet() {
              return {};
            },
            async storageSet() {}
          }
        }
      }
    });
    return loadModule("ui-panel.js", {
      windowProps: {
        DialogueCaptions: {
          settingsStore: settingsModule.settingsStore,
          platform: {
            requestFrame() {
              return 0;
            },
            cancelFrame() {},
            setText() {}
          },
          bubbleState: {},
          chunker: {},
          timelineScrub: {},
          captionText: {}
        }
      },
      globalProps: {
        Element: function Element() {}
      }
    });
  }

  await runCase("workspace preset capture apply and toggle-off restores baseline", () => {
    const module = loadPanelModule();
    const settingsStore = module.settingsStore;
    const changes = [];
    const panel = new module.DialoguePanel({
      settings: settingsStore.normalizeSettings({
        panelOpacity: 48,
        textScale: 125,
        themeName: "stone",
        customThemeColor: "#ded6c3",
        fadeTowardVideoCenter: true,
        futurePreviewEnabled: true,
        caseFixEnabled: true
      }),
      onSettingsChange(settings, patch) {
        changes.push({ settings, patch });
      }
    });

    panel.captureWorkspacePreset(1);
    assert.equal(panel.settings.workspacePresets[0].textScale, 125);
    assert.equal(panel.settings.workspacePresets[0].panelOpacity, 48);
    assert.equal(Object.prototype.hasOwnProperty.call(panel.settings.workspacePresets[0], "layoutLocked"), false);

    panel.updateSettings({
      panelOpacity: 82,
      textScale: 170,
      themeName: "custom",
      customThemeColor: "#225588",
      futurePreviewEnabled: false,
      caseFixEnabled: false
    });
    panel.toggleWorkspacePreset(1);

    assert.equal(panel.settings.activeWorkspacePreset, 1);
    assert.equal(panel.settings.panelOpacity, 48);
    assert.equal(panel.settings.textScale, 125);
    assert.equal(panel.settings.themeName, "stone");
    assert.equal(panel.settings.workspacePresetBaseline.panelOpacity, 82);
    assert.equal(panel.settings.workspacePresetBaseline.textScale, 170);
    assert.equal(panel.settings.workspacePresetBaseline.themeName, "custom");

    panel.toggleWorkspacePreset(1);
    assert.equal(panel.settings.activeWorkspacePreset, null);
    assert.equal(panel.settings.workspacePresetBaseline, null);
    assert.equal(panel.settings.panelOpacity, 82);
    assert.equal(panel.settings.textScale, 170);
    assert.equal(panel.settings.themeName, "custom");
    assert.equal(panel.settings.futurePreviewEnabled, false);
    assert.equal(panel.settings.caseFixEnabled, false);
    assert.ok(changes.length >= 4);
  });

  await runCase("empty workspace preset apply is a no-op", () => {
    const module = loadPanelModule();
    const settingsStore = module.settingsStore;
    const panel = new module.DialoguePanel({
      settings: settingsStore.normalizeSettings({
        panelOpacity: 64,
        textScale: 140,
        workspacePresets: [null, null, null]
      })
    });

    panel.toggleWorkspacePreset(2);
    assert.equal(panel.settings.activeWorkspacePreset, null);
    assert.equal(panel.settings.panelOpacity, 64);
    assert.equal(panel.settings.textScale, 140);
  });

  await runCase("reset drops active preset override without deleting saved presets", () => {
    const module = loadPanelModule();
    const settingsStore = module.settingsStore;
    const preset = {
      panelOpacity: 72,
      textScale: 165,
      themeName: "ocean",
      customThemeColor: "#ded6c3",
      fadeTowardVideoCenter: false,
      panelPosition: { anchor: "player", left: 100, top: 44 },
      panelSize: { width: 620, height: 360 },
      futurePreviewEnabled: false,
      caseFixEnabled: false
    };
    const panel = new module.DialoguePanel({
      settings: settingsStore.normalizeSettings({
        ...preset,
        workspacePresets: [preset, null, null],
        activeWorkspacePreset: 1,
        workspacePresetBaseline: {
          panelOpacity: 50,
          textScale: 120,
          themeName: "stone",
          customThemeColor: "#ded6c3",
          fadeTowardVideoCenter: true,
          panelPosition: null,
          panelSize: null,
          futurePreviewEnabled: true,
          caseFixEnabled: true
        }
      })
    });

    panel.resetPanelDefaults();
    assert.equal(panel.settings.activeWorkspacePreset, null);
    assert.equal(panel.settings.workspacePresetBaseline, null);
    assert.equal(panel.settings.workspacePresets[0].textScale, 165);
    assert.equal(panel.settings.textScale, settingsStore.DEFAULTS.textScale);
    assert.equal(panel.settings.panelClosed, false);
  });
};
