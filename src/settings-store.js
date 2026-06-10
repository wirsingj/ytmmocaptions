(function initSettingsStore(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});
  const platform = app.platform;

  const STORAGE_KEY = "dialogueCaptions.settings.v1";
  const SCHEMA_VERSION = 1;
  const WORKSPACE_PRESET_COUNT = 3;
  const DEFAULT_WORKSPACE_PRESETS = Object.freeze([
    Object.freeze({
      panelOpacity: 48,
      textScale: 120,
      themeName: "stone",
      customThemeColor: "#ded6c3",
      animatedThemeName: null,
      panelPosition: null,
      panelSize: null,
      futurePreviewEnabled: true,
      caseFixEnabled: true,
      fadeTowardVideoCenter: false
    }),
    Object.freeze({
      panelOpacity: 10,
      textScale: 175,
      themeName: "custom",
      customThemeColor: "#d62fbe",
      animatedThemeName: "rainbow",
      panelPosition: Object.freeze({ anchor: "player", left: 12, top: 12, xRatio: 0, yRatio: 1 }),
      panelSize: Object.freeze({ width: 2400, height: 760 }),
      futurePreviewEnabled: true,
      caseFixEnabled: false,
      fadeTowardVideoCenter: false
    }),
    Object.freeze({
      panelOpacity: 58,
      textScale: 140,
      themeName: "ocean",
      customThemeColor: "#a7cde3",
      animatedThemeName: null,
      panelPosition: Object.freeze({ anchor: "player", left: 220, top: 64 }),
      panelSize: Object.freeze({ width: 820, height: 460 }),
      futurePreviewEnabled: true,
      caseFixEnabled: true,
      fadeTowardVideoCenter: false
    })
  ]);
  let saveQueue = Promise.resolve();
  const DEFAULTS = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    panelOpacity: 48,
    textScale: 120,
    themeName: "stone",
    customThemeColor: "#ded6c3",
    animatedThemeName: null,
    panelPosition: null,
    panelSize: null,
    futurePreviewHeight: 96,
    futurePreviewEnabled: true,
    caseFixEnabled: true,
    fadeTowardVideoCenter: false,
    videoCenterFadeStrength: 84,
    videoCenterFadeMidpoint: 50,
    videoCenterFadeMinOpacity: 12,
    layoutLocked: false,
    timelineModeEnabled: false,
    launcherPosition: null,
    workspacePresets: DEFAULT_WORKSPACE_PRESETS,
    activeWorkspacePreset: null,
    workspacePresetBaseline: null,
    panelClosed: true
  });

  function normalizePanelOpacity(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return DEFAULTS.panelOpacity;
    }
    return Math.max(10, Math.min(100, Math.round(number)));
  }

  function normalizeTextScale(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return DEFAULTS.textScale;
    }
    return Math.max(100, Math.min(200, Math.round(number)));
  }

  function normalizeThemeName(value) {
    const name = String(value || "").toLowerCase();
    const allowed = ["stone", "ember", "forest", "ocean", "violet", "custom"];
    return allowed.includes(name) ? name : DEFAULTS.themeName;
  }

  function normalizeCustomThemeColor(value) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULTS.customThemeColor;
  }

  function normalizePanelPosition(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const left = Number(value.left);
    const top = Number(value.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return null;
    }
    const normalized = {
      left: Math.max(0, Math.round(left)),
      top: Math.max(0, Math.round(top))
    };
    if (value.anchor === "player") {
      normalized.anchor = "player";
    }
    const xRatio = Number(value.xRatio);
    const yRatio = Number(value.yRatio);
    if (Number.isFinite(xRatio)) {
      normalized.xRatio = Math.max(0, Math.min(1, xRatio));
    }
    if (Number.isFinite(yRatio)) {
      normalized.yRatio = Math.max(0, Math.min(1, yRatio));
    }
    return normalized;
  }

  function normalizeAnimatedThemeName(value) {
    const name = String(value || "").toLowerCase();
    const allowed = ["rainbow", "earth", "dusk", "cyberpunk", "aurora"];
    return allowed.includes(name) ? name : null;
  }

  function normalizePanelSize(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const width = Number(value.width);
    const height = Number(value.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return null;
    }
    const normalized = {
      width: Math.max(280, Math.round(width)),
      height: Math.max(220, Math.round(height))
    };
    const widthRatio = Number(value.widthRatio);
    const heightRatio = Number(value.heightRatio);
    if (Number.isFinite(widthRatio)) {
      normalized.widthRatio = Math.max(0, Math.min(1, widthRatio));
    }
    if (Number.isFinite(heightRatio)) {
      normalized.heightRatio = Math.max(0, Math.min(1, heightRatio));
    }
    return normalized;
  }

  function normalizeFuturePreviewHeight(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return DEFAULTS.futurePreviewHeight;
    }
    return Math.max(52, Math.min(360, Math.round(number)));
  }

  function normalizeVideoCenterFadeStrength(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return DEFAULTS.videoCenterFadeStrength;
    }
    return Math.max(0, Math.min(90, Math.round(number)));
  }

  function normalizeVideoCenterFadeMidpoint(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return DEFAULTS.videoCenterFadeMidpoint;
    }
    return Math.max(20, Math.min(80, Math.round(number)));
  }

  function normalizeVideoCenterFadeMinOpacity(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return DEFAULTS.videoCenterFadeMinOpacity;
    }
    return Math.max(8, Math.min(70, Math.round(number)));
  }

  function normalizeLauncherPosition(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const left = Number(value.left);
    const top = Number(value.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return null;
    }
    return {
      left: Math.max(0, Math.round(left)),
      top: Math.max(0, Math.round(top))
    };
  }

  function normalizeWorkspacePresetId(value) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > WORKSPACE_PRESET_COUNT) {
      return null;
    }
    return number;
  }

  function normalizeWorkspaceSnapshot(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    return {
      panelOpacity: normalizePanelOpacity(value.panelOpacity),
      textScale: normalizeTextScale(value.textScale),
      themeName: normalizeThemeName(value.themeName),
      customThemeColor: normalizeCustomThemeColor(value.customThemeColor),
      animatedThemeName: normalizeAnimatedThemeName(value.animatedThemeName),
      panelPosition: normalizePanelPosition(value.panelPosition),
      panelSize: normalizePanelSize(value.panelSize),
      futurePreviewEnabled: typeof value.futurePreviewEnabled === "boolean" ? value.futurePreviewEnabled : DEFAULTS.futurePreviewEnabled,
      caseFixEnabled: typeof value.caseFixEnabled === "boolean" ? value.caseFixEnabled : DEFAULTS.caseFixEnabled,
      fadeTowardVideoCenter: typeof value.fadeTowardVideoCenter === "boolean" ? value.fadeTowardVideoCenter : DEFAULTS.fadeTowardVideoCenter
    };
  }

  function isLegacyBuiltInMusicWorkspaceSnapshot(snapshot) {
    const position = snapshot && snapshot.panelPosition;
    const size = snapshot && snapshot.panelSize;
    return Boolean(
      snapshot &&
        snapshot.panelOpacity === 10 &&
        snapshot.textScale === 175 &&
        snapshot.themeName === "custom" &&
        snapshot.customThemeColor === "#d62fbe" &&
        !snapshot.animatedThemeName &&
        snapshot.futurePreviewEnabled === true &&
        snapshot.caseFixEnabled === false &&
        snapshot.fadeTowardVideoCenter === false &&
        position &&
        position.anchor === "player" &&
        position.left === 12 &&
        position.top === 12 &&
        !Number.isFinite(Number(position.yRatio)) &&
        size &&
        size.width === 2400 &&
        size.height === 760
    );
  }

  function normalizeWorkspacePresets(value) {
    const source = Array.isArray(value) ? value : [];
    const presets = [];
    for (let index = 0; index < WORKSPACE_PRESET_COUNT; index += 1) {
      const normalized = normalizeWorkspaceSnapshot(source[index]);
      presets.push(
        index === 1 && isLegacyBuiltInMusicWorkspaceSnapshot(normalized)
          ? normalizeWorkspaceSnapshot(DEFAULT_WORKSPACE_PRESETS[index])
          : normalized || normalizeWorkspaceSnapshot(DEFAULT_WORKSPACE_PRESETS[index])
      );
    }
    return presets;
  }

  function normalizeSettings(input) {
    const source = input && typeof input === "object" ? input : {};
    const workspacePresets = normalizeWorkspacePresets(source.workspacePresets);
    const activeWorkspacePreset = normalizeWorkspacePresetId(source.activeWorkspacePreset);
    return {
      schemaVersion: SCHEMA_VERSION,
      panelOpacity: normalizePanelOpacity(source.panelOpacity),
      textScale: normalizeTextScale(source.textScale),
      themeName: normalizeThemeName(source.themeName),
      customThemeColor: normalizeCustomThemeColor(source.customThemeColor),
      animatedThemeName: normalizeAnimatedThemeName(source.animatedThemeName),
      panelPosition: normalizePanelPosition(source.panelPosition),
      panelSize: normalizePanelSize(source.panelSize),
      futurePreviewHeight: normalizeFuturePreviewHeight(source.futurePreviewHeight),
      futurePreviewEnabled: typeof source.futurePreviewEnabled === "boolean" ? source.futurePreviewEnabled : DEFAULTS.futurePreviewEnabled,
      caseFixEnabled: typeof source.caseFixEnabled === "boolean" ? source.caseFixEnabled : DEFAULTS.caseFixEnabled,
      fadeTowardVideoCenter: typeof source.fadeTowardVideoCenter === "boolean" ? source.fadeTowardVideoCenter : DEFAULTS.fadeTowardVideoCenter,
      videoCenterFadeStrength: normalizeVideoCenterFadeStrength(source.videoCenterFadeStrength),
      videoCenterFadeMidpoint: normalizeVideoCenterFadeMidpoint(source.videoCenterFadeMidpoint),
      videoCenterFadeMinOpacity: normalizeVideoCenterFadeMinOpacity(source.videoCenterFadeMinOpacity),
      layoutLocked: typeof source.layoutLocked === "boolean" ? source.layoutLocked : DEFAULTS.layoutLocked,
      timelineModeEnabled: typeof source.timelineModeEnabled === "boolean" ? source.timelineModeEnabled : DEFAULTS.timelineModeEnabled,
      launcherPosition: normalizeLauncherPosition(source.launcherPosition),
      workspacePresets: workspacePresets,
      activeWorkspacePreset: activeWorkspacePreset && workspacePresets[activeWorkspacePreset - 1] ? activeWorkspacePreset : null,
      workspacePresetBaseline:
        activeWorkspacePreset && workspacePresets[activeWorkspacePreset - 1]
          ? normalizeWorkspaceSnapshot(source.workspacePresetBaseline)
          : null,
      panelClosed: typeof source.panelClosed === "boolean" ? source.panelClosed : DEFAULTS.panelClosed
    };
  }

  function toStoredSettings(settings) {
    const normalized = normalizeSettings(settings);
    const stored = {
      schemaVersion: SCHEMA_VERSION,
      panelOpacity: normalized.panelOpacity,
      themeName: normalized.themeName,
      customThemeColor: normalized.customThemeColor,
      animatedThemeName: normalized.animatedThemeName,
      fadeTowardVideoCenter: normalized.fadeTowardVideoCenter,
      layoutLocked: normalized.layoutLocked,
      // Presets are explicit local loadouts, so their saved slots survive even when Layout Lock is off.
      workspacePresets: normalized.workspacePresets,
      activeWorkspacePreset: normalized.activeWorkspacePreset,
      workspacePresetBaseline: normalized.workspacePresetBaseline,
      panelClosed: normalized.panelClosed
    };
    if (normalized.layoutLocked) {
      stored.textScale = normalized.textScale;
      stored.panelPosition = normalized.panelPosition;
      stored.panelSize = normalized.panelSize;
      stored.futurePreviewHeight = normalized.futurePreviewHeight;
      stored.futurePreviewEnabled = normalized.futurePreviewEnabled;
      stored.caseFixEnabled = normalized.caseFixEnabled;
      stored.launcherPosition = normalized.launcherPosition;
      stored.panelClosed = normalized.panelClosed;
    }
    return stored;
  }

  function fromStoredSettings(settings) {
    const normalized = normalizeSettings(settings);
    if (normalized.layoutLocked) {
      return normalized;
    }
    const baseline = normalizeSettings({
      ...normalized,
      textScale: DEFAULTS.textScale,
      panelPosition: null,
      panelSize: null,
      futurePreviewHeight: DEFAULTS.futurePreviewHeight,
      futurePreviewEnabled: DEFAULTS.futurePreviewEnabled,
      caseFixEnabled: DEFAULTS.caseFixEnabled,
      videoCenterFadeStrength: DEFAULTS.videoCenterFadeStrength,
      videoCenterFadeMidpoint: DEFAULTS.videoCenterFadeMidpoint,
      videoCenterFadeMinOpacity: DEFAULTS.videoCenterFadeMinOpacity,
      timelineModeEnabled: DEFAULTS.timelineModeEnabled,
      launcherPosition: null
    });
    // Active presets reapply over the normal unlocked baseline; disabling the preset restores that baseline.
    if (baseline.activeWorkspacePreset) {
      const preset = baseline.workspacePresets[baseline.activeWorkspacePreset - 1];
      if (preset) {
        return normalizeSettings({
          ...baseline,
          ...preset,
          workspacePresets: baseline.workspacePresets,
          activeWorkspacePreset: baseline.activeWorkspacePreset,
          workspacePresetBaseline: baseline.workspacePresetBaseline
        });
      }
    }
    return baseline;
  }

  async function load() {
    try {
      await flush();
      const data = await platform.storageGet(STORAGE_KEY);
      return fromStoredSettings(data ? data[STORAGE_KEY] : null);
    } catch (error) {
      console.warn("[Dialogue Captions] Failed to read settings from extension storage.", error);
      return { ...DEFAULTS };
    }
  }

  async function save(nextSettings) {
    const normalized = normalizeSettings(nextSettings);
    const stored = toStoredSettings(normalized);
    saveQueue = saveQueue
      .catch(() => {})
      .then(async () => {
        try {
          await platform.storageSet({ [STORAGE_KEY]: stored });
        } catch (error) {
          console.warn("[Dialogue Captions] Failed to save settings to extension storage.", error);
        }
        return normalized;
      });
    return saveQueue;
  }

  async function savePatch(patch) {
    const source = patch && typeof patch === "object" ? patch : {};
    saveQueue = saveQueue
      .catch(() => {})
      .then(async () => {
        try {
          const data = await platform.storageGet(STORAGE_KEY);
          const current = fromStoredSettings(data ? data[STORAGE_KEY] : null);
          const normalized = normalizeSettings({ ...current, ...source });
          await platform.storageSet({ [STORAGE_KEY]: toStoredSettings(normalized) });
          return normalized;
        } catch (error) {
          console.warn("[Dialogue Captions] Failed to patch settings in extension storage.", error);
          return normalizeSettings(source);
        }
      });
    return saveQueue;
  }

  async function flush() {
    return saveQueue.catch(() => {});
  }

  app.settingsStore = {
    DEFAULTS,
    load,
    save,
    savePatch,
    flush,
    normalizeSettings
  };
})(window);
