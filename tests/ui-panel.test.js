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

  await runCase("seeded music workspace preset applies and starts temporary rainbow", () => {
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
    assert.equal(panel.settings.activeWorkspacePreset, 2);
    assert.equal(panel.settings.panelOpacity, 10);
    assert.equal(panel.settings.textScale, 175);
    assert.equal(panel.settings.themeName, "custom");
    assert.equal(panel.settings.caseFixEnabled, false);
    assert.equal(panel.settings.fadeTowardVideoCenter, false);
    assert.equal(panel.isRainbowThemeEnabled(), true);
    assert.equal(panel.settings.customThemeColor, "#d62fbe");
    assert.notEqual(panel.getCustomThemeColor(), "#d62fbe");
  });

  await runCase("overwritten music preset does not auto-start rainbow", () => {
    const module = loadPanelModule();
    const settingsStore = module.settingsStore;
    const customMusicSlot = {
      panelOpacity: 64,
      textScale: 130,
      themeName: "forest",
      customThemeColor: "#ded6c3",
      fadeTowardVideoCenter: false,
      panelPosition: null,
      panelSize: null,
      futurePreviewEnabled: true,
      caseFixEnabled: true
    };
    const panel = new module.DialoguePanel({
      settings: settingsStore.normalizeSettings({
        workspacePresets: [null, customMusicSlot, null]
      })
    });

    panel.toggleWorkspacePreset(2);
    assert.equal(panel.settings.activeWorkspacePreset, 2);
    assert.equal(panel.settings.themeName, "forest");
    assert.equal(panel.isRainbowThemeEnabled(), false);
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

  await runCase("default panel rect uses player-local coordinates", () => {
    const module = loadPanelModule();
    const panel = new module.DialoguePanel({ settings: module.settingsStore.normalizeSettings({}) });
    panel.getYouTubeFrameRect = () => ({ left: 28, top: 12, right: 1492, bottom: 836 });
    panel.getMountViewportRect = () => ({ left: 28, top: 12, right: 1492, bottom: 836 });

    const rect = panel.getDefaultPanelRect();

    assert.equal(rect.left, 12);
    assert.equal(rect.width, 680);
    assert.ok(rect.top >= 0);
    assert.ok(rect.top + rect.height <= 824 - 64 - 12);
  });

  await runCase("default launcher tucks to player bottom-left above controls", () => {
    const module = loadPanelModule();
    const panel = new module.DialoguePanel({ settings: module.settingsStore.normalizeSettings({}) });
    panel.getMountViewportRect = () => ({ left: 100, top: 50, right: 1500, bottom: 950 });
    panel.getYouTubeFrameRect = () => ({ left: 140, top: 70, right: 1340, bottom: 745 });

    const frame = panel.getLauncherFrameRect();
    const position = panel.clampLauncherPosition(
      frame.left + 14,
      frame.bottom - 32 - 14,
      96,
      32
    );

    assert.equal(frame.left, 40);
    assert.equal(frame.bottom, 745 - 50 - 54);
    assert.equal(position.left, 54);
    assert.equal(position.top, 745 - 50 - 54 - 32 - 14);
  });

  await runCase("saved panel position preserves bottom-left intent above fullscreen controls", () => {
    const module = loadPanelModule();
    const panel = new module.DialoguePanel({ settings: module.settingsStore.normalizeSettings({}) });
    panel.getMountViewportRect = () => ({ left: 0, top: 0, right: 1280, bottom: 720 });
    panel.getYouTubeFrameRect = () => ({ left: 0, top: 0, right: 1280, bottom: 720 });
    panel.getVisibleYouTubeFrameRect = () => ({ left: 0, top: 0, right: 1280, bottom: 720 });

    const safeBottom = 720 - 64;
    const saved = panel.localToPlayerPanelPosition(12, safeBottom - 260 - 12, 420, 260);

    assert.equal(saved.anchor, "player");
    assert.equal(saved.xRatio, 0);
    assert.equal(saved.yRatio, 1);

    panel.settings = module.settingsStore.normalizeSettings({ panelPosition: saved });
    panel.getMountViewportRect = () => ({ left: 0, top: 0, right: 1920, bottom: 1080 });
    panel.getYouTubeFrameRect = () => ({ left: 0, top: 0, right: 1920, bottom: 1080 });
    panel.getVisibleYouTubeFrameRect = () => ({ left: 0, top: 0, right: 1920, bottom: 1080 });

    const restored = panel.panelPositionToLocal(420, 260);

    assert.equal(restored.left, 12);
    assert.equal(restored.top, 1080 - 64 - 260 - 12);
  });

  await runCase("panel clamp shrinks oversized layouts inside fullscreen safe zone", () => {
    const module = loadPanelModule();
    const panel = new module.DialoguePanel({ settings: module.settingsStore.normalizeSettings({}) });
    panel.getMountViewportRect = () => ({ left: 0, top: 0, right: 1920, bottom: 1080 });
    panel.getYouTubeFrameRect = () => ({ left: 0, top: 0, right: 1920, bottom: 1080 });

    const clamped = panel.clampPanelPosition(-40, 900, 2400, 1200);

    assert.equal(clamped.left, 12);
    assert.equal(clamped.top, 12);
    assert.equal(clamped.width, 1920 - 24);
    assert.equal(clamped.height, 1080 - 64 - 24);
    assert.ok(clamped.resized);
    assert.ok(clamped.top + clamped.height <= 1080 - 64 - 12);
  });

  await runCase("oversized saved panel restores without overlapping fullscreen controls", () => {
    const module = loadPanelModule();
    const panel = new module.DialoguePanel({
      settings: module.settingsStore.normalizeSettings({
        panelPosition: { anchor: "player", left: 0, top: 0, xRatio: 0, yRatio: 1 }
      })
    });
    panel.getMountViewportRect = () => ({ left: 0, top: 0, right: 1920, bottom: 1080 });
    panel.getYouTubeFrameRect = () => ({ left: 0, top: 0, right: 1920, bottom: 1080 });
    panel.getVisibleYouTubeFrameRect = () => ({ left: 0, top: 0, right: 1920, bottom: 1080 });

    const restored = panel.panelPositionToLocal(2400, 1200);

    assert.equal(restored.left, 12);
    assert.equal(restored.top, 12);
    assert.equal(restored.width, 1920 - 24);
    assert.equal(restored.height, 1080 - 64 - 24);
    assert.ok(restored.top + restored.height <= 1080 - 64 - 12);
  });

  await runCase("near-full saved panel size expands across fullscreen resize", () => {
    const module = loadPanelModule();
    const panel = new module.DialoguePanel({ settings: module.settingsStore.normalizeSettings({}) });
    panel.getMountViewportRect = () => ({ left: 0, top: 0, right: 1280, bottom: 720 });
    panel.getYouTubeFrameRect = () => ({ left: 0, top: 0, right: 1280, bottom: 720 });

    const savedSize = panel.localToPlayerPanelSize(1256, 632);

    assert.equal(savedSize.widthRatio, 1);
    assert.equal(savedSize.heightRatio, 1);

    panel.getMountViewportRect = () => ({ left: 0, top: 0, right: 1920, bottom: 1080 });
    panel.getYouTubeFrameRect = () => ({ left: 0, top: 0, right: 1920, bottom: 1080 });

    const restored = panel.resolveSavedPanelSize(savedSize);

    assert.equal(restored.width, 1920 - 24);
    assert.equal(restored.height, 1080 - 64 - 24);
  });

  await runCase("compact saved panel size remains fixed across fullscreen resize", () => {
    const module = loadPanelModule();
    const panel = new module.DialoguePanel({ settings: module.settingsStore.normalizeSettings({}) });
    panel.getMountViewportRect = () => ({ left: 0, top: 0, right: 1280, bottom: 720 });
    panel.getYouTubeFrameRect = () => ({ left: 0, top: 0, right: 1280, bottom: 720 });

    const savedSize = panel.localToPlayerPanelSize(420, 260);

    panel.getMountViewportRect = () => ({ left: 0, top: 0, right: 1920, bottom: 1080 });
    panel.getYouTubeFrameRect = () => ({ left: 0, top: 0, right: 1920, bottom: 1080 });

    const restored = panel.resolveSavedPanelSize(savedSize);

    assert.equal(restored.width, 420);
    assert.equal(restored.height, 260);
  });

  await runCase("legacy saved player pixels upgrade to proportional panel position", () => {
    const module = loadPanelModule();
    const panel = new module.DialoguePanel({
      settings: module.settingsStore.normalizeSettings({
        panelPosition: { anchor: "player", left: 12, top: 384 }
      })
    });
    panel.persistLayout = true;
    panel.root = {
      style: { display: "flex", left: "", top: "", right: "", bottom: "" },
      getBoundingClientRect() {
        return { left: 12, top: 384, right: 432, bottom: 644, width: 420, height: 260 };
      },
      classList: { toggle() {} }
    };
    panel.getMountViewportRect = () => ({ left: 0, top: 0, right: 1280, bottom: 720 });
    panel.getYouTubeFrameRect = () => ({ left: 0, top: 0, right: 1280, bottom: 720 });
    panel.getVisibleYouTubeFrameRect = () => ({ left: 0, top: 0, right: 1280, bottom: 720 });
    let patch = null;
    panel.options.onSettingsChange = (settings, nextPatch) => {
      patch = nextPatch;
    };

    panel.normalizeSavedPanelPosition({ persist: true });

    assert.ok(patch);
    assert.equal(patch.panelPosition.xRatio, 0);
    assert.equal(patch.panelPosition.yRatio, 1);
  });

  await runCase("passive layout refresh does not rewrite saved panel ratios", () => {
    const module = loadPanelModule();
    const savedPosition = {
      anchor: "player",
      left: 12,
      top: 448,
      xRatio: 0,
      yRatio: 1
    };
    const panel = new module.DialoguePanel({
      settings: module.settingsStore.normalizeSettings({
        panelPosition: savedPosition
      })
    });
    panel.persistLayout = true;
    panel.root = {
      style: { display: "flex", left: "", top: "", right: "", bottom: "" },
      getBoundingClientRect() {
        return { left: 12, top: 744, right: 432, bottom: 1004, width: 420, height: 260 };
      },
      classList: { toggle() {} }
    };
    panel.getMountViewportRect = () => ({ left: 0, top: 0, right: 1920, bottom: 1080 });
    panel.getYouTubeFrameRect = () => ({ left: 0, top: 0, right: 1920, bottom: 1080 });
    panel.getVisibleYouTubeFrameRect = () => ({ left: 0, top: 0, right: 1920, bottom: 1080 });
    let calls = 0;
    panel.options.onSettingsChange = () => {
      calls += 1;
    };

    panel.normalizeSavedPanelPosition({ persist: false });

    assert.equal(calls, 0);
    assert.equal(panel.settings.panelPosition.left, savedPosition.left);
    assert.equal(panel.settings.panelPosition.top, savedPosition.top);
    assert.equal(panel.settings.panelPosition.xRatio, savedPosition.xRatio);
    assert.equal(panel.settings.panelPosition.yRatio, savedPosition.yRatio);
    assert.equal(panel.root.style.left, "12px");
    assert.equal(panel.root.style.top, String(1080 - 64 - 260 - 12) + "px");
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
