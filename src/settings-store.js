(function initSettingsStore(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});
  const platform = app.platform;

  const STORAGE_KEY = "dialogueCaptions.settings.v1";
  const DEFAULTS = Object.freeze({
    plan: "free",
    featureOverrides: {},
    panelOpacity: 88,
    textScale: 120,
    panelPosition: null,
    panelSize: null,
    launcherPosition: null,
    panelClosed: true,
    chunkSize: "medium",
    keyboardStepSeconds: 8,
    autoScroll: true,
    collapsed: false,
    globalKeyboardEnabled: false
  });

  function normalizeChunkSize(value) {
    if (value === "short" || value === "medium" || value === "long") {
      return value;
    }
    return DEFAULTS.chunkSize;
  }

  function normalizeKeyboardStepSeconds(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return DEFAULTS.keyboardStepSeconds;
    }
    return Math.max(2, Math.min(30, Math.round(number)));
  }

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
    const rawOverrides =
      source.featureOverrides && typeof source.featureOverrides === "object" ? source.featureOverrides : {};
    const featureOverrides = {};
    for (const key of Object.keys(rawOverrides)) {
      featureOverrides[key] = Boolean(rawOverrides[key]);
    }

    return {
      plan: source.plan === "premium" ? "premium" : DEFAULTS.plan,
      featureOverrides: featureOverrides,
      panelOpacity: normalizePanelOpacity(source.panelOpacity),
      textScale: normalizeTextScale(source.textScale),
      panelPosition: normalizePanelPosition(source.panelPosition),
      panelSize: normalizePanelSize(source.panelSize),
      launcherPosition: normalizeLauncherPosition(source.launcherPosition),
      panelClosed: typeof source.panelClosed === "boolean" ? source.panelClosed : DEFAULTS.panelClosed,
      chunkSize: normalizeChunkSize(source.chunkSize),
      keyboardStepSeconds: normalizeKeyboardStepSeconds(source.keyboardStepSeconds),
      autoScroll: typeof source.autoScroll === "boolean" ? source.autoScroll : DEFAULTS.autoScroll,
      collapsed: typeof source.collapsed === "boolean" ? source.collapsed : DEFAULTS.collapsed,
      globalKeyboardEnabled:
        typeof source.globalKeyboardEnabled === "boolean"
          ? source.globalKeyboardEnabled
          : DEFAULTS.globalKeyboardEnabled
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
