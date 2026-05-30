(function initSettingsStore(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});
  const platform = app.platform;

  const STORAGE_KEY = "dialogueCaptions.settings.v1";
  const SCHEMA_VERSION = 1;
  const DEFAULTS = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    panelOpacity: 55,
    textScale: 120,
    themeName: "stone",
    customThemeColor: "#ded6c3",
    panelPosition: null,
    panelSize: null,
    futurePreviewHeight: 96,
    futurePreviewEnabled: true,
    fadeTowardVideoCenter: true,
    videoCenterFadeStrength: 84,
    videoCenterFadeMidpoint: 50,
    videoCenterFadeMinOpacity: 12,
    timelineModeEnabled: false,
    launcherPosition: null,
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
    return normalized;
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
    return {
      width: Math.max(280, Math.round(width)),
      height: Math.max(220, Math.round(height))
    };
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

  function normalizeSettings(input) {
    const source = input && typeof input === "object" ? input : {};
    return {
      schemaVersion: SCHEMA_VERSION,
      panelOpacity: normalizePanelOpacity(source.panelOpacity),
      textScale: normalizeTextScale(source.textScale),
      themeName: normalizeThemeName(source.themeName),
      customThemeColor: normalizeCustomThemeColor(source.customThemeColor),
      panelPosition: normalizePanelPosition(source.panelPosition),
      panelSize: normalizePanelSize(source.panelSize),
      futurePreviewHeight: normalizeFuturePreviewHeight(source.futurePreviewHeight),
      futurePreviewEnabled: typeof source.futurePreviewEnabled === "boolean" ? source.futurePreviewEnabled : DEFAULTS.futurePreviewEnabled,
      fadeTowardVideoCenter: typeof source.fadeTowardVideoCenter === "boolean" ? source.fadeTowardVideoCenter : DEFAULTS.fadeTowardVideoCenter,
      videoCenterFadeStrength: normalizeVideoCenterFadeStrength(source.videoCenterFadeStrength),
      videoCenterFadeMidpoint: normalizeVideoCenterFadeMidpoint(source.videoCenterFadeMidpoint),
      videoCenterFadeMinOpacity: normalizeVideoCenterFadeMinOpacity(source.videoCenterFadeMinOpacity),
      timelineModeEnabled: typeof source.timelineModeEnabled === "boolean" ? source.timelineModeEnabled : DEFAULTS.timelineModeEnabled,
      launcherPosition: normalizeLauncherPosition(source.launcherPosition),
      panelClosed: typeof source.panelClosed === "boolean" ? source.panelClosed : DEFAULTS.panelClosed
    };
  }

  async function load() {
    try {
      const data = await platform.storageGet(STORAGE_KEY);
      return normalizeSettings(data ? data[STORAGE_KEY] : null);
    } catch (error) {
      console.warn("[Dialogue Captions] Failed to read settings from extension storage.", error);
      return { ...DEFAULTS };
    }
  }

  async function save(nextSettings) {
    const normalized = normalizeSettings(nextSettings);
    try {
      await platform.storageSet({ [STORAGE_KEY]: normalized });
    } catch (error) {
      console.warn("[Dialogue Captions] Failed to save settings to extension storage.", error);
    }
    return normalized;
  }

  app.settingsStore = {
    DEFAULTS,
    load,
    save,
    normalizeSettings
  };
})(window);
