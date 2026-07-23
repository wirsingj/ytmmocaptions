(function initCaptionAcquisition(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});

  class CaptionAcquisition {
    constructor(owner, options) {
      const opts = options || {};
      this.owner = owner;
      this.captionTimeline = opts.captionTimeline || app.captionTimeline;
      this.diagnostics = opts.diagnostics || app.diagnostics || { record() {} };
      this.timers = opts.timers || scope;
    }

    setTimer(callback, delayMs) {
      const setTimer = this.timers && this.timers.setTimeout ? this.timers.setTimeout.bind(this.timers) : setTimeout;
      return setTimer(callback, delayMs);
    }

    clearTimer(timerId) {
      const clearTimer = this.timers && this.timers.clearTimeout ? this.timers.clearTimeout.bind(this.timers) : clearTimeout;
      clearTimer(timerId);
    }

    delay(delayMs) {
      return new Promise((resolve) => this.setTimer(resolve, delayMs));
    }

    abortLoad() {
      const owner = this.owner;
      if (!owner || !owner.loadAbortController) {
        return;
      }
      owner.loadAbortController.abort();
      if (owner.loadAbortSessionId) {
        owner.captionSessions.releaseAbortController(owner.loadAbortSessionId, owner.loadAbortController);
      }
      owner.loadAbortController = null;
      owner.loadAbortSessionId = 0;
    }

    async acquireTimelineWithTimeout(url, signal, videoElement, timeoutMs) {
      let timeoutId = 0;
      try {
        return await Promise.race([
          this.captionTimeline.acquireFullTimeline(url, signal, {
            videoElement: videoElement
          }),
          new Promise((resolve) => {
            timeoutId = this.setTimer(() => {
              resolve({ ok: false, reason: "Transcript loading timed out." });
            }, timeoutMs);
          })
        ]);
      } finally {
        if (timeoutId) {
          this.clearTimer(timeoutId);
        }
      }
    }

    async tryUpgradeLiveCaptureToTranscript(sessionId) {
      const owner = this.owner;
      const captionSessionId = Number(sessionId || owner.getActiveCaptionSessionId());
      if (
        owner.transcriptUpgradeInFlight ||
        !owner.isActiveCaptionSession(captionSessionId) ||
        !owner.liveCaptureEnabled ||
        !owner.isCurrentVideoPage()
      ) {
        return;
      }
      owner.transcriptUpgradeInFlight = true;
      owner.ensurePageBridgeForWatchPage();
      owner.probeCaptionsNow();
      const controller = owner.captionSessions.createAbortController(captionSessionId);
      if (!controller) {
        owner.transcriptUpgradeInFlight = false;
        return;
      }
      const signal = controller.signal;
      const timeoutId = this.setTimer(() => controller.abort(), 11000);

      try {
        await owner.waitForCaptionContextReady(1600);
        if (
          signal.aborted ||
          !owner.isActiveCaptionSession(captionSessionId) ||
          !owner.liveCaptureEnabled ||
          !owner.isCurrentVideoPage()
        ) {
          return;
        }
        const response = await this.captionTimeline.acquireFullTimeline(scope.location.href, signal, {
          videoElement: owner.video
        });
        if (
          !response ||
          !response.ok ||
          response.videoId !== owner.videoId ||
          !Array.isArray(response.cues) ||
          !response.cues.length ||
          !owner.isActiveCaptionSession(captionSessionId) ||
          !owner.isCurrentVideoPage()
        ) {
          return;
        }
        owner.applyFullTranscriptResponse(response, captionSessionId, {
          activityReason: "transcript-upgrade",
          preserveOpenCaptionPreference: true,
          statusMessage: "Full caption timeline loaded. Next up previews are available.",
          syncAfterApply: true
        });
      } catch (error) {
        if (!error || error.name !== "AbortError") {
          // Live overlay upgrades are opportunistic; most failures should stay quiet.
        }
      } finally {
        this.clearTimer(timeoutId);
        owner.captionSessions.releaseAbortController(captionSessionId, controller);
        owner.transcriptUpgradeInFlight = false;
      }
    }

    async loadTranscript(sessionId) {
      const owner = this.owner;
      const captionSessionId = Number(sessionId || owner.getActiveCaptionSessionId());
      if (!owner.isActiveCaptionSession(captionSessionId)) {
        return;
      }
      this.abortLoad();
      owner.loadAbortController = owner.captionSessions.createAbortController(captionSessionId);
      if (!owner.loadAbortController) {
        return;
      }
      owner.loadAbortSessionId = captionSessionId;
      const controller = owner.loadAbortController;
      const loadId = owner.transcriptLoadNonce + 1;
      owner.transcriptLoadNonce = loadId;
      owner.transcriptLoadInFlight = true;
      owner.transcriptMode = "loading";
      owner.transcriptLoadAttempts += 1;

      const url = scope.location.href;
      const signal = controller.signal;
      if (signal.aborted || !owner.isActiveCaptionSession(captionSessionId)) {
        if (loadId === owner.transcriptLoadNonce) {
          owner.transcriptLoadInFlight = false;
        }
        return;
      }
      owner.maybeProbeCaptions();
      await owner.waitForCaptionContextReady(2400);
      if (signal.aborted || !owner.isActiveCaptionSession(captionSessionId)) {
        if (loadId === owner.transcriptLoadNonce) {
          owner.transcriptLoadInFlight = false;
        }
        return;
      }

      let response = null;
      try {
        response = await this.acquireTimelineWithTimeout(url, signal, owner.video, 10000);
      } finally {
        if (loadId === owner.transcriptLoadNonce) {
          owner.transcriptLoadInFlight = false;
        }
        if (owner.loadAbortController === controller && owner.loadAbortSessionId === captionSessionId) {
          owner.captionSessions.releaseAbortController(captionSessionId, controller);
          owner.loadAbortController = null;
          owner.loadAbortSessionId = 0;
        }
      }

      if (!response || !response.ok) {
        return this.handleTranscriptFailure(response, captionSessionId, signal);
      }

      if (!owner.canApplyFullTranscriptResponse(response, captionSessionId)) {
        return;
      }

      owner.applyFullTranscriptResponse(response, captionSessionId, {
        activityReason: "full-transcript",
        recordLoadedDiagnostic: true,
        useLoadedStatusMessage: true
      });
    }

    async handleTranscriptFailure(response, captionSessionId, signal) {
      const owner = this.owner;
      if (!owner.isActiveCaptionSession(captionSessionId)) {
        return;
      }
      const reason = String(response && response.reason ? response.reason : "");
      const isLikelyReloadRace = reason.includes("No caption tracks") || reason.includes("No subtitle cues");
      if (isLikelyReloadRace && owner.transcriptLoadAttempts <= 1 && !signal.aborted && owner.isActiveCaptionSession(captionSessionId)) {
        await this.delay(950);
        if (!signal.aborted && owner.isActiveCaptionSession(captionSessionId)) {
          return this.loadTranscript(captionSessionId);
        }
      }
      const shouldEnableLiveCapture =
        reason.includes("No subtitle cues") ||
        reason.includes("No caption tracks") ||
        reason.includes("Transcript loading failed") ||
        reason.includes("timed out");

      if (shouldEnableLiveCapture) {
        owner.enableLiveCaptureMode();
        owner.transcriptMode = "live overlay fallback mode";
        this.diagnostics.record("captions:transcript-failed", {
          attempts: owner.transcriptLoadAttempts,
          reason: reason
        });
      }
      if (owner.panel) {
        if (!owner.cues.length || !owner.hasLiveCaptionContext()) {
          owner.clearCaptionStateForUnavailableVideo();
        }
        owner.panel.setStatus(
          shouldEnableLiveCapture
            ? "Turn on YouTube CC if needed. Click any chat bubble to seek."
            : (response && response.reason) || "Subtitles are unavailable."
        );
      }
    }
  }

  app.CaptionAcquisition = CaptionAcquisition;
})(window);
