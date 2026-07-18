exports.run = async function runCaptionAcquisitionTests(ctx) {
  const { assert, loadModule, runCase } = ctx;

  function loadAcquisitionModule(captionTimeline, windowProps) {
    const module = loadModule("caption-acquisition.js", {
      windowProps: {
        DialogueCaptions: {
          captionTimeline
        },
        location: {
          href: "https://www.youtube.com/watch?v=video123"
        },
        setTimeout,
        clearTimeout,
        ...(windowProps || {})
      }
    });
    return module.CaptionAcquisition;
  }

  function createOwner(overrides) {
    let active = true;
    const released = [];
    const owner = {
      videoId: "video123",
      video: { id: "video" },
      loadAbortController: null,
      loadAbortSessionId: 0,
      transcriptLoadNonce: 0,
      transcriptLoadInFlight: false,
      transcriptLoadAttempts: 0,
      transcriptMode: "",
      transcriptUpgradeInFlight: false,
      liveCaptureEnabled: true,
      cues: [],
      panel: null,
      applied: [],
      captionSessions: {
        createAbortController(sessionId) {
          if (!active || sessionId !== 1) {
            return null;
          }
          return new AbortController();
        },
        releaseAbortController(sessionId, controller) {
          released.push({ sessionId, controller });
        }
      },
      getActiveCaptionSessionId() {
        return 1;
      },
      isActiveCaptionSession(sessionId) {
        return active && sessionId === 1;
      },
      isCurrentVideoPage() {
        return true;
      },
      maybeProbeCaptions() {},
      ensurePageBridgeForWatchPage() {},
      probeCaptionsNow() {},
      async waitForCaptionContextReady() {},
      canApplyFullTranscriptResponse(response, sessionId) {
        return this.isActiveCaptionSession(sessionId) && response && response.ok && response.videoId === this.videoId;
      },
      applyFullTranscriptResponse(response, sessionId, options) {
        this.applied.push({ response, sessionId, options });
        return true;
      },
      enableLiveCaptureMode() {
        this.liveCaptureEnabled = true;
      },
      hasLiveCaptionContext() {
        return false;
      },
      clearCaptionStateForUnavailableVideo() {
        this.clearedUnavailable = true;
      },
      setActive(value) {
        active = Boolean(value);
      },
      getReleasedControllers() {
        return released.slice();
      },
      ...(overrides || {})
    };
    return owner;
  }

  await runCase("caption acquisition applies successful full transcript loads", async () => {
    const response = {
      ok: true,
      videoId: "video123",
      cues: [{ start: 0, end: 1, text: "Hello" }],
      mode: "timedtext"
    };
    const CaptionAcquisition = loadAcquisitionModule({
      async acquireFullTimeline(url, signal, options) {
        assert.equal(url, "https://www.youtube.com/watch?v=video123");
        assert.equal(signal.aborted, false);
        assert.equal(options.videoElement.id, "video");
        return response;
      }
    });
    const owner = createOwner();
    const acquisition = new CaptionAcquisition(owner, {
      diagnostics: { record() {} }
    });

    await acquisition.loadTranscript(1);

    assert.equal(owner.transcriptLoadInFlight, false);
    assert.equal(owner.loadAbortController, null);
    assert.equal(owner.applied.length, 1);
    assert.equal(owner.applied[0].response, response);
    assert.equal(owner.applied[0].options.activityReason, "full-transcript");
    assert.equal(owner.getReleasedControllers().length, 1);
  });

  await runCase("caption acquisition ignores loads that go stale before fetch", async () => {
    let acquired = false;
    const CaptionAcquisition = loadAcquisitionModule({
      async acquireFullTimeline() {
        acquired = true;
        return {
          ok: true,
          videoId: "video123",
          cues: [{ start: 0, end: 1, text: "Late" }]
        };
      }
    });
    const owner = createOwner({
      async waitForCaptionContextReady() {
        this.setActive(false);
      }
    });
    const acquisition = new CaptionAcquisition(owner, {
      diagnostics: { record() {} }
    });

    await acquisition.loadTranscript(1);

    assert.equal(acquired, false);
    assert.equal(owner.transcriptLoadInFlight, false);
    assert.equal(owner.applied.length, 0);
  });

  await runCase("caption acquisition ignores full transcript responses that lose the session race", async () => {
    const CaptionAcquisition = loadAcquisitionModule({
      async acquireFullTimeline() {
        return {
          ok: true,
          videoId: "video123",
          cues: [{ start: 0, end: 1, text: "Late" }]
        };
      }
    });
    const owner = createOwner({
      canApplyFullTranscriptResponse(response, sessionId) {
        this.setActive(false);
        return this.isActiveCaptionSession(sessionId) && response && response.ok;
      }
    });
    const acquisition = new CaptionAcquisition(owner, {
      diagnostics: { record() {} }
    });

    await acquisition.loadTranscript(1);

    assert.equal(owner.transcriptLoadInFlight, false);
    assert.equal(owner.applied.length, 0);
  });

  await runCase("caption acquisition applies successful live fallback upgrades", async () => {
    const response = {
      ok: true,
      videoId: "video123",
      cues: [{ start: 4, end: 6, text: "Future line" }]
    };
    let bridgeEnsured = 0;
    let probes = 0;
    const CaptionAcquisition = loadAcquisitionModule({
      async acquireFullTimeline(url, signal, options) {
        assert.equal(url, "https://www.youtube.com/watch?v=video123");
        assert.equal(signal.aborted, false);
        assert.equal(options.videoElement.id, "video");
        return response;
      }
    });
    const owner = createOwner({
      ensurePageBridgeForWatchPage() {
        bridgeEnsured += 1;
      },
      probeCaptionsNow() {
        probes += 1;
      }
    });
    const acquisition = new CaptionAcquisition(owner, {
      diagnostics: { record() {} },
      timers: {
        setTimeout() {
          return 1;
        },
        clearTimeout() {}
      }
    });

    await acquisition.tryUpgradeLiveCaptureToTranscript(1);

    assert.equal(bridgeEnsured, 1);
    assert.equal(probes, 1);
    assert.equal(owner.transcriptUpgradeInFlight, false);
    assert.equal(owner.applied.length, 1);
    assert.equal(owner.applied[0].response, response);
    assert.equal(owner.applied[0].options.activityReason, "transcript-upgrade");
    assert.equal(owner.applied[0].options.preserveOpenCaptionPreference, true);
    assert.equal(owner.applied[0].options.syncAfterApply, true);
    assert.equal(owner.getReleasedControllers().length, 1);
  });

  await runCase("caption acquisition ignores live fallback upgrades that go stale after fetch", async () => {
    let owner = null;
    const CaptionAcquisition = loadAcquisitionModule({
      async acquireFullTimeline() {
        owner.setActive(false);
        return {
          ok: true,
          videoId: "video123",
          cues: [{ start: 4, end: 6, text: "Late upgrade" }]
        };
      }
    });
    owner = createOwner({
      applyFullTranscriptResponse() {
        throw new Error("stale upgrade should not be applied");
      }
    });
    const acquisition = new CaptionAcquisition(owner, {
      diagnostics: { record() {} },
      timers: {
        setTimeout() {
          return 1;
        },
        clearTimeout() {}
      }
    });

    await acquisition.tryUpgradeLiveCaptureToTranscript(1);

    assert.equal(owner.transcriptUpgradeInFlight, false);
    assert.equal(owner.applied.length, 0);
    assert.equal(owner.getReleasedControllers().length, 1);
  });
  await runCase("caption acquisition records live fallback on transcript failure", async () => {
    const records = [];
    const statuses = [];
    const CaptionAcquisition = loadAcquisitionModule({
      async acquireFullTimeline() {
        return { ok: false, reason: "No caption tracks" };
      }
    });
    const owner = createOwner({
      panel: {
        setStatus(message) {
          statuses.push(message);
        }
      }
    });
    const acquisition = new CaptionAcquisition(owner, {
      diagnostics: {
        record(name, payload) {
          records.push({ name, payload });
        }
      },
      timers: {
        setTimeout(callback) {
          callback();
          return 1;
        },
        clearTimeout() {}
      }
    });

    await acquisition.loadTranscript(1);

    assert.equal(owner.transcriptMode, "live overlay fallback mode");
    assert.equal(owner.clearedUnavailable, true);
    assert.equal(statuses[0], "Turn on YouTube CC if needed. Click any chat bubble to seek.");
    assert.equal(records[0].name, "captions:transcript-failed");
  });
};
