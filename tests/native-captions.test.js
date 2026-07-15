exports.run = async function runNativeCaptionsTests(ctx) {
  const { assert, loadModule, runCase } = ctx;

  function loadNativeController() {
    const module = loadModule("native-captions.js");
    return module.NativeCaptionController;
  }

  function createOwner(overrides) {
    const owner = {
      destroyed: false,
      settings: { panelClosed: false },
      subtitlesOn: false,
      setCalls: [],
      fallbackClicks: 0,
      probes: 0,
      isSubtitlesEnabled() {
        return this.subtitlesOn;
      },
      setSubtitlesEnabled(enabled) {
        this.setCalls.push(Boolean(enabled));
        this.subtitlesOn = Boolean(enabled);
        return true;
      },
      clickSubtitlesButtonFallback() {
        this.fallbackClicks += 1;
        this.subtitlesOn = true;
        return true;
      },
      probeCaptionsNow() {
        this.probes += 1;
      },
      ...(overrides || {})
    };
    return owner;
  }

  await runCase("native captions capture initial state once", () => {
    const NativeCaptionController = loadNativeController();
    const owner = createOwner({ subtitlesOn: false });
    const controller = new NativeCaptionController(owner);

    controller.captureInitialState();
    owner.subtitlesOn = true;
    controller.captureInitialState();

    assert.equal(controller.captionsWereOnBeforeExtension, false);
  });

  await runCase("native captions restore only when extension enabled captions from off state", () => {
    const NativeCaptionController = loadNativeController();
    const owner = createOwner({ subtitlesOn: false });
    const controller = new NativeCaptionController(owner);

    controller.captureInitialState();
    controller.markEnabledByExtensionIfInitiallyOff();
    owner.subtitlesOn = true;
    controller.restoreIfExtensionEnabled();

    assert.deepEqual(owner.setCalls, [false]);
    assert.equal(controller.captionsEnabledByExtension, false);
    assert.equal(controller.captionsWereOnBeforeExtension, null);
    assert.equal(controller.isEnsured(), false);
    assert.equal(controller.isEnsureStarted(), false);
  });

  await runCase("native captions do not restore when captions were already on", () => {
    const NativeCaptionController = loadNativeController();
    const owner = createOwner({ subtitlesOn: true });
    const controller = new NativeCaptionController(owner);

    controller.captureInitialState();
    controller.markEnabledByExtensionIfInitiallyOff();
    controller.restoreIfExtensionEnabled();

    assert.deepEqual(owner.setCalls, []);
    assert.equal(controller.captionsWereOnBeforeExtension, null);
  });

  await runCase("native captions ensure probes and records fallback ownership", () => {
    const NativeCaptionController = loadNativeController();
    const pageContextCalls = [];
    const owner = createOwner({ subtitlesOn: false });
    const controller = new NativeCaptionController(owner, {
      pageContext: {
        triggerCaptionProbe() {
          pageContextCalls.push("probe");
        }
      }
    });

    controller.ensureOnce();

    assert.deepEqual(pageContextCalls, ["probe"]);
    assert.equal(owner.probes, 1);
    assert.equal(owner.fallbackClicks, 1);
    assert.equal(controller.isEnsured(), true);
    assert.equal(controller.captionsEnabledByExtension, true);
  });

  await runCase("native captions ensure is inert for closed panels", () => {
    const NativeCaptionController = loadNativeController();
    const owner = createOwner({ settings: { panelClosed: true } });
    const controller = new NativeCaptionController(owner);

    controller.ensureOnce();

    assert.equal(owner.probes, 0);
    assert.equal(owner.fallbackClicks, 0);
    assert.equal(controller.isEnsured(), false);
  });
};
