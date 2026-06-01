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

  await runCase("rainbow theme toggle previews live color and restores prior color", () => {
    const module = loadPanelModule();
    const settingsStore = module.settingsStore;
    const changes = [];
    const panel = new module.DialoguePanel({
      settings: settingsStore.normalizeSettings({
        themeName: "custom",
        customThemeColor: "#336699"
      }),
      onSettingsChange(settings, patch) {
        changes.push({ settings, patch });
      }
    });

    panel.toggleRainbowThemeMode();
    assert.equal(panel.settings.themeName, "custom");
    assert.equal(panel.settings.customThemeColor, "#336699");
    assert.equal(panel.isRainbowThemeEnabled(), true);
    assert.equal(changes.length, 0);

    panel.applyRainbowThemeColor("#77aa44");
    assert.equal(panel.getCustomThemeColor(), "#77aa44");
    assert.equal(panel.settings.customThemeColor, "#336699");
    assert.equal(changes.length, 0);

    panel.toggleRainbowThemeMode();
    assert.equal(panel.isRainbowThemeEnabled(), false);
    assert.equal(panel.settings.customThemeColor, "#336699");
    assert.equal(changes.length, 1);
    assert.equal(changes[0].patch.themeName, "custom");
    assert.equal(changes[0].patch.customThemeColor, "#336699");
  });

  await runCase("workspace preset apply cancels temporary rainbow preview", () => {
    const module = loadPanelModule();
    const settingsStore = module.settingsStore;
    const preset = {
      panelOpacity: 70,
      textScale: 135,
      themeName: "forest",
      customThemeColor: "#225588",
      fadeTowardVideoCenter: true,
      panelPosition: null,
      panelSize: null,
      futurePreviewEnabled: true,
      caseFixEnabled: true
    };
    const panel = new module.DialoguePanel({
      settings: settingsStore.normalizeSettings({
        themeName: "custom",
        customThemeColor: "#336699",
        workspacePresets: [preset, null, null]
      })
    });

    panel.toggleRainbowThemeMode();
    panel.applyRainbowThemeColor("#77aa44");
    panel.toggleWorkspacePreset(1);

    assert.equal(panel.isRainbowThemeEnabled(), false);
    assert.equal(panel.settings.activeWorkspacePreset, 1);
    assert.equal(panel.settings.themeName, "forest");
    assert.equal(panel.getThemeName(), "forest");
  });

  await runCase("bounded history render range includes active and latest rows", () => {
    const module = loadPanelModule();
    const panel = new module.DialoguePanel({ settings: module.settingsStore.normalizeSettings({}) });
    panel.chunks = Array.from({ length: 500 }, (_, index) => ({ start: index, end: index + 0.5, text: "line " + index }));

    panel.activeIndex = 250;
    panel.stickToBottom = false;
    let range = panel.getHistoryRenderRange(panel.chunks.length);
    assert.ok(range.start <= 250 && range.end >= 250, JSON.stringify(range));
    assert.ok(range.end - range.start + 1 <= 220, JSON.stringify(range));

    panel.activeIndex = 499;
    panel.stickToBottom = true;
    range = panel.getHistoryRenderRange(panel.chunks.length);
    assert.equal(range.end, 499);
    assert.ok(range.start > 0);
    assert.ok(range.end - range.start + 1 <= 220, JSON.stringify(range));
  });

  await runCase("bounded history window shifts without gaps or duplicates", () => {
    const module = loadPanelModule();
    const panel = new module.DialoguePanel({ settings: module.settingsStore.normalizeSettings({}) });
    panel.chunks = Array.from({ length: 500 }, (_, index) => ({ start: index, end: index + 0.5, text: "line " + index }));

    panel.setHistoryRenderStart(200);
    assert.equal(panel.currentWindowStart, 200);
    assert.equal(panel.currentWindowEnd, 419);
    panel.setHistoryRenderStart(panel.currentWindowStart - 110);
    assert.equal(panel.currentWindowStart, 90);
    assert.equal(panel.currentWindowEnd, 309);
    panel.setHistoryRenderStart(panel.currentWindowStart + 110);
    assert.equal(panel.currentWindowStart, 200);
    assert.equal(panel.currentWindowEnd, 419);

    const seen = new Set();
    for (let index = panel.currentWindowStart; index <= panel.currentWindowEnd; index += 1) {
      assert.equal(seen.has(index), false);
      seen.add(index);
    }
    assert.equal(seen.size, 220);
  });

  await runCase("style trimming keeps transcript data logically available", () => {
    const module = loadPanelModule();
    const panel = new module.DialoguePanel({ settings: module.settingsStore.normalizeSettings({ textScale: 120 }) });
    let renderCount = 0;
    panel.chunks = Array.from({ length: 500 }, (_, index) => ({ start: index, end: index + 0.5, text: "line " + index }));
    panel.futureChunks = Array.from({ length: 300 }, (_, index) => ({ start: index + 500, end: index + 500.5, text: "future " + index }));
    panel.currentWindowStart = 120;
    panel.currentWindowEnd = 339;
    panel.futureRenderLimit = 240;
    panel.currentFutureRenderedCount = 240;
    panel.root = {};
    panel.body = {};
    panel.windowContainer = {};
    panel.renderWindow = () => {
      renderCount += 1;
    };
    panel.applySettings = () => {};

    panel.updateSettings({ textScale: 140 });
    assert.equal(panel.chunks.length, 500);
    assert.equal(panel.futureChunks.length, 300);
    assert.equal(panel.futureRenderLimit, 80);
    assert.equal(panel.currentWindowEnd - panel.currentWindowStart + 1, 220);
    assert.equal(renderCount, 1);
  });

  await runCase("setActiveIndex ensures visible even when active index is unchanged", () => {
    const module = loadPanelModule();
    const panel = new module.DialoguePanel({ settings: module.settingsStore.normalizeSettings({}) });
    let ensured = -1;
    panel.chunks = Array.from({ length: 500 }, (_, index) => ({ start: index, end: index + 0.5, text: "line " + index }));
    panel.activeIndex = 250;
    panel.currentWindowStart = 0;
    panel.currentWindowEnd = 219;
    panel.ensureIndexVisible = (index) => {
      ensured = index;
    };
    panel.updateJumpBottomVisibility = () => {};
    panel.scheduleWindowRender = () => {};

    panel.setActiveIndex(250, { ensureVisible: true });
    assert.equal(ensured, 250);
  });
};
