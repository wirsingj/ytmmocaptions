(function initFeatureFlags(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});
  const settingsStore = app.settingsStore;

  const FEATURE_RULES = Object.freeze({
    chunkSizeControl: "premium",
    autoScrollControl: "premium",
    globalKeyboardMode: "premium"
  });

  function normalizePlan(plan) {
    return plan === "premium" ? "premium" : "free";
  }

  function normalizeOverrides(overrides) {
    if (!overrides || typeof overrides !== "object") {
      return {};
    }
    const normalized = {};
    for (const key of Object.keys(overrides)) {
      normalized[key] = Boolean(overrides[key]);
    }
    return normalized;
  }

  function hasFeature(plan, featureKey, overrides) {
    const normalizedPlan = normalizePlan(plan);
    const normalizedOverrides = normalizeOverrides(overrides);

    if (Object.prototype.hasOwnProperty.call(normalizedOverrides, featureKey)) {
      return normalizedOverrides[featureKey];
    }

    const requiredPlan = FEATURE_RULES[featureKey];
    if (!requiredPlan || requiredPlan === "free") {
      return true;
    }

    return normalizedPlan === "premium";
  }

  function buildFeatureState(plan, overrides) {
    return {
      chunkSizeControl: hasFeature(plan, "chunkSizeControl", overrides),
      autoScrollControl: hasFeature(plan, "autoScrollControl", overrides),
      globalKeyboardMode: hasFeature(plan, "globalKeyboardMode", overrides)
    };
  }

  async function resolveEntitlement(settings) {
    const normalizedPlan = normalizePlan(settings && settings.plan);
    const licenseKey = settings && typeof settings.licenseKey === "string" ? settings.licenseKey.trim() : "";
    const accountId = settings && typeof settings.accountId === "string" ? settings.accountId.trim() : "";

    if (licenseKey.toUpperCase().startsWith("PREMIUM-")) {
      return { plan: "premium", source: "license_key_placeholder" };
    }
    if (accountId.toLowerCase().startsWith("acct_premium_")) {
      return { plan: "premium", source: "account_placeholder" };
    }

    return { plan: normalizedPlan, source: "settings" };
  }

  async function updateSettings(patch) {
    const current = await settingsStore.load();
    const next = settingsStore.normalizeSettings({ ...current, ...patch });
    await settingsStore.save(next);
    return next;
  }

  async function setPlan(plan) {
    return updateSettings({ plan: normalizePlan(plan) });
  }

  async function setLicenseKey(licenseKey) {
    return updateSettings({ licenseKey: typeof licenseKey === "string" ? licenseKey : "" });
  }

  async function setAccountId(accountId) {
    return updateSettings({ accountId: typeof accountId === "string" ? accountId : "" });
  }

  async function setFeatureOverride(featureKey, enabled) {
    const current = await settingsStore.load();
    const nextOverrides = normalizeOverrides(current.featureOverrides);
    if (typeof enabled === "boolean") {
      nextOverrides[featureKey] = enabled;
    } else {
      delete nextOverrides[featureKey];
    }
    return updateSettings({ featureOverrides: nextOverrides });
  }

  async function clearFeatureOverrides() {
    return updateSettings({ featureOverrides: {} });
  }

  app.featureFlags = {
    FEATURE_RULES,
    normalizePlan,
    hasFeature,
    buildFeatureState,
    resolveEntitlement,
    setPlan,
    setLicenseKey,
    setAccountId,
    setFeatureOverride,
    clearFeatureOverrides
  };
})(window);
