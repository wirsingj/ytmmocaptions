(function initContentScript(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});
  const transcript = app.transcript;
  const chunker = app.chunker;
  const settingsStore = app.settingsStore;
  const bubbleState = app.bubbleState;
  const captionText = app.captionText;
  const platform = app.platform;
  const pageContext = app.pageContext;
  const DialoguePanel = app.DialoguePanel;

  if (!transcript || !chunker || !settingsStore || !bubbleState || !captionText || !platform || !DialoguePanel) {
    console.warn("[Dialogue Captions] Missing required modules.");
    return;
  }

  const GLOBAL_CONTROLLER_KEY = "__dialogueCaptionsController";

  function isTypingContext(target) {
    const element = target instanceof Element ? target : document.activeElement;
    if (!element) {
      return false;
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      return true;
    }
    if (element.isContentEditable) {
      return true;
    }
    return Boolean(element.closest("[contenteditable='true']"));
  }

  class DialogueCaptionsApp {
    constructor(videoId) {
      this.videoId = videoId;
      this.video = null;
      this.panel = null;
      this.cues = [];
      this.allChunks = [];
      this.chunks = [];
      this.revealedChunkCount = 0;
      this.activeIndex = -1;
      this.settings = { ...settingsStore.DEFAULTS };

      this.cleanupFns = [];
      this.videoCleanupFns = [];
      this.boundVideo = null;
      this.syncRafId = 0;
      this.loadAbortController = null;
      this.destroyed = false;
      this.suppressSpaceKeyUp = false;
      this.timelineActionId = 0;
      this.timelineAction = null;
      this.timelineSyncForceScroll = false;
      this.liveCaptureEnabled = false;
      this.liveCapturePollId = 0;
      this.liveLastObservedTime = Number.NaN;
      this.liveMaxBucketIndexSeen = -1;
      this.liveLockCutoffIndex = -1;
      this.liveLastBackfillAt = 0;
      this.liveLastBackfillBucketIndex = -1;
      this.liveLastFutureBackfillAt = 0;
      this.liveLastFutureBackfillBucketIndex = -1;
      this.liveOverlayAnchorOffsetSeconds = 2.5;
      this.liveOverlayUtterance = null;
      this.lastCaptionProbeAt = 0;
      this.captionsEnsured = false;
      this.captionEnsureStarted = false;
      this.captionWorkStarted = false;
      this.captionsWereOnBeforeExtension = null;
      this.captionsEnabledByExtension = false;
      this.transcriptMode = "initializing";
      this.transcriptLoadAttempts = 0;
      this.transcriptUpgradeAttempts = 0;
      this.transcriptUpgradeInFlight = false;
      this.lastTranscriptUpgradeAt = 0;
      this.pendingSeekFocus = null;
      this.liveCaptureSuppressedUntil = 0;
      this.liveBubbles = [];
      this.liveBucketToBubble = new Map();
      this.liveDisplayBubbleCache = new Map();
      this.liveNextBubbleUid = 1;
      this.liveFuturePreviewChunks = [];
    }

    async init() {
      this.settings = await settingsStore.load();
      if (this.destroyed) {
        return;
      }
      this.panel = new DialoguePanel({
        settings: this.settings,
        onSeek: (index) => this.seekToChunk(index),
        onSettingsChange: (settings, patch) => this.onSettingsChanged(settings, patch)
      });
      this.panel.mount();
      this.panel.setStatus(
        this.settings.panelClosed
          ? "Open panel to start live subtitle capture."
          : "Loading subtitles..."
      );

      this.video = await this.waitForVideoElement(12000);
      if (this.destroyed) {
        return;
      }
      if (!this.video) {
        if (this.panel) {
          this.panel.setStatus("Could not find the YouTube video element.");
        }
        return;
      }

      this.bindKeyboardHandler();
      this.bindVideoSync();
      if (!this.settings.panelClosed) {
        await this.startCaptionWork();
      }
    }

    destroy() {
      this.destroyed = true;
      this.abortTranscriptLoad();

      if (this.syncRafId) {
        platform.cancelFrame(this.syncRafId);
        this.syncRafId = 0;
      }

      for (const cleanup of this.cleanupFns) {
        cleanup();
      }
      this.cleanupFns.length = 0;
      this.cleanupVideoSync();
      this.disableLiveCaptureMode();
      this.restoreSubtitlesIfExtensionEnabled();

      if (this.panel) {
        this.panel.destroy();
        this.panel = null;
      }
      this.video = null;
    }

    ensurePageBridgeForWatchPage() {
      if (!pageContext || typeof pageContext.ensureBridgeInjected !== "function") {
        return false;
      }
      if (!transcript.isWatchPage(window.location.href) || !transcript.getVideoId(window.location.href)) {
        return false;
      }
      pageContext.ensureBridgeInjected();
      return true;
    }

    async waitForVideoElement(timeoutMs) {
      const startedAt = Date.now();

      while (!this.destroyed && Date.now() - startedAt <= timeoutMs) {
        const videoElement = this.getCurrentVideoElement();
        if (videoElement instanceof HTMLVideoElement) {
          return videoElement;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }

      return null;
    }

    getInlineCaptionTrackCount() {
      try {
        const response = window.ytInitialPlayerResponse;
        const tracks =
          response &&
          response.captions &&
          response.captions.playerCaptionsTracklistRenderer &&
          Array.isArray(response.captions.playerCaptionsTracklistRenderer.captionTracks)
            ? response.captions.playerCaptionsTracklistRenderer.captionTracks
            : [];
        return tracks.length;
      } catch {
        return 0;
      }
    }

    getPlayerCaptionTrackCount() {
      try {
        const player = document.getElementById("movie_player");
        if (!player || typeof player.getOption !== "function") {
          return 0;
        }
        const tracklist = player.getOption("captions", "tracklist");
        return Array.isArray(tracklist) ? tracklist.length : 0;
      } catch {
        return 0;
      }
    }

    async waitForCaptionContextReady(timeoutMs) {
      const timeout = Number.isFinite(timeoutMs) ? Math.max(0, Number(timeoutMs)) : 2400;
      const startedAt = Date.now();
      while (!this.destroyed && Date.now() - startedAt <= timeout) {
        const inlineTracks = this.getInlineCaptionTrackCount();
        const playerTracks = this.getPlayerCaptionTrackCount();
        if (inlineTracks > 0 || playerTracks > 0) {
          return true;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }
      return false;
    }

    bindKeyboardHandler() {
      const SPACE_KEYS = new Set([" ", "Spacebar", "Space"]);
      const suppressedEvents = new WeakSet();
      const actionHandledKeydowns = new WeakSet();
      let lastShortcutAt = 0;

      const isSpaceEvent = (event) => {
        if (!event) {
          return false;
        }
        if (event.code === "Space") {
          return true;
        }
        return SPACE_KEYS.has(String(event.key || ""));
      };

      function suppressEvent(event) {
        if (!event || suppressedEvents.has(event)) {
          return;
        }
        suppressedEvents.add(event);
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
      }

      const canHandleSpace = (event) => {
        if (!isSpaceEvent(event)) {
          return false;
        }
        if (event.repeat) {
          return false;
        }
        if (event.ctrlKey || event.altKey || event.metaKey) {
          return false;
        }
        const liveVideo = this.refreshVideoReference();
        if (!liveVideo || !this.panel) {
          return false;
        }
        if (isTypingContext(event.target)) {
          return false;
        }
        return this.panel.isPointerInside();
      };

      const onKeyDown = (event) => {
        if (actionHandledKeydowns.has(event)) {
          return;
        }
        if (!canHandleSpace(event)) {
          return;
        }
        actionHandledKeydowns.add(event);
        suppressEvent(event);
        const nowMs = Date.now();
        if (nowMs - lastShortcutAt < 85) {
          this.suppressSpaceKeyUp = true;
          return;
        }
        lastShortcutAt = nowMs;
        this.suppressSpaceKeyUp = true;
        this.handleSpaceShortcut(event.shiftKey);
      };

      const onKeyUp = (event) => {
        if (!isSpaceEvent(event)) {
          return;
        }
        if (!this.suppressSpaceKeyUp && !canHandleSpace(event)) {
          return;
        }
        suppressEvent(event);
        this.suppressSpaceKeyUp = false;
      };

      const onKeyPress = (event) => {
        if (!canHandleSpace(event) && !this.suppressSpaceKeyUp) {
          return;
        }
        suppressEvent(event);
      };

      const registerKeyListeners = (target, options) => {
        if (!target || typeof target.addEventListener !== "function") {
          return;
        }
        target.addEventListener("keydown", onKeyDown, options);
        target.addEventListener("keyup", onKeyUp, options);
        target.addEventListener("keypress", onKeyPress, options);
        this.cleanupFns.push(() => target.removeEventListener("keydown", onKeyDown, options));
        this.cleanupFns.push(() => target.removeEventListener("keyup", onKeyUp, options));
        this.cleanupFns.push(() => target.removeEventListener("keypress", onKeyPress, options));
      };

      const targets = [window, document, document.documentElement];
      const baseOptions = { capture: true, passive: false };
      const isFirefox = /firefox/i.test(String(navigator && navigator.userAgent ? navigator.userAgent : ""));
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        registerKeyListeners(target, baseOptions);

        if (isFirefox) {
          const systemOptions = { capture: true, passive: false, mozSystemGroup: true };
          registerKeyListeners(target, systemOptions);
        }
      }
    }

    bindVideoSync() {
      if (!this.video) {
        return;
      }
      if (this.boundVideo === this.video) {
        return;
      }
      this.cleanupVideoSync();
      const boundVideo = this.video;
      this.boundVideo = boundVideo;
      const onTimeUpdate = () => {
        this.scheduleSync();
        if (this.liveCaptureEnabled) {
          this.captureLiveCaptionLine();
        }
      };
      const onSeeked = () => {
        this.handleDiscontinuousTimeMove("seeked");
        this.scheduleSync();
        if (this.liveCaptureEnabled) {
          this.captureLiveCaptionLine();
        }
      };
      const onLoadedMetadata = () => {
        if (this.liveCaptureEnabled) {
          this.handleDiscontinuousTimeMove("loadedmetadata");
        }
        this.scheduleSync();
      };

      boundVideo.addEventListener("timeupdate", onTimeUpdate);
      boundVideo.addEventListener("seeked", onSeeked);
      boundVideo.addEventListener("loadedmetadata", onLoadedMetadata);

      this.videoCleanupFns.push(() => boundVideo.removeEventListener("timeupdate", onTimeUpdate));
      this.videoCleanupFns.push(() => boundVideo.removeEventListener("seeked", onSeeked));
      this.videoCleanupFns.push(() => boundVideo.removeEventListener("loadedmetadata", onLoadedMetadata));
    }

    cleanupVideoSync() {
      for (const cleanup of this.videoCleanupFns) {
        cleanup();
      }
      this.videoCleanupFns.length = 0;
      this.boundVideo = null;
    }

    normalizeLiveCaptionText(input) {
      return captionText.normalizeText(input);
    }

    sanitizeOverlayCandidateText(input) {
      return captionText.sanitizeOverlayText(input);
    }

    cleanCaptionCandidateText(input) {
      return captionText.cleanCandidate(input);
    }

    collapseOverlaySpamIfNeeded(input) {
      return captionText.collapseOverlaySpam(input);
    }

    toCaptionCanonical(text) {
      return captionText.toCanonical(text);
    }

    collapseRepeatedCaptionPhrases(text) {
      return captionText.collapseRepeatedPhrases(text);
    }

    collapseRepeatedCaptionSentences(text) {
      return captionText.collapseRepeatedSentences(text);
    }

    dedupeCaptionCandidates(candidates) {
      return captionText.dedupeCandidates(candidates);
    }

    mergeLiveCaptionText(previousText, nextText) {
      return captionText.mergeText(previousText, nextText);
    }

    normalizeCaptionToken(token) {
      return captionText.normalizeToken(token);
    }

    trimLiveChunkAgainstPrevious(previousText, chunk) {
      return bubbleState.trimChunkAgainstPrevious(previousText, chunk, {
        normalizeText: (value) => this.normalizeLiveCaptionText(value),
        normalizeToken: (value) => this.normalizeCaptionToken(value),
        fallbackDurationSeconds: this.getKeyboardStepSeconds()
      });
    }

    getPreviousLiveBubble(bubble) {
      if (!bubble || !Array.isArray(this.liveBubbles)) {
        return null;
      }
      const index = this.liveBubbles.indexOf(bubble);
      if (index <= 0) {
        return null;
      }
      return this.liveBubbles[index - 1] || null;
    }

    isHighOverlapText(leftText, rightText) {
      return captionText.isHighOverlap(leftText, rightText);
    }

    isNodeVisible(node) {
      if (!(node instanceof Element)) {
        return false;
      }
      const style = window.getComputedStyle(node);
      if (!style || style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    readVisibleCaptionText() {
      const container = document.querySelector(".ytp-caption-window-container");
      if (!container) {
        return "";
      }

      const lineCandidates = [];
      const selectors = [
        ".ytp-caption-segment",
        ".caption-visual-line",
        ".captions-text span",
        ".ytp-caption-window"
      ];

      for (let selectorIndex = 0; selectorIndex < selectors.length && !lineCandidates.length; selectorIndex += 1) {
        const nodes = container.querySelectorAll(selectors[selectorIndex]);
        nodes.forEach((node) => {
          if (!this.isNodeVisible(node)) {
            return;
          }
          const text = this.cleanCaptionCandidateText(node.textContent || "");
          if (text) {
            lineCandidates.push(text);
          }
        });
      }

      const selected = this.dedupeCaptionCandidates(lineCandidates);
      if (!selected.length) {
        return "";
      }
      return this.collapseOverlaySpamIfNeeded(this.normalizeLiveCaptionText(selected.join(" ")));
    }

    readTextTrackSnapshotAtCurrentTime() {
      if (!this.video || !this.video.textTracks || !this.video.textTracks.length) {
        return null;
      }
      const now = Number(this.video.currentTime || 0);
      if (!Number.isFinite(now)) {
        return null;
      }
      const fragments = [];
      let earliestStart = Number.POSITIVE_INFINITY;

      for (let index = 0; index < this.video.textTracks.length; index += 1) {
        const track = this.video.textTracks[index];
        try {
          if (track && track.mode === "disabled") {
            track.mode = "hidden";
          }
        } catch {
          // Ignore mode assignment failures.
        }

        const cueList = track && track.cues ? track.cues : null;
        if (!cueList || typeof cueList.length !== "number") {
          continue;
        }
        for (let cueIndex = 0; cueIndex < cueList.length; cueIndex += 1) {
          const cue = cueList[cueIndex];
          const start = Number(cue && cue.startTime);
          const end = Number(cue && cue.endTime);
          if (!Number.isFinite(start) || !Number.isFinite(end)) {
            continue;
          }
          if (now < start || now > end) {
            continue;
          }
          const text = this.cleanCaptionCandidateText(cue && cue.text ? cue.text : "");
          if (text) {
            fragments.push(text);
            earliestStart = Math.min(earliestStart, start);
          }
        }
      }
      const merged = this.normalizeLiveCaptionText(fragments.join(" "));
      if (!merged) {
        return null;
      }
      return {
        text: merged,
        startTime: Number.isFinite(earliestStart) ? earliestStart : Number.NaN
      };
    }

    readTextTrackWindowSnapshot(bucketIndex) {
      if (
        !this.video ||
        !this.video.textTracks ||
        !this.video.textTracks.length ||
        !Number.isFinite(bucketIndex) ||
        bucketIndex < 0
      ) {
        return null;
      }

      const step = this.getLiveWindowSeconds();
      const bucketStart = bucketIndex * step;
      const bucketEnd = bucketStart + step;
      const collected = [];

      for (let trackIndex = 0; trackIndex < this.video.textTracks.length; trackIndex += 1) {
        const track = this.video.textTracks[trackIndex];
        try {
          if (track && track.mode === "disabled") {
            track.mode = "hidden";
          }
        } catch {
          // Ignore mode assignment failures.
        }

        const cueList = track && track.cues ? track.cues : null;
        if (!cueList || typeof cueList.length !== "number") {
          continue;
        }
        for (let cueIndex = 0; cueIndex < cueList.length; cueIndex += 1) {
          const cue = cueList[cueIndex];
          const start = Number(cue && cue.startTime);
          const end = Number(cue && cue.endTime);
          if (!Number.isFinite(start) || !Number.isFinite(end)) {
            continue;
          }
          if (start < bucketStart || start >= bucketEnd) {
            continue;
          }
          const text = this.cleanCaptionCandidateText(cue && cue.text ? cue.text : "");
          if (!text) {
            continue;
          }
          collected.push({
            start: start,
            text: text
          });
        }
      }

      if (!collected.length) {
        return null;
      }

      collected.sort((left, right) => left.start - right.start);
      let merged = "";
      for (let index = 0; index < collected.length; index += 1) {
        merged = this.mergeLiveCaptionText(merged, collected[index].text);
      }
      const normalized = this.normalizeLiveCaptionText(merged);
      if (!normalized) {
        return null;
      }

      return {
        text: normalized,
        startTime: Number.isFinite(collected[0].start) ? collected[0].start : bucketStart
      };
    }

    getLiveWindowSeconds() {
      return this.getKeyboardStepSeconds();
    }

    getLiveOverlayAnchorOffsetSeconds() {
      const step = this.getLiveWindowSeconds();
      const value = Number(this.liveOverlayAnchorOffsetSeconds || 2.5);
      return Math.max(0.4, Math.min(Math.max(0.5, step - 0.4), value));
    }

    updateLiveOverlayAnchorOffset(currentTime, cueStartTime) {
      const now = Number(currentTime);
      const cueStart = Number(cueStartTime);
      if (!Number.isFinite(now) || !Number.isFinite(cueStart)) {
        return;
      }
      const step = this.getLiveWindowSeconds();
      const delta = now - cueStart;
      if (!Number.isFinite(delta) || delta < 0.15 || delta > step) {
        return;
      }
      const baseline = this.getLiveOverlayAnchorOffsetSeconds();
      const next = baseline * 0.82 + delta * 0.18;
      this.liveOverlayAnchorOffsetSeconds = Math.max(0.4, Math.min(Math.max(0.5, step - 0.4), next));
    }

    getLiveWindowIndex(seconds) {
      const step = this.getLiveWindowSeconds();
      const time = Math.max(0, Number(seconds || 0));
      return Math.max(0, Math.floor(time / step));
    }

    getLiveWindowStart(seconds) {
      const step = this.getLiveWindowSeconds();
      return this.getLiveWindowIndex(seconds) * step;
    }

    getLiveWindowEnd(windowStart) {
      return Math.max(windowStart + this.getLiveWindowSeconds(), windowStart + 0.25);
    }

    getLiveDiscontinuityThresholdSeconds() {
      return Math.max(1.8, this.getLiveWindowSeconds() * 1.4);
    }

    handleDiscontinuousTimeMove() {
      const currentTime = this.video ? Number(this.video.currentTime || 0) : Number.NaN;
      if (!this.isTimelineActionCurrentForTime(currentTime)) {
        this.clearTimelineActionState("discontinuous-time-move");
      }
      if (!this.liveCaptureEnabled) {
        return;
      }
      this.liveLastObservedTime = currentTime;
      this.liveOverlayUtterance = null;
    }

    suppressLiveCaptureForSeek(targetTime) {
      if (!this.liveCaptureEnabled) {
        return;
      }
      this.liveCaptureSuppressedUntil = Date.now() + 850;
      this.liveLastObservedTime = Number.isFinite(targetTime) ? Number(targetTime) : Number.NaN;
      this.liveOverlayUtterance = null;
    }

    beginTimelineAction(action) {
      this.clearPendingBubbleStartFlashes();
      const source = action && action.source ? String(action.source) : "timeline";
      const targetTime = Number(action && action.targetTime);
      const index = Number.isInteger(action && action.index) ? action.index : -1;
      const seekStart = Number(action && action.seekStart);
      const now = Date.now();
      this.timelineAction = {
        id: this.timelineActionId + 1,
        source: source,
        targetTime: Number.isFinite(targetTime) ? Math.max(0, targetTime) : 0,
        index: index,
        seekStart: Number.isFinite(seekStart) ? Math.max(0, seekStart) : Number.NaN,
        forceGlowReset: action && action.forceGlowReset !== false,
        forceScroll: Boolean(action && action.forceScroll),
        startedAt: now,
        settleUntil: now + 850
      };
      this.timelineActionId = this.timelineAction.id;
      this.suppressLiveCaptureForSeek(this.timelineAction.targetTime);
      return this.timelineAction;
    }

    isTimelineActionCurrentForTime(currentTime) {
      const action = this.timelineAction;
      const now = Number(currentTime);
      if (!action || !Number.isFinite(now) || Date.now() > Number(action.settleUntil || 0)) {
        return false;
      }
      const targetTime = Number(action.targetTime);
      if (!Number.isFinite(targetTime)) {
        return false;
      }
      return Math.abs(now - targetTime) <= 1.15;
    }

    clearTimelineActionState() {
      this.timelineAction = null;
      this.pendingSeekFocus = null;
      this.clearPendingBubbleStartFlashes();
      if (this.panel && typeof this.panel.setPlaybackTime === "function" && this.video) {
        this.panel.setPlaybackTime(Number(this.video.currentTime || 0), { forceGlowReset: true });
      }
    }

    clearPendingBubbleStartFlashes() {
      if (!Array.isArray(this.allChunks)) {
        return;
      }
      for (let index = 0; index < this.allChunks.length; index += 1) {
        const chunk = this.allChunks[index];
        if (chunk && chunk.flashOnStart && !chunk.flashOnStart.done) {
          chunk.flashOnStart.done = true;
        }
      }
    }

    applyTimelineActionFocus(action) {
      if (!action || !this.panel || action.index < 0 || !Array.isArray(this.allChunks) || action.index >= this.allChunks.length) {
        return;
      }
      const chunk = this.allChunks[action.index];
      const seekStart = Number.isFinite(action.seekStart) ? action.seekStart : this.getChunkSeekStart(chunk);
      this.ensureChunkVisible(action.index);
      this.pendingSeekFocus = {
        index: action.index,
        minTime: Math.max(0, Math.min(action.targetTime, Number(chunk.start || 0) - 0.55)),
        maxTime: Math.max(Number(chunk.end || 0), Number(chunk.start || 0) + this.getKeyboardStepSeconds()),
        expiresAt: Date.now() + 2600
      };
      this.activeIndex = action.index;
      this.panel.setActiveIndex(action.index, { ensureVisible: action.forceScroll });
      if (typeof this.panel.setPlaybackTime === "function") {
        this.panel.setPlaybackTime(action.targetTime, { forceGlowReset: action.forceGlowReset });
      }
      if (Number.isFinite(seekStart)) {
        this.markBubbleFlashOnStart(action.index, seekStart, action.source);
      }
    }

    getTimelineDisplayTime(currentTime, chunk, index) {
      const now = Number(currentTime);
      if (!Number.isFinite(now)) {
        return now;
      }
      const action = this.timelineAction;
      if (
        !action ||
        action.index !== index ||
        Date.now() > Number(action.settleUntil || 0) ||
        !Number.isFinite(action.targetTime)
      ) {
        return now;
      }

      const elapsedSeconds = Math.max(0, (Date.now() - Number(action.startedAt || Date.now())) / 1000);
      const chunkEnd = chunk && Number.isFinite(Number(chunk.end)) ? Number(chunk.end) : Number.POSITIVE_INFINITY;
      const maxSettledTime = Math.min(chunkEnd, action.targetTime + elapsedSeconds + 0.32);
      return Math.min(now, maxSettledTime);
    }

    isDiscontinuousLiveTimeMove(currentTime) {
      const last = Number(this.liveLastObservedTime);
      if (!Number.isFinite(last)) {
        return false;
      }
      const delta = currentTime - last;
      if (delta < -0.35) {
        return true;
      }
      if (delta > this.getLiveDiscontinuityThresholdSeconds()) {
        return true;
      }
      return false;
    }

    upsertLiveBucketCue(text, sampleTime, options) {
      const opts = options && typeof options === "object" ? options : {};
      const force = Boolean(opts.force);
      const normalized = this.cleanCaptionCandidateText(text);
      const canonical = this.toCaptionCanonical(normalized);
      if (!normalized || !canonical) {
        return false;
      }
      const bucketIndex = this.getLiveWindowIndex(sampleTime);
      if (!force && bucketIndex <= this.liveLockCutoffIndex) {
        return false;
      }
      const bucketStart = bucketIndex * this.getLiveWindowSeconds();
      const bucketEnd = this.getLiveWindowEnd(bucketStart);
      const sampleAnchor = Number.isFinite(sampleTime) ? Math.max(0, Number(sampleTime)) : bucketStart;
      const bucketStartMs = Math.round(bucketStart * 1000);
      const existingIndex = this.cues.findIndex(
        (cue) => Math.round(Math.max(0, Number(cue.start || 0)) * 1000) === bucketStartMs
      );

      if (existingIndex >= 0) {
        const existingCue = this.cues[existingIndex];
        const merged = this.mergeLiveCaptionText(existingCue.text, normalized);
        if (merged === existingCue.text) {
          return false;
        }
        this.cues[existingIndex] = {
          start: bucketStart,
          end: Math.max(bucketEnd, Number(existingCue.end || bucketEnd)),
          anchorStart: Number.isFinite(existingCue.anchorStart)
            ? Math.min(Number(existingCue.anchorStart), sampleAnchor)
            : sampleAnchor,
          text: merged
        };
        return true;
      }

      this.cues.push({
        start: bucketStart,
        end: bucketEnd,
        anchorStart: sampleAnchor,
        text: normalized
      });
      this.cues.sort((left, right) => left.start - right.start);
      return true;
    }

    backfillLiveBucketsFromTextTracks(currentBucketIndex) {
      if (!Number.isFinite(currentBucketIndex) || currentBucketIndex < 0) {
        return false;
      }
      const nowMs = Date.now();
      if (
        currentBucketIndex === this.liveLastBackfillBucketIndex &&
        nowMs - Number(this.liveLastBackfillAt || 0) < 900
      ) {
        return false;
      }
      this.liveLastBackfillBucketIndex = currentBucketIndex;
      this.liveLastBackfillAt = nowMs;
      if (!this.video || !this.video.textTracks || !this.video.textTracks.length) {
        return false;
      }

      const startBucket = Math.max(0, currentBucketIndex - 4);
      let changed = false;
      for (let bucketIndex = startBucket; bucketIndex <= currentBucketIndex; bucketIndex += 1) {
        const snapshot = this.readTextTrackWindowSnapshot(bucketIndex);
        if (!snapshot || !snapshot.text) {
          continue;
        }
        const sampleTime = bucketIndex * this.getLiveWindowSeconds();
        if (this.upsertLiveBucketCue(snapshot.text, sampleTime, { force: true })) {
          changed = true;
        }
      }
      return changed;
    }

    readFuturePreviewChunksFromTextTracks(currentBucketIndex) {
      if (!Number.isFinite(currentBucketIndex) || currentBucketIndex < 0) {
        return [];
      }
      const nowMs = Date.now();
      if (
        currentBucketIndex === this.liveLastFutureBackfillBucketIndex &&
        nowMs - Number(this.liveLastFutureBackfillAt || 0) < 900
      ) {
        return this.liveFuturePreviewChunks || [];
      }
      this.liveLastFutureBackfillBucketIndex = currentBucketIndex;
      this.liveLastFutureBackfillAt = nowMs;
      if (!this.video || !this.video.textTracks || !this.video.textTracks.length) {
        this.liveFuturePreviewChunks = [];
        return [];
      }

      const previews = [];
      for (let offset = 1; offset <= 4; offset += 1) {
        const bucketIndex = currentBucketIndex + offset;
        const snapshot = this.readTextTrackWindowSnapshot(bucketIndex);
        if (!snapshot || !snapshot.text) {
          continue;
        }
        const start = bucketIndex * this.getLiveWindowSeconds();
        const end = this.getLiveWindowEnd(start);
        const seekStart = Number.isFinite(snapshot.startTime) ? Math.max(0, Number(snapshot.startTime)) : start;
        previews.push(this.createBubbleRecord({
          sourceId: "future-" + bucketIndex,
          start: start,
          end: end,
          seekStart: seekStart,
          locked: true,
          text: snapshot.text
        }));
      }
      this.liveFuturePreviewChunks = previews;
      return previews;
    }

    shouldContinueOverlayUtterance(previousCanonical, nextCanonical) {
      const prev = String(previousCanonical || "").trim();
      const next = String(nextCanonical || "").trim();
      if (!prev || !next) {
        return false;
      }
      if (prev === next) {
        return true;
      }
      if (prev.length >= 10 && next.includes(prev)) {
        return true;
      }
      if (next.length >= 10 && prev.includes(next)) {
        return true;
      }
      return this.isHighOverlapText(prev, next);
    }

    updateLiveBucketLocks(currentBucketIndex) {
      if (!Number.isFinite(currentBucketIndex) || currentBucketIndex < 0) {
        return;
      }
      if (!Number.isFinite(this.liveMaxBucketIndexSeen) || this.liveMaxBucketIndexSeen < 0) {
        this.liveMaxBucketIndexSeen = currentBucketIndex;
        this.sealFinishedLiveBubbles(currentBucketIndex);
        return;
      }
      if (currentBucketIndex <= this.liveMaxBucketIndexSeen) {
        return;
      }
      this.liveLockCutoffIndex = Math.max(this.liveLockCutoffIndex, currentBucketIndex - 4);
      this.liveMaxBucketIndexSeen = currentBucketIndex;
      this.sealFinishedLiveBubbles(currentBucketIndex);
    }

    captureLiveCaptionLine() {
      if (!this.liveCaptureEnabled || !this.video || this.settings.panelClosed) {
        return;
      }

      if (Date.now() < Number(this.liveCaptureSuppressedUntil || 0)) {
        return;
      }

      const now = Number(this.video.currentTime || 0);
      if (!Number.isFinite(now)) {
        return;
      }

      if (this.isDiscontinuousLiveTimeMove(now)) {
        this.handleDiscontinuousTimeMove();
      }
      this.liveLastObservedTime = now;
      const currentBucketIndex = this.getLiveWindowIndex(now);
      this.updateLiveBucketLocks(currentBucketIndex);
      const backfilled = this.backfillLiveBucketsFromTextTracks(currentBucketIndex);
      const previousFutureKey = this.getFuturePreviewKey();
      this.readFuturePreviewChunksFromTextTracks(currentBucketIndex);
      const futureChanged = previousFutureKey !== this.getFuturePreviewKey();

      const windowSnapshot = this.readTextTrackWindowSnapshot(currentBucketIndex);
      const activeSnapshot = this.readTextTrackSnapshotAtCurrentTime();
      let text = "";
      let anchorTime = currentBucketIndex * this.getLiveWindowSeconds();
      let usedOverlayOnlyPath = false;

      if (windowSnapshot && windowSnapshot.text) {
        this.liveOverlayUtterance = null;
        text = windowSnapshot.text;
        if (activeSnapshot && activeSnapshot.text) {
          text = this.mergeLiveCaptionText(text, activeSnapshot.text);
          this.updateLiveOverlayAnchorOffset(now, activeSnapshot.startTime);
        }
      } else if (activeSnapshot && activeSnapshot.text) {
        this.liveOverlayUtterance = null;
        text = activeSnapshot.text;
        if (Number.isFinite(activeSnapshot.startTime)) {
          anchorTime = Math.max(0, Number(activeSnapshot.startTime));
        } else {
          anchorTime = now;
        }
        this.updateLiveOverlayAnchorOffset(now, activeSnapshot.startTime);
        const overlayText = this.readVisibleCaptionText();
        if (overlayText) {
          text = this.mergeLiveCaptionText(text, overlayText);
        }
      } else {
        usedOverlayOnlyPath = true;
        text = this.readVisibleCaptionText();
        const canonical = this.toCaptionCanonical(text);
        const previousUtterance = this.liveOverlayUtterance;
        let targetBucketIndex = currentBucketIndex;

        if (
          previousUtterance &&
          Number.isFinite(previousUtterance.bucketIndex) &&
          previousUtterance.bucketIndex >= 0 &&
          Number.isFinite(previousUtterance.lastSeenAt) &&
          now - previousUtterance.lastSeenAt <= Math.max(2.2, this.getLiveWindowSeconds() * 0.75) &&
          this.shouldContinueOverlayUtterance(previousUtterance.canonical, canonical)
        ) {
          targetBucketIndex = previousUtterance.bucketIndex;
        }

        anchorTime = targetBucketIndex * this.getLiveWindowSeconds() + 0.001;
        this.liveOverlayUtterance = {
          bucketIndex: targetBucketIndex,
          canonical: canonical,
          lastSeenAt: now
        };
      }
      if (!text) {
        if (this.liveOverlayUtterance && Number.isFinite(this.liveOverlayUtterance.lastSeenAt)) {
          if (now - this.liveOverlayUtterance.lastSeenAt > 1.8) {
            this.liveOverlayUtterance = null;
          }
        }
        if (backfilled) {
          this.rebuildChunks();
          this.syncActiveChunk(true);
        } else if (futureChanged) {
          this.updateFuturePreviewChunks();
        }
        this.maybeProbeCaptions();
        return;
      }

      const normalized = this.cleanCaptionCandidateText(text);
      if (!normalized || !this.toCaptionCanonical(normalized)) {
        return;
      }

      if (usedOverlayOnlyPath && this.liveOverlayUtterance) {
        this.liveOverlayUtterance.canonical = this.toCaptionCanonical(normalized);
        this.liveOverlayUtterance.lastSeenAt = now;
      }

      const changed = this.upsertLiveBucketCue(normalized, anchorTime);
      if (changed || backfilled) {
        this.rebuildChunks();
        this.syncActiveChunk(true);
        if (this.panel && this.cues.length === 1) {
          this.panel.setStatus("Live subtitle capture started.", true);
        }
      } else if (futureChanged) {
        this.updateFuturePreviewChunks();
      }
    }

    pickPreferredTrack(tracklist) {
      const tracks = Array.isArray(tracklist) ? tracklist : [];
      if (!tracks.length) {
        return null;
      }
      const englishManual = tracks.find((track) => {
        const languageCode = String(track && track.languageCode ? track.languageCode : "").toLowerCase();
        const kind = String(track && track.kind ? track.kind : "").toLowerCase();
        return languageCode.startsWith("en") && kind !== "asr";
      });
      if (englishManual) {
        return englishManual;
      }
      const manual = tracks.find((track) => {
        const kind = String(track && track.kind ? track.kind : "").toLowerCase();
        return kind !== "asr";
      });
      return manual || tracks[0];
    }

    probeCaptionsNow() {
      const now = Date.now();
      this.lastCaptionProbeAt = now;

      if (pageContext && typeof pageContext.triggerCaptionProbe === "function") {
        pageContext.triggerCaptionProbe();
      }

      const player = document.getElementById("movie_player");
      if (!player) {
        return;
      }

      try {
        if (typeof player.loadModule === "function") {
          player.loadModule("captions");
        }
      } catch {
        // Ignore module load failures.
      }

      try {
        if (typeof player.getOption === "function" && typeof player.setOption === "function") {
          const tracklist = player.getOption("captions", "tracklist");
          const preferred = this.pickPreferredTrack(tracklist);
          if (preferred) {
            player.setOption("captions", "track", preferred);
          }
          player.setOption("captions", "reload", true);
        }
      } catch {
        // Ignore caption option failures.
      }

      try {
        if (typeof player.isSubtitlesOn === "function" && typeof player.toggleSubtitles === "function") {
          if (!player.isSubtitlesOn()) {
            player.toggleSubtitles();
          }
        }
      } catch {
        // Ignore toggle failures.
      }
    }

    isSubtitlesEnabled() {
      const subtitleButton = document.querySelector(".ytp-subtitles-button");
      if (!(subtitleButton instanceof HTMLElement)) {
        const player = document.getElementById("movie_player");
        try {
          return Boolean(player && typeof player.isSubtitlesOn === "function" && player.isSubtitlesOn());
        } catch {
          return false;
        }
      }
      const pressed = String(subtitleButton.getAttribute("aria-pressed") || "").toLowerCase();
      return pressed === "true";
    }

    clickSubtitlesButtonFallback() {
      const subtitleButton = document.querySelector(".ytp-subtitles-button");
      if (!(subtitleButton instanceof HTMLElement)) {
        return false;
      }
      const pressed = String(subtitleButton.getAttribute("aria-pressed") || "").toLowerCase();
      if (pressed === "true") {
        return true;
      }
      try {
        subtitleButton.click();
        return true;
      } catch {
        return false;
      }
    }

    setSubtitlesEnabled(enabled) {
      const desired = Boolean(enabled);
      const subtitleButton = document.querySelector(".ytp-subtitles-button");
      if (subtitleButton instanceof HTMLElement) {
        const pressed = String(subtitleButton.getAttribute("aria-pressed") || "").toLowerCase();
        const isOn = pressed === "true";
        if (isOn === desired) {
          return true;
        }
        try {
          subtitleButton.click();
          return true;
        } catch {
          return false;
        }
      }

      const player = document.getElementById("movie_player");
      try {
        const isOn = Boolean(player && typeof player.isSubtitlesOn === "function" && player.isSubtitlesOn());
        if (isOn === desired) {
          return true;
        }
        if (player && typeof player.toggleSubtitles === "function") {
          player.toggleSubtitles();
          return true;
        }
      } catch {
        return false;
      }
      return false;
    }

    restoreSubtitlesIfExtensionEnabled() {
      if (!this.captionsEnabledByExtension || this.captionsWereOnBeforeExtension !== false) {
        return;
      }
      if (this.isSubtitlesEnabled()) {
        this.setSubtitlesEnabled(false);
      }
      this.captionsEnabledByExtension = false;
      this.captionsEnsured = false;
    }

    ensureCaptionsEnabledOnce() {
      if (this.destroyed || this.settings.panelClosed) {
        return;
      }
      if (this.captionsWereOnBeforeExtension === null) {
        this.captionsWereOnBeforeExtension = this.isSubtitlesEnabled();
      }
      if (this.isSubtitlesEnabled()) {
        this.captionsEnsured = true;
        return;
      }

      if (pageContext && typeof pageContext.triggerCaptionProbe === "function") {
        pageContext.triggerCaptionProbe();
      }
      this.probeCaptionsNow();

      if (!this.isSubtitlesEnabled()) {
        this.clickSubtitlesButtonFallback();
      }

      if (this.isSubtitlesEnabled()) {
        this.captionsEnsured = true;
        this.captionsEnabledByExtension = this.captionsWereOnBeforeExtension === false;
      }
    }

    startCaptionEnsureLoop() {
      if (this.captionEnsureStarted) {
        return;
      }
      this.captionEnsureStarted = true;
      const delaysMs = [0, 350, 800, 1500, 2600, 4200, 6200];
      for (let index = 0; index < delaysMs.length; index += 1) {
        const timerId = window.setTimeout(() => {
          if (this.destroyed || this.captionsEnsured) {
            return;
          }
          this.ensureCaptionsEnabledOnce();
        }, delaysMs[index]);
        this.cleanupFns.push(() => window.clearTimeout(timerId));
      }
    }

    maybeProbeCaptions() {
      if (this.settings.panelClosed) {
        return;
      }
      const now = Date.now();
      if (now - this.lastCaptionProbeAt < 2500) {
        return;
      }
      this.probeCaptionsNow();
    }

    async startCaptionWork() {
      if (this.destroyed || this.settings.panelClosed) {
        return;
      }
      if (this.captionWorkStarted) {
        this.ensureCaptionsEnabledOnce();
        if (!this.liveCaptureEnabled) {
          this.enableLiveCaptureMode();
        } else {
          this.startLiveCapturePolling();
        }
        this.syncActiveChunk(true);
        return;
      }

      this.captionWorkStarted = true;
      this.ensurePageBridgeForWatchPage();
      if (this.panel) {
        this.panel.setStatus("Loading subtitles...");
      }
      this.startCaptionEnsureLoop();
      this.enableLiveCaptureMode();
      await this.loadTranscript();
      this.syncActiveChunk(true);
    }

    enableLiveCaptureMode() {
      if (this.liveCaptureEnabled) {
        this.startLiveCapturePolling();
        return;
      }
      this.transcriptMode = "live overlay fallback mode";
      this.liveCaptureEnabled = true;
      this.cues = [];
      this.revealedChunkCount = 0;
      this.liveCaptureSuppressedUntil = 0;
      this.liveLastObservedTime = Number.NaN;
      this.liveMaxBucketIndexSeen = -1;
      this.liveLockCutoffIndex = -1;
      this.liveLastBackfillAt = 0;
      this.liveLastBackfillBucketIndex = -1;
      this.liveLastFutureBackfillAt = 0;
      this.liveLastFutureBackfillBucketIndex = -1;
      this.liveFuturePreviewChunks = [];
      this.liveBubbles = [];
      this.liveBucketToBubble = new Map();
      this.liveDisplayBubbleCache = new Map();
      this.liveNextBubbleUid = 1;
      this.lastCaptionProbeAt = 0;
      this.rebuildChunks();
      this.probeCaptionsNow();
      this.captureLiveCaptionLine();

      this.startLiveCapturePolling();
    }

    disableLiveCaptureMode() {
      this.liveCaptureEnabled = false;
      this.liveLastObservedTime = Number.NaN;
      this.liveCaptureSuppressedUntil = 0;
      this.liveMaxBucketIndexSeen = -1;
      this.liveLockCutoffIndex = -1;
      this.liveLastBackfillAt = 0;
      this.liveLastBackfillBucketIndex = -1;
      this.liveLastFutureBackfillAt = 0;
      this.liveLastFutureBackfillBucketIndex = -1;
      this.liveFuturePreviewChunks = [];
      this.liveOverlayAnchorOffsetSeconds = 2.5;
      this.liveOverlayUtterance = null;
      this.liveBubbles = [];
      this.liveBucketToBubble = new Map();
      this.liveDisplayBubbleCache = new Map();
      this.stopLiveCapturePolling();
    }

    startLiveCapturePolling() {
      if (this.liveCapturePollId || this.destroyed || this.settings.panelClosed) {
        return;
      }
      this.liveCapturePollId = window.setInterval(() => {
        this.maybeProbeCaptions();
        this.captureLiveCaptionLine();
        this.maybeUpgradeLiveCaptureToTranscript();
      }, 120);
    }

    stopLiveCapturePolling() {
      if (this.liveCapturePollId) {
        window.clearInterval(this.liveCapturePollId);
        this.liveCapturePollId = 0;
      }
    }

    requestTimelineSync(forceScroll) {
      if (forceScroll) {
        this.timelineSyncForceScroll = true;
      }
      if (this.syncRafId) {
        return;
      }
      this.syncRafId = platform.requestFrame(() => {
        this.syncRafId = 0;
        const shouldForceScroll = Boolean(this.timelineSyncForceScroll);
        this.timelineSyncForceScroll = false;
        this.commitTimelineSync(shouldForceScroll);
      });
    }

    scheduleSync() {
      this.requestTimelineSync(false);
    }

    commitTimelineSync(forceScroll) {
      this.syncActiveChunk(Boolean(forceScroll));
    }

    ensureChunkVisible(indexInclusive) {
      if (!Array.isArray(this.allChunks) || !this.allChunks.length) {
        return;
      }
      const targetCount = Math.max(0, Math.min(this.allChunks.length, Number(indexInclusive) + 1));
      if (!Number.isFinite(targetCount) || targetCount <= this.revealedChunkCount) {
        return;
      }
      this.revealedChunkCount = targetCount;
      this.chunks = this.allChunks.slice(0, this.revealedChunkCount);
      if (this.panel) {
        this.panel.setChunks(this.chunks);
        this.updateFuturePreviewChunks();
      }
    }

    canShowFuturePreviewChunks() {
      if (this.liveCaptureEnabled) {
        return Array.isArray(this.liveFuturePreviewChunks) && this.liveFuturePreviewChunks.length > 0;
      }
      return Array.isArray(this.allChunks) && this.allChunks.length > Number(this.revealedChunkCount || 0);
    }

    getFuturePreviewKey() {
      const previews = Array.isArray(this.liveFuturePreviewChunks) ? this.liveFuturePreviewChunks : [];
      return previews
        .map((chunk) => [chunk.start, chunk.end, chunk.seekStart, chunk.text].join(":"))
        .join("|");
    }

    getFuturePreviewChunks() {
      if (!this.canShowFuturePreviewChunks()) {
        return [];
      }
      if (this.liveCaptureEnabled) {
        const previews = Array.isArray(this.liveFuturePreviewChunks) ? this.liveFuturePreviewChunks : [];
        return previews.slice(0, 4).map((chunk, index) => ({
          ...chunk,
          actualIndex: Number.isInteger(chunk.actualIndex) ? chunk.actualIndex : -1000 - index,
          futurePreviewOnly: true
        }));
      }
      const previewStart = Math.max(0, Number(this.revealedChunkCount || 0));
      const previewEnd = Math.min(this.allChunks.length, previewStart + 4);
      const previews = [];
      for (let index = previewStart; index < previewEnd; index += 1) {
        previews.push({
          ...this.allChunks[index],
          actualIndex: index
        });
      }
      return previews;
    }

    updateFuturePreviewChunks() {
      if (this.panel && typeof this.panel.setFutureChunks === "function") {
        this.panel.setFutureChunks(this.getFuturePreviewChunks());
      }
    }

    syncActiveChunk(forceScroll) {
      if (!this.video || !this.panel) {
        return;
      }
      const sourceChunks = this.allChunks;
      if (!sourceChunks.length) {
        this.updateFuturePreviewChunks();
        return;
      }
      const currentTime = this.video.currentTime || 0;
      const pending = this.pendingSeekFocus;
      if (
        pending &&
        Date.now() <= pending.expiresAt &&
        pending.index >= 0 &&
        pending.index < sourceChunks.length &&
        currentTime >= pending.minTime &&
        currentTime <= pending.maxTime
      ) {
        this.ensureChunkVisible(pending.index);
        this.activeIndex = Math.max(0, Math.min(pending.index, this.chunks.length - 1));
        this.panel.setActiveIndex(this.activeIndex, { ensureVisible: forceScroll });
        if (typeof this.panel.setPlaybackTime === "function") {
          this.panel.setPlaybackTime(this.getTimelineDisplayTime(currentTime, sourceChunks[pending.index], pending.index));
        }
        this.triggerBubbleStartFlashIfReady(sourceChunks[pending.index], this.activeIndex, currentTime);
        return;
      }
      this.pendingSeekFocus = null;
      const nextIndex = chunker.findActiveChunkIndexAtTime(sourceChunks, currentTime, 0.9);
      if (nextIndex < 0) {
        this.activeIndex = -1;
        this.panel.setActiveIndex(-1);
        this.updateFuturePreviewChunks();
        return;
      }
      this.ensureChunkVisible(nextIndex);
      this.updateFuturePreviewChunks();
      this.activeIndex = Math.max(0, Math.min(nextIndex, this.chunks.length - 1));
      this.panel.setActiveIndex(this.activeIndex, { ensureVisible: forceScroll });
      if (typeof this.panel.setPlaybackTime === "function") {
        this.panel.setPlaybackTime(this.getTimelineDisplayTime(currentTime, sourceChunks[nextIndex], nextIndex));
      }
      this.triggerBubbleStartFlashIfReady(sourceChunks[nextIndex], this.activeIndex, currentTime);
    }

    triggerBubbleStartFlashIfReady(chunk, visibleIndex, currentTime) {
      if (!this.panel || !bubbleState.consumeFlashOnStart(chunk, currentTime)) {
        return;
      }
      if (typeof this.panel.flashChunk === "function") {
        this.panel.flashChunk(visibleIndex);
      }
    }

    abortTranscriptLoad() {
      if (this.loadAbortController) {
        this.loadAbortController.abort();
        this.loadAbortController = null;
      }
    }

    maybeUpgradeLiveCaptureToTranscript() {
      if (
        this.destroyed ||
        this.settings.panelClosed ||
        !this.liveCaptureEnabled ||
        this.transcriptUpgradeInFlight ||
        this.transcriptUpgradeAttempts >= 8
      ) {
        return;
      }
      const now = Date.now();
      if (now - Number(this.lastTranscriptUpgradeAt || 0) < 7000) {
        return;
      }
      this.lastTranscriptUpgradeAt = now;
      this.transcriptUpgradeAttempts += 1;
      this.tryUpgradeLiveCaptureToTranscript();
    }

    async tryUpgradeLiveCaptureToTranscript() {
      if (this.transcriptUpgradeInFlight || this.destroyed || this.settings.panelClosed || !this.liveCaptureEnabled) {
        return;
      }
      this.transcriptUpgradeInFlight = true;
      this.ensurePageBridgeForWatchPage();
      this.probeCaptionsNow();
      const controller = new AbortController();
      const signal = controller.signal;
      const timeoutId = window.setTimeout(() => controller.abort(), 11000);

      try {
        await this.waitForCaptionContextReady(1600);
        if (signal.aborted || this.destroyed || this.settings.panelClosed || !this.liveCaptureEnabled) {
          return;
        }
        const response = await transcript.loadTranscript(window.location.href, signal, {
          videoElement: this.video
        });
        if (
          !response ||
          !response.ok ||
          response.videoId !== this.videoId ||
          !Array.isArray(response.cues) ||
          !response.cues.length ||
          this.destroyed ||
          this.settings.panelClosed
        ) {
          return;
        }

        this.disableLiveCaptureMode();
        this.transcriptMode = response.mode || "direct transcript mode";
        this.cues = response.cues;
        this.revealedChunkCount = 0;
        this.rebuildChunks();
        this.syncActiveChunk(true);
        if (this.panel) {
          this.panel.setStatus("Full transcript loaded. Next up previews are available.", true);
        }
      } catch (error) {
        if (!error || error.name !== "AbortError") {
          // Keep live overlay mode quiet; failed upgrades are expected on some videos.
        }
      } finally {
        window.clearTimeout(timeoutId);
        this.transcriptUpgradeInFlight = false;
      }
    }

    async loadTranscript() {
      this.abortTranscriptLoad();
      this.loadAbortController = new AbortController();
      this.transcriptMode = "loading";
      this.transcriptLoadAttempts += 1;

      const url = window.location.href;
      const signal = this.loadAbortController.signal;
      const transcriptTimeoutMs = 10000;
      if (signal.aborted || this.destroyed) {
        return;
      }
      this.maybeProbeCaptions();
      await this.waitForCaptionContextReady(2400);
      if (signal.aborted || this.destroyed) {
        return;
      }
      const response = await Promise.race([
        transcript.loadTranscript(url, signal, {
          videoElement: this.video
        }),
        new Promise((resolve) => {
          window.setTimeout(() => {
            resolve({ ok: false, reason: "Transcript loading timed out." });
          }, transcriptTimeoutMs);
        })
      ]);

      if (!response || !response.ok) {
        const reason = String(response && response.reason ? response.reason : "");
        const isLikelyReloadRace =
          reason.includes("No caption tracks") || reason.includes("No subtitle cues");
        if (isLikelyReloadRace && this.transcriptLoadAttempts <= 1 && !signal.aborted && !this.destroyed) {
          await new Promise((resolve) => window.setTimeout(resolve, 950));
          if (!signal.aborted && !this.destroyed) {
            return this.loadTranscript();
          }
        }
        const shouldEnableLiveCapture =
          reason.includes("No subtitle cues") ||
          reason.includes("No caption tracks") ||
          reason.includes("Transcript loading failed") ||
          reason.includes("timed out");

        if (shouldEnableLiveCapture) {
          this.enableLiveCaptureMode();
          this.transcriptMode = "live overlay fallback mode";
        }
        if (this.panel) {
          if (!this.cues.length) {
            this.panel.setChunks([]);
          }
          this.panel.setStatus(
            shouldEnableLiveCapture
              ? "Turn on YouTube CC if needed. Click any chat bubble to seek, or hover here and use Space / Shift+Space."
              : (response && response.reason) || "Subtitles are unavailable."
          );
        }
        return;
      }

      if (response.videoId !== this.videoId) {
        return;
      }

      this.disableLiveCaptureMode();
      this.transcriptMode = response.mode || "direct transcript mode";
      this.cues = response.cues;
      this.revealedChunkCount = 0;
      this.rebuildChunks();
      if (this.panel) {
        const stepSeconds = this.getKeyboardStepSeconds();
        this.panel.setStatus(
          "Loaded " +
            this.chunks.length +
            " chunks (" +
            (response.mode || "direct transcript mode") +
            "). Hover panel + Space=+" +
            stepSeconds +
            "s, Shift+Space=-" +
            stepSeconds +
            "s.",
          true
        );
      }
    }

    buildFixedWindowChunksFromCues(cues) {
      const stepSeconds = this.getKeyboardStepSeconds();
      const source = Array.isArray(cues) ? cues.slice() : [];
      source.sort((left, right) => Number(left.start || 0) - Number(right.start || 0));

      const buckets = new Map();
      for (let cueIndex = 0; cueIndex < source.length; cueIndex += 1) {
        const cue = source[cueIndex];
        const text = this.cleanCaptionCandidateText(cue && cue.text ? cue.text : "");
        if (!text) {
          continue;
        }
        const cueStart = Math.max(0, Number(cue && cue.start ? cue.start : 0));
        const cueAnchor = Number.isFinite(cue && cue.anchorStart)
          ? Math.max(0, Number(cue.anchorStart))
          : cueStart;
        const bucketIndex = this.getLiveWindowIndex(cueStart);
        const bucketStart = bucketIndex * stepSeconds;
        const bucketEnd = bucketStart + stepSeconds;
        const existing = buckets.get(bucketIndex);
        if (!existing) {
          buckets.set(bucketIndex, {
            start: bucketStart,
            end: bucketEnd,
            seekStart: cueAnchor,
            text: text
          });
          continue;
        }
        existing.text = this.mergeLiveCaptionText(existing.text, text);
        existing.end = Math.max(existing.end, bucketEnd);
        if (Number.isFinite(cueAnchor)) {
          existing.seekStart = Math.min(Number(existing.seekStart || cueAnchor), cueAnchor);
        }
      }

      const orderedIndexes = Array.from(buckets.keys()).sort((left, right) => left - right);
      const chunks = [];
      for (let index = 0; index < orderedIndexes.length; index += 1) {
        const bucket = buckets.get(orderedIndexes[index]);
        if (!bucket || !bucket.text) {
          continue;
        }
        const text = bucket.text;
        if (!text) {
          continue;
        }
        chunks.push({
          id: chunks.length,
          start: bucket.start,
          end: bucket.end,
          seekStart: Number.isFinite(bucket.seekStart) ? bucket.seekStart : bucket.start,
          text: text
        });
      }
      return chunks;
    }

    isCaptionStageDirection(text) {
      const value = this.normalizeLiveCaptionText(text);
      if (!value) {
        return false;
      }
      return /^(\[[^\]]+\]\s*)+$/.test(value);
    }

    shouldStartNewLiveBubble(previousChunk, nextChunk) {
      if (!previousChunk) {
        return true;
      }
      if (this.isCaptionStageDirection(previousChunk.text) || this.isCaptionStageDirection(nextChunk.text)) {
        return true;
      }
      const previousEnd = Number(previousChunk.end || 0);
      const nextStart = Number(nextChunk.start || 0);
      const gap = nextStart - previousEnd;
      const hasRealPause = Number.isFinite(gap) && gap >= 2.4;
      if (hasRealPause) {
        return true;
      }

      const bucketCount = Array.isArray(previousChunk.bucketIndexes) ? previousChunk.bucketIndexes.length : 1;
      const previousLength = this.normalizeLiveCaptionText(previousChunk.text).length;
      const combined = this.normalizeLiveCaptionText(previousChunk.text + " " + nextChunk.text);
      const lyricLike =
        captionText.looksLyricLike(previousChunk.text) ||
        captionText.looksLyricLike(nextChunk.text) ||
        captionText.looksLyricLike(combined);

      if (lyricLike && (bucketCount >= 2 || previousLength >= 180 || combined.length >= 260)) {
        return true;
      }

      if (!this.textEndsNaturally(previousChunk.text)) {
        return bucketCount >= 3 || previousLength >= 340 || combined.length >= 430;
      }

      if (bucketCount >= 2 || previousLength >= 220 || combined.length >= 320) {
        return true;
      }

      return previousLength >= 150 || combined.length >= 260;
    }

    getLiveChunkBucketIndex(chunk) {
      return this.getLiveWindowIndex(Number(chunk && chunk.start ? chunk.start : 0));
    }

    getNextLiveBubbleUid() {
      const uid = "live-" + String(this.liveNextBubbleUid || 1);
      this.liveNextBubbleUid = (Number(this.liveNextBubbleUid) || 1) + 1;
      return uid;
    }

    createLiveBubbleFromChunk(chunk) {
      const bucketIndex = this.getLiveChunkBucketIndex(chunk);
      return {
        uid: this.getNextLiveBubbleUid(),
        id: this.liveBubbles.length,
        start: Number.isFinite(chunk.seekStart) ? Number(chunk.seekStart) : Number(chunk.start || 0),
        end: Number(chunk.end || 0),
        seekStart: Number.isFinite(chunk.seekStart) ? Number(chunk.seekStart) : Number(chunk.start || 0),
        text: this.cleanCaptionCandidateText(chunk.text),
        locked: false,
        bucketIndexes: [bucketIndex],
        bucketTexts: { [bucketIndex]: this.cleanCaptionCandidateText(chunk.text) },
        bucketStarts: { [bucketIndex]: Number(chunk.start || 0) },
        bucketEnds: { [bucketIndex]: Number(chunk.end || 0) },
        bucketSeekStarts: {
          [bucketIndex]: Number.isFinite(chunk.seekStart) ? Number(chunk.seekStart) : Number(chunk.start || 0)
        }
      };
    }

    createBubbleRecord(data) {
      return bubbleState.createBubbleRecord(data, (value) => this.cleanCaptionCandidateText(value));
    }

    withDisplayIds(records) {
      return bubbleState.withDisplayIds(records);
    }

    rebuildLiveBubbleText(bubble) {
      if (!bubble || !Array.isArray(bubble.bucketIndexes)) {
        return;
      }
      const ordered = bubble.bucketIndexes.slice().sort((left, right) => left - right);
      let text = "";
      let start = Number.POSITIVE_INFINITY;
      let end = 0;
      let seekStart = Number.POSITIVE_INFINITY;
      for (let index = 0; index < ordered.length; index += 1) {
        const bucketIndex = ordered[index];
        const bucketText = this.cleanCaptionCandidateText(bubble.bucketTexts ? bubble.bucketTexts[bucketIndex] : "");
        text = this.mergeLiveCaptionText(text, bucketText);
        start = Math.min(start, Number(bubble.bucketStarts && bubble.bucketStarts[bucketIndex]));
        end = Math.max(end, Number(bubble.bucketEnds && bubble.bucketEnds[bucketIndex]));
        seekStart = Math.min(seekStart, Number(bubble.bucketSeekStarts && bubble.bucketSeekStarts[bucketIndex]));
      }
      bubble.text = this.cleanCaptionCandidateText(text);
      bubble.start = Number.isFinite(seekStart) ? seekStart : Number.isFinite(start) ? start : 0;
      bubble.seekStart = bubble.start;
      bubble.end = Math.max(bubble.start + 0.25, Number.isFinite(end) ? end : bubble.start + 0.25);
    }

    appendBucketToLiveBubble(bubble, chunk) {
      if (!bubble || bubble.locked) {
        return;
      }
      const bucketIndex = this.getLiveChunkBucketIndex(chunk);
      if (!bubble.bucketIndexes.includes(bucketIndex)) {
        bubble.bucketIndexes.push(bucketIndex);
      }
      bubble.bucketTexts[bucketIndex] = this.cleanCaptionCandidateText(chunk.text);
      bubble.bucketStarts[bucketIndex] = Number(chunk.start || 0);
      bubble.bucketEnds[bucketIndex] = Number(chunk.end || 0);
      bubble.bucketSeekStarts[bucketIndex] = Number.isFinite(chunk.seekStart)
        ? Number(chunk.seekStart)
        : Number(chunk.start || 0);
      this.liveBucketToBubble.set(bucketIndex, bubble);
      this.rebuildLiveBubbleText(bubble);
    }

    lockLiveBubble(bubble) {
      if (!bubble) {
        return null;
      }
      bubble.locked = true;
      bubble.immutable = true;
      if (!this.liveDisplayBubbleCache || !(this.liveDisplayBubbleCache instanceof Map)) {
        this.liveDisplayBubbleCache = new Map();
      }
      if (bubble.uid && !this.liveDisplayBubbleCache.has(bubble.uid)) {
        this.liveDisplayBubbleCache.set(bubble.uid, this.createLockedDisplayBubbles(bubble));
      }
      return bubble;
    }

    getLiveBubbleLatestBucketIndex(bubble) {
      if (!bubble || !Array.isArray(bubble.bucketIndexes) || !bubble.bucketIndexes.length) {
        return -1;
      }
      let latest = -1;
      for (let index = 0; index < bubble.bucketIndexes.length; index += 1) {
        const bucketIndex = Number(bubble.bucketIndexes[index]);
        if (Number.isFinite(bucketIndex)) {
          latest = Math.max(latest, bucketIndex);
        }
      }
      return latest;
    }

    shouldSealLiveBubble(bubble, currentBucketIndex) {
      if (!bubble || bubble.locked) {
        return false;
      }
      const latestBucketIndex = this.getLiveBubbleLatestBucketIndex(bubble);
      if (latestBucketIndex < 0 || !Number.isFinite(currentBucketIndex)) {
        return false;
      }
      return latestBucketIndex < currentBucketIndex || latestBucketIndex <= this.liveLockCutoffIndex;
    }

    sealFinishedLiveBubbles(currentBucketIndex) {
      if (!Array.isArray(this.liveBubbles) || !this.liveBubbles.length) {
        return;
      }
      for (let index = 0; index < this.liveBubbles.length; index += 1) {
        const bubble = this.liveBubbles[index];
        if (this.shouldSealLiveBubble(bubble, currentBucketIndex)) {
          this.lockLiveBubble(bubble);
        }
      }
    }

    syncLiveBubblesFromBuckets(chunks) {
      const source = Array.isArray(chunks) ? chunks : [];
      if (!this.liveBucketToBubble || !(this.liveBucketToBubble instanceof Map)) {
        this.liveBucketToBubble = new Map();
      }
      if (!Array.isArray(this.liveBubbles)) {
        this.liveBubbles = [];
      }

      for (let index = 0; index < source.length; index += 1) {
        const chunk = source[index];
        const text = this.cleanCaptionCandidateText(chunk && chunk.text ? chunk.text : "");
        if (!chunk || !text) {
          continue;
        }

        const bucketIndex = this.getLiveChunkBucketIndex(chunk);
        const existingBubble = this.liveBucketToBubble.get(bucketIndex);
        if (existingBubble) {
          if (!existingBubble.locked) {
            const previousBubble = this.getPreviousLiveBubble(existingBubble);
            const nextChunk = previousBubble ? this.trimLiveChunkAgainstPrevious(previousBubble.text, { ...chunk, text }) : { ...chunk, text };
            if (nextChunk.text) {
              this.appendBucketToLiveBubble(existingBubble, nextChunk);
            }
          }
          continue;
        }

        const activeBubble = this.liveBubbles[this.liveBubbles.length - 1];
        if (!activeBubble) {
          const firstBubble = this.createLiveBubbleFromChunk({ ...chunk, text: text });
          this.liveBubbles.push(firstBubble);
          this.liveBucketToBubble.set(bucketIndex, firstBubble);
          continue;
        }

        const nextChunk = this.trimLiveChunkAgainstPrevious(activeBubble.text, { ...chunk, text });
        if (!nextChunk.text) {
          continue;
        }

        if (activeBubble.locked || this.shouldStartNewLiveBubble(activeBubble, nextChunk)) {
          this.lockLiveBubble(activeBubble);
          const nextBubble = this.createLiveBubbleFromChunk(nextChunk);
          this.liveBubbles.push(nextBubble);
          this.liveBucketToBubble.set(bucketIndex, nextBubble);
          continue;
        }

        this.appendBucketToLiveBubble(activeBubble, nextChunk);
      }

      if (Number.isFinite(this.liveMaxBucketIndexSeen)) {
        this.sealFinishedLiveBubbles(this.liveMaxBucketIndexSeen);
      }

      for (let index = 0; index < this.liveBubbles.length; index += 1) {
        this.liveBubbles[index].id = index;
      }
      return this.polishLiveBubbles(this.liveBubbles);
    }

    polishLiveBubbles(bubbles) {
      const source = Array.isArray(bubbles) ? bubbles : [];
      const records = [];
      let minNextStart = 0;

      for (let index = 0; index < source.length; index += 1) {
        const bubble = source[index];
        const text = this.cleanCaptionCandidateText(bubble && bubble.text ? bubble.text : "");
        if (!bubble || !text) {
          continue;
        }
        if (!bubble.locked) {
          const alignedStart = Math.max(minNextStart, this.getChunkSeekStart(bubble));
          const end = Math.max(alignedStart + 0.25, Number(bubble.end || alignedStart + 0.25));
          records.push(this.createBubbleRecord({
            sourceId: bubble.uid,
            start: alignedStart,
            end: end,
            seekStart: alignedStart,
            locked: false,
            text: text
          }));
          minNextStart = alignedStart + 0.05;
          continue;
        }

        if (!this.liveDisplayBubbleCache || !(this.liveDisplayBubbleCache instanceof Map)) {
          this.liveDisplayBubbleCache = new Map();
        }
        if (bubble.uid && !this.liveDisplayBubbleCache.has(bubble.uid)) {
          this.liveDisplayBubbleCache.set(bubble.uid, this.createLockedDisplayBubbles(bubble));
        }
        const lockedParts = bubble.uid ? this.liveDisplayBubbleCache.get(bubble.uid) : null;
        const sourceParts = Array.isArray(lockedParts) ? lockedParts : this.createLockedDisplayBubbles(bubble);
        for (let partIndex = 0; partIndex < sourceParts.length; partIndex += 1) {
          const part = sourceParts[partIndex];
          const start = Math.max(minNextStart, Number(part.start || 0));
          const end = Math.max(start + 0.25, Number(part.end || start + 0.25));
          records.push({
            ...part,
            start: start,
            end: end,
            seekStart: start,
            ts_start: start,
            ts_stop: end
          });
          minNextStart = start + 0.05;
        }
      }

      return this.withDisplayIds(records);
    }

    createLockedDisplayBubbles(bubble) {
      const records = [];
      const maxLiveBubbleChars = 240;
      const sourceId = bubble && bubble.uid ? bubble.uid : "";
      const text = this.cleanCaptionCandidateText(bubble && bubble.text ? bubble.text : "");
      if (!bubble || !text) {
        return records;
      }

      const start = Number(bubble.start || 0);
      const end = Math.max(start + 0.25, Number(bubble.end || start + 0.25));
      const parts = this.splitTextByNaturalBreaks(text, maxLiveBubbleChars, false);
      if (parts.length <= 1) {
        const alignedStart = this.getChunkSeekStart(bubble);
        records.push(this.createBubbleRecord({
          sourceId: sourceId,
          partIndex: 0,
          start: alignedStart,
          end: Math.max(alignedStart + 0.25, Number(bubble.end || alignedStart + 0.25)),
          seekStart: alignedStart,
          locked: true,
          text: text
        }));
        return records;
      }

      const duration = end - start;
      const totalWords = Math.max(1, text.split(/\s+/).filter(Boolean).length);
      let wordsBefore = 0;
      for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
        const partWords = Math.max(1, parts[partIndex].split(/\s+/).filter(Boolean).length);
        const partStart = start + duration * (wordsBefore / totalWords);
        const partEnd = start + duration * (Math.min(totalWords, wordsBefore + partWords) / totalWords);
        const alignedStart = partStart;
        records.push(this.createBubbleRecord({
          sourceId: sourceId,
          partIndex: partIndex,
          start: alignedStart,
          end: Math.max(alignedStart + 0.25, partEnd),
          seekStart: alignedStart,
          locked: true,
          text: parts[partIndex]
        }));
        wordsBefore += partWords;
      }
      return records;
    }

    rebuildChunks() {
      const rawChunks = this.buildFixedWindowChunksFromCues(this.cues);
      this.allChunks = this.liveCaptureEnabled
        ? this.syncLiveBubblesFromBuckets(rawChunks)
        : this.polishFixedWindowChunks(rawChunks);
      const previousRevealed = Math.max(0, Number(this.revealedChunkCount || 0));
      const initialVisible = Math.min(this.allChunks.length, previousRevealed);
      this.revealedChunkCount = initialVisible;
      this.chunks = this.allChunks.slice(0, this.revealedChunkCount);
      if (this.panel) {
        this.panel.setChunks(this.chunks);
        this.updateFuturePreviewChunks();
      }
      this.activeIndex = -1;
    }

    onSettingsChanged(nextSettings, patch) {
      const wasClosed = Boolean(this.settings.panelClosed);
      this.persistSettings(nextSettings, true);
      const isClosed = Boolean(this.settings.panelClosed);
      const changedPanelClosed =
        patch && Object.prototype.hasOwnProperty.call(patch, "panelClosed") && wasClosed !== isClosed;

      if (changedPanelClosed && isClosed) {
        this.abortTranscriptLoad();
        this.stopLiveCapturePolling();
        this.clearTimelineActionState("panel-closed");
        this.restoreSubtitlesIfExtensionEnabled();
        return;
      }
      if (changedPanelClosed && !isClosed) {
        this.startCaptionWork();
      }
    }

    persistSettings(nextSettings, alreadyNormalized) {
      this.settings = alreadyNormalized
        ? settingsStore.normalizeSettings(nextSettings)
        : settingsStore.normalizeSettings({ ...this.settings, ...nextSettings });
      settingsStore.save(this.settings);
    }

    getKeyboardStepSeconds() {
      return 8;
    }

    textEndsNaturally(text) {
      return captionText.endsNaturally(text);
    }

    splitLongCaptionThought(text, maxChars) {
      return captionText.splitLongThought(text, maxChars);
    }

    splitTextByNaturalBreaks(text, maxChars, allowWordSplit) {
      return captionText.splitByNaturalBreaks(text, maxChars, allowWordSplit);
    }

    polishFixedWindowChunks(chunks) {
      const source = Array.isArray(chunks) ? chunks : [];
      const merged = [];
      const minComfortableChars = 72;
      const maxComfortableChars = 260;

      for (let index = 0; index < source.length; index += 1) {
        const chunk = source[index];
        const text = this.normalizeLiveCaptionText(chunk && chunk.text ? chunk.text : "");
        if (!chunk || !text) {
          continue;
        }

        const previous = merged[merged.length - 1];
        const canMergeWithPrevious =
          previous &&
          text.length < minComfortableChars &&
          !this.textEndsNaturally(previous.text) &&
          this.normalizeLiveCaptionText(previous.text + " " + text).length <= maxComfortableChars;

        if (canMergeWithPrevious) {
          previous.text = this.mergeLiveCaptionText(previous.text, text);
          previous.end = Math.max(Number(previous.end || 0), Number(chunk.end || previous.end || 0));
          continue;
        }

        merged.push({
          ...chunk,
          text: text
        });
      }

      const polished = [];
      for (let index = 0; index < merged.length; index += 1) {
        const chunk = merged[index];
        const parts = this.splitTextByNaturalBreaks(chunk.text, maxComfortableChars);
        if (parts.length <= 1) {
          polished.push(chunk);
          continue;
        }

        const start = Number(chunk.start || 0);
        const duration = Math.max(0.25, Number(chunk.end || start + 0.25) - start);
        for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
          const partStart = start + (duration * partIndex) / parts.length;
          const partEnd = start + (duration * (partIndex + 1)) / parts.length;
          polished.push({
            ...chunk,
            start: partStart,
            end: Math.max(partStart + 0.25, partEnd),
            seekStart: partIndex === 0 ? chunk.seekStart : partStart,
            text: parts[partIndex]
          });
        }
      }

      for (let index = 0; index < polished.length; index += 1) {
        polished[index].id = index;
      }
      return polished;
    }

    getChunkSeekStart(chunk) {
      if (!chunk || typeof chunk !== "object") {
        return 0;
      }
      const seekStart = Number(chunk.seekStart);
      if (Number.isFinite(seekStart) && seekStart >= 0) {
        return seekStart;
      }
      return Math.max(0, Number(chunk.start || 0));
    }

    getCurrentVideoElement() {
      const direct = document.querySelector("video.html5-main-video");
      if (direct instanceof HTMLVideoElement) {
        return direct;
      }
      const fallback = document.querySelector("video");
      return fallback instanceof HTMLVideoElement ? fallback : null;
    }

    refreshVideoReference() {
      const liveVideo = this.getCurrentVideoElement();
      if (liveVideo instanceof HTMLVideoElement) {
        if (liveVideo !== this.video) {
          this.video = liveVideo;
          this.bindVideoSync();
        }
      }
      return this.video;
    }

    isChunkIndexAlignedWithTime(chunks, index, time) {
      if (!Array.isArray(chunks) || index < 0 || index >= chunks.length) {
        return false;
      }
      const now = Number(time);
      if (!Number.isFinite(now)) {
        return false;
      }
      const chunk = chunks[index];
      const chunkStart = Math.max(0, Number(chunk && chunk.start ? chunk.start : 0));
      const chunkEnd = Math.max(chunkStart + 0.25, Number(chunk && chunk.end ? chunk.end : chunkStart + 0.25));
      const nextStart =
        index < chunks.length - 1
          ? Math.max(chunkStart + 0.001, Number(chunks[index + 1] && chunks[index + 1].start ? chunks[index + 1].start : chunkEnd))
          : Number.POSITIVE_INFINITY;
      const effectiveEnd = Math.max(chunkEnd, nextStart === Number.POSITIVE_INFINITY ? chunkEnd : nextStart);
      const leadTolerance = 0.45;
      const trailTolerance = Math.max(1.2, this.getKeyboardStepSeconds() * 0.55);
      return now >= chunkStart - leadTolerance && now <= effectiveEnd + trailTolerance;
    }

    handleSpaceShortcut(isBackward) {
      const video = this.refreshVideoReference();
      if (!video) {
        return;
      }

      const stepSeconds = this.getKeyboardStepSeconds();
      const now = Number(video.currentTime || 0);
      const duration = Number(video.duration);
      const upperBound = Number.isFinite(duration) ? Math.max(0, duration) : Number.POSITIVE_INFINITY;
      const sourceChunks = Array.isArray(this.allChunks) ? this.allChunks : [];
      const currentIndex =
        sourceChunks.length > 0 ? chunker.findChunkIndexAtTime(sourceChunks, now) : -1;
      const canUseChunkNavigation =
        sourceChunks.length > 0 && this.isChunkIndexAlignedWithTime(sourceChunks, currentIndex, now);
      const rawTarget = isBackward
        ? Math.max(0, now - stepSeconds)
        : now + stepSeconds;
      let target = rawTarget;
      let flashIndex = -1;
      let flashAt = Number.NaN;

      if (isBackward && canUseChunkNavigation) {
        const rewindIndex = chunker.findChunkIndexAtTime(sourceChunks, rawTarget);
        if (rewindIndex >= 0) {
          const anchoredStart = this.getChunkSeekStart(sourceChunks[rewindIndex]);
          if (Number.isFinite(anchoredStart) && anchoredStart <= now - 0.2) {
            target = anchoredStart;
            flashIndex = rewindIndex;
            flashAt = anchoredStart;
          }
        }
      }

      target = Math.max(0, Math.min(upperBound, target));
      if (flashIndex >= 0) {
        const action = this.beginTimelineAction({
          source: "rewind",
          targetTime: target,
          index: flashIndex,
          seekStart: flashAt,
          forceGlowReset: true,
          forceScroll: true
        });
        this.applyTimelineActionFocus(action);
      } else {
        this.beginTimelineAction({
          source: isBackward ? "rewind" : "forward",
          targetTime: target,
          index: -1,
          forceGlowReset: true,
          forceScroll: true
        });
      }
      const wasPaused = video.paused;
      video.currentTime = target;
      this.commitTimelineSync(true);
      this.requestTimelineSync(true);
      window.setTimeout(() => this.commitTimelineSync(true), 80);
      window.setTimeout(() => this.enforcePlaybackState(wasPaused), 0);
      window.setTimeout(() => this.enforcePlaybackState(wasPaused), 80);
    }

    markBubbleFlashOnStart(index, seekStart, source) {
      if (!Array.isArray(this.allChunks) || index < 0 || index >= this.allChunks.length) {
        return;
      }
      bubbleState.markFlashOnStart(this.allChunks[index], seekStart, source);
    }

    enforcePlaybackState(wasPaused) {
      const video = this.refreshVideoReference();
      if (!video) {
        return;
      }
      if (wasPaused) {
        if (!video.paused) {
          video.pause();
        }
        return;
      }
      if (video.paused) {
        const playResult = video.play();
        if (playResult && typeof playResult.catch === "function") {
          playResult.catch(() => {});
        }
      }
    }

    seekToChunk(index, options) {
      const video = this.refreshVideoReference();
      if (!video || !this.panel) {
        return;
      }
      if (index && typeof index === "object" && index.future) {
        this.seekToPreviewChunk(index, options);
        return;
      }
      if (index < 0 || index >= this.allChunks.length) {
        return;
      }
      const opts = options && typeof options === "object" ? options : {};
      this.ensureChunkVisible(index);
      const chunk = this.allChunks[index];
      const seekLeadSeconds = Number.isFinite(opts.seekLeadSeconds) ? Math.max(0, Number(opts.seekLeadSeconds)) : 0.45;
      // Click-to-seek should be atomic and repeatable. Re-running fuzzy text
      // matching here can snap to repeated words in a neighboring bubble.
      const seekStart = this.getChunkSeekStart(chunk);
      let targetTime = Math.max(0, seekStart - seekLeadSeconds);
      if (Number.isFinite(opts.minTargetTime)) {
        targetTime = Math.max(targetTime, Number(opts.minTargetTime));
      }
      const wasPaused = video.paused;
      const action = this.beginTimelineAction({
        source: "click",
        targetTime: targetTime,
        index: index,
        seekStart: seekStart,
        forceGlowReset: true,
        forceScroll: opts.ensureVisible !== false
      });
      this.applyTimelineActionFocus(action);
      video.currentTime = targetTime;
      const autoplay = opts.autoplay !== false;
      if (autoplay) {
        const playResult = video.play();
        if (playResult && typeof playResult.catch === "function") {
          playResult.catch(() => {});
        }
      } else if (opts.preservePlayback) {
        window.setTimeout(() => this.enforcePlaybackState(wasPaused), 0);
        window.setTimeout(() => this.enforcePlaybackState(wasPaused), 80);
      }
      this.commitTimelineSync(opts.ensureVisible !== false);
      this.requestTimelineSync(opts.ensureVisible !== false);
    }

    seekToPreviewChunk(target, options) {
      const video = this.refreshVideoReference();
      if (!video || !this.panel || !target || typeof target !== "object") {
        return;
      }
      const opts = options && typeof options === "object" ? options : {};
      const seekStart = Number(target.seekStart);
      const start = Number(target.start);
      const end = Number(target.end);
      const baseTime = Number.isFinite(seekStart)
        ? seekStart
        : Number.isFinite(start)
          ? start
          : Number.NaN;
      if (!Number.isFinite(baseTime)) {
        return;
      }
      const seekLeadSeconds = Number.isFinite(opts.seekLeadSeconds) ? Math.max(0, Number(opts.seekLeadSeconds)) : 0.45;
      const targetTime = Math.max(0, baseTime - seekLeadSeconds);
      const wasPaused = video.paused;
      this.beginTimelineAction({
        source: "future-preview-click",
        targetTime: targetTime,
        index: -1,
        seekStart: baseTime,
        forceGlowReset: true,
        forceScroll: true
      });
      this.pendingSeekFocus = null;
      this.activeIndex = -1;
      if (this.panel) {
        this.panel.setActiveIndex(-1);
        this.panel.setPlaybackTime(targetTime, { forceGlowReset: true });
      }
      video.currentTime = targetTime;
      const autoplay = opts.autoplay !== false;
      if (autoplay) {
        const playResult = video.play();
        if (playResult && typeof playResult.catch === "function") {
          playResult.catch(() => {});
        }
      } else if (opts.preservePlayback) {
        window.setTimeout(() => this.enforcePlaybackState(wasPaused), 0);
        window.setTimeout(() => this.enforcePlaybackState(wasPaused), 80);
      }
      if (Number.isFinite(end)) {
        window.setTimeout(() => this.commitTimelineSync(true), 80);
      } else {
        this.requestTimelineSync(true);
      }
    }
  }

  class DialogueCaptionsController {
    constructor() {
      this.activeVideoId = null;
      this.app = null;
      this.cleanupFns = [];
      this.loadNonce = 0;
      this.destroyed = false;
    }

    start() {
      const onRouteEvent = () => {
        this.reconcileRoute();
      };
      const onVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          this.reconcileRoute();
        }
      };

      window.addEventListener("yt-navigate-finish", onRouteEvent);
      document.addEventListener("yt-page-data-updated", onRouteEvent);
      window.addEventListener("popstate", onRouteEvent);
      window.addEventListener("hashchange", onRouteEvent);
      window.addEventListener("pageshow", onRouteEvent);
      document.addEventListener("visibilitychange", onVisibilityChange);

      this.cleanupFns.push(() => window.removeEventListener("yt-navigate-finish", onRouteEvent));
      this.cleanupFns.push(() => document.removeEventListener("yt-page-data-updated", onRouteEvent));
      this.cleanupFns.push(() => window.removeEventListener("popstate", onRouteEvent));
      this.cleanupFns.push(() => window.removeEventListener("hashchange", onRouteEvent));
      this.cleanupFns.push(() => window.removeEventListener("pageshow", onRouteEvent));
      this.cleanupFns.push(() => document.removeEventListener("visibilitychange", onVisibilityChange));

      const intervalId = window.setInterval(onRouteEvent, 3000);
      this.cleanupFns.push(() => window.clearInterval(intervalId));

      this.reconcileRoute();
    }

    destroy() {
      this.destroyed = true;
      this.loadNonce += 1;
      for (const cleanup of this.cleanupFns) {
        cleanup();
      }
      this.cleanupFns.length = 0;
      this.teardownApp();
      this.activeVideoId = null;
    }

    async reconcileRoute() {
      if (this.destroyed) {
        return;
      }

      const url = window.location.href;
      if (!transcript.isWatchPage(url)) {
        this.activeVideoId = null;
        this.teardownApp();
        return;
      }

      const videoId = transcript.getVideoId(url);
      if (!videoId) {
        this.activeVideoId = null;
        this.teardownApp();
        return;
      }

      if (videoId === this.activeVideoId && this.app) {
        return;
      }

      this.activeVideoId = videoId;
      this.loadNonce += 1;
      const currentNonce = this.loadNonce;

      this.teardownApp();
      const runningApp = new DialogueCaptionsApp(videoId);
      this.app = runningApp;

      try {
        await runningApp.init();
      } catch (error) {
        if (error && error.name === "AbortError") {
          return;
        }
        console.warn("[Dialogue Captions] Failed to initialize.", error);
      }

      if (currentNonce !== this.loadNonce) {
        runningApp.destroy();
      }
    }

    teardownApp() {
      if (this.app) {
        this.app.destroy();
        this.app = null;
      }
    }
  }

  const existing = scope[GLOBAL_CONTROLLER_KEY];
  if (existing && typeof existing.destroy === "function") {
    existing.destroy();
  }

  const controller = new DialogueCaptionsController();
  scope[GLOBAL_CONTROLLER_KEY] = controller;
  controller.start();
})(window);
