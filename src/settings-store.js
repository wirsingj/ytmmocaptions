(function initSettingsStore(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});
  const platform = app.platform;

  const STORAGE_KEY = "dialogueCaptions.settings.v1";
  const SCHEMA_VERSION = 1;
  const DEFAULTS = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    panelOpacity: 88,
    textScale: 120,
    themeName: "stone",
    customThemeColor: "#ded6c3",
    panelPosition: null,
    panelSize: null,
    launcherPosition: null,
    panelClosed: true
  });

  function normalizePanelOpacity(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return DEFAULTS.panelOpacity;
    }
    return Math.max(35, Math.min(100, Math.round(number)));
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
    return {
      left: Math.max(0, Math.round(left)),
      top: Math.max(0, Math.round(top))
    };
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
