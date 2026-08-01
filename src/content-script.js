(function initContentScript(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});
  const transcript = app.transcript;
  const chunker = app.chunker;
  const settingsStore = app.settingsStore;
  const bubbleState = app.bubbleState;
  const captionText = app.captionText;
  const CaptionSessionManager = app.CaptionSessionManager;
  const CaptionAcquisition = app.CaptionAcquisition;
  const NativeCaptionController = app.NativeCaptionController;
  const platform = app.platform;
  const pageContext = app.pageContext;
  const diagnostics = app.diagnostics || { record() {} };
  const captionTimeline = app.captionTimeline;
  const DialoguePanel = app.DialoguePanel;

  if (
    !transcript ||
    !captionTimeline ||
    !chunker ||
    !settingsStore ||
    !bubbleState ||
    !captionText ||
    !CaptionSessionManager ||
    !CaptionAcquisition ||
    !NativeCaptionController ||
    !platform ||
    !DialoguePanel
  ) {
    console.warn("[Dialogue Captions] Missing required modules.");
    return;
  }

  const GLOBAL_CONTROLLER_KEY = "__dialogueCaptionsController";
  const TRANSCRIPT_HEARTBEAT_GRACE_MS = 6500;
  const TRANSCRIPT_HEARTBEAT_RECHECK_MS = 8200;
  const TRANSCRIPT_HEARTBEAT_VIDEO_WAIT_MS = 2400;
  const MAX_TRANSCRIPT_RECOVERY_ATTEMPTS = 3;
  const MAX_TRANSCRIPT_HEARTBEAT_READINESS_DEFERRALS = 20;
  const MAX_LIVE_BUBBLE_ENTITIES = 2400;
  const LIVE_CAPTURE_POLL_INTERVAL_MS = 200;

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
      this.loadAbortSessionId = 0;
      this.destroyed = false;
      this.captionSessions = new CaptionSessionManager();
      this.captionSessionId = 0;
      this.captionAcquisition = new CaptionAcquisition(this, {
        captionTimeline: captionTimeline,
        diagnostics: diagnostics,
        timers: scope
      });
      this.nativeCaptions = new NativeCaptionController(this, {
        pageContext: pageContext
      });
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
      this.liveCaptureStartedAt = 0;
      this.lastCaptionProbeAt = 0;
      this.captionWorkStarted = false;
      this.lastCaptionPreferenceKey = "";
      this.openCaptionPreferenceKey = "";
      this.transcriptMode = "initializing";
      this.transcriptLoadAttempts = 0;
      this.transcriptLoadInFlight = false;
      this.transcriptLoadNonce = 0;
      this.transcriptUpgradeAttempts = 0;
      this.transcriptUpgradeInFlight = false;
      this.lastTranscriptUpgradeAt = 0;
      this.transcriptLastActivityAt = 0;
      this.transcriptHeartbeatTimerId = 0;
      this.transcriptRecoveryAttempts = 0;
      this.transcriptReadinessDeferrals = 0;
      this.pendingSeekFocus = null;
      this.liveCaptureSuppressedUntil = 0;
      this.liveBubbles = [];
      this.liveBucketToBubble = new Map();
      this.liveDisplayBubbleCache = new Map();
      this.liveNextBubbleUid = 1;
      this.liveFuturePreviewChunks = [];
      this.transcriptPreviewChunks = [];
      this.futurePreviewSignature = "";
    }

    async init() {
      this.settings = await settingsStore.load();
      diagnostics.record("app:init", { panelClosed: Boolean(this.settings.panelClosed) });
      if (this.destroyed) {
        return;
      }
      this.panel = new DialoguePanel({
        settings: this.settings,
        onSeek: (target, options) => this.seekToChunk(target, options),
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

      this.bindVideoSync();
      if (!this.settings.panelClosed) {
        await this.startCaptionWork();
      }
    }

    destroy() {
      this.destroyed = true;
      diagnostics.record("app:destroy", { liveCaptureEnabled: Boolean(this.liveCaptureEnabled) });
      this.invalidateCaptionSession("destroy");
      this.persistPanelSnapshot();
      this.abortTranscriptLoad();

      if (this.syncRafId) {
        platform.cancelFrame(this.syncRafId);
        this.syncRafId = 0;
      }
      this.stopTranscriptHeartbeat();

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
      if (!this.isCurrentVideoPage()) {
        return false;
      }
      pageContext.ensureBridgeInjected();
      return true;
    }

    beginCaptionSession(reason) {
      this.stopTranscriptHeartbeat();
      this.resetCaptionEnsureState();
      this.captionSessionId = this.captionSessions.begin(reason || "caption-work");
      return this.captionSessionId;
    }

    getActiveCaptionSessionId() {
      return this.captionSessions.getCurrentId();
    }

    isActiveCaptionSession(sessionId) {
      return (
        this.captionSessions.isActive(sessionId) &&
        !this.destroyed &&
        !this.settings.panelClosed &&
        this.isCurrentVideoPage()
      );
    }

    invalidateCaptionSession(reason) {
      this.captionSessions.invalidate(reason || "invalidate");
      this.captionSessionId = this.captionSessions.getCurrentId();
    }

    isCurrentVideoPage() {
      return transcript.isWatchPage(window.location.href) && transcript.getVideoId(window.location.href) === this.videoId;
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
        const responseVideoId =
          response &&
          response.videoDetails &&
          typeof response.videoDetails.videoId === "string"
            ? response.videoDetails.videoId
            : "";
        if (responseVideoId && responseVideoId !== this.videoId) {
          return 0;
        }
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
        return Array.isArray(tracklist) ? tracklist.filter((track) => this.isTrackForCurrentVideo(track)).length : 0;
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
      const onSeeking = () => {
        this.handleDiscontinuousTimeMove("seeking");
        this.scheduleSync();
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
      boundVideo.addEventListener("seeking", onSeeking);
      boundVideo.addEventListener("seeked", onSeeked);
      boundVideo.addEventListener("loadedmetadata", onLoadedMetadata);

      this.videoCleanupFns.push(() => boundVideo.removeEventListener("timeupdate", onTimeUpdate));
      this.videoCleanupFns.push(() => boundVideo.removeEventListener("seeking", onSeeking));
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
      return captionText.cleanCandidate(input, { caseFixEnabled: false });
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
      return captionText.dedupeCandidates(candidates, { caseFixEnabled: false });
    }

    mergeLiveCaptionText(previousText, nextText) {
      return captionText.mergeText(previousText, nextText);
    }

    normalizeCaptionToken(token) {
      return captionText.normalizeToken(token);
    }

    normalizeCaptionTokens(tokens) {
      const source = Array.isArray(tokens) ? tokens : [];
      return source
        .map((token) => ({
          text: String(token && token.text ? token.text : "").trim(),
          start: Number(token && token.start),
          end: Number(token && token.end)
        }))
        .filter((token) => token.text && Number.isFinite(token.start) && Number.isFinite(token.end) && token.end > token.start)
        .sort((left, right) => left.start - right.start);
    }

    trimLiveChunkAgainstPrevious(previousText, chunk) {
      return bubbleState.trimChunkAgainstPrevious(previousText, chunk, {
        normalizeText: (value) => this.normalizeLiveCaptionText(value),
        normalizeToken: (value) => this.normalizeCaptionToken(value),
        fallbackDurationSeconds: this.getLiveWindowSizeSeconds()
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

    isSubtitleButtonAvailable() {
      const subtitleButton = document.querySelector(".ytp-subtitles-button");
      if (!(subtitleButton instanceof HTMLElement)) {
        return false;
      }
      const disabled = String(subtitleButton.getAttribute("aria-disabled") || "").toLowerCase() === "true";
      return !disabled && !subtitleButton.disabled && this.isNodeVisible(subtitleButton);
    }

    hasLiveCaptionContext() {
      if (this.getInlineCaptionTrackCount() > 0 || this.getPlayerCaptionTrackCount() > 0) {
        return true;
      }
      if (this.isSubtitleButtonAvailable()) {
        return true;
      }
      return Boolean(this.video && this.video.textTracks && this.video.textTracks.length);
    }

    getPreferredLanguageCodes() {
      const rawLanguages = [];
      const selectedCaptionTrack = this.getSelectedCaptionTrack();
      const selectedLanguage = this.getTrackLanguageCode(selectedCaptionTrack);
      if (selectedLanguage) {
        rawLanguages.push(selectedLanguage);
      }
      if (Array.isArray(navigator.languages)) {
        rawLanguages.push(...navigator.languages);
      }
      rawLanguages.push(navigator.language, navigator.userLanguage, "en");

      const languages = [];
      const used = new Set();
      for (const rawLanguage of rawLanguages) {
        const language = String(rawLanguage || "").trim().toLowerCase();
        if (!language || used.has(language)) {
          continue;
        }
        used.add(language);
        languages.push(language);
        const baseLanguage = language.split("-")[0];
        if (baseLanguage && !used.has(baseLanguage)) {
          used.add(baseLanguage);
          languages.push(baseLanguage);
        }
      }
      return languages;
    }

    getSelectedCaptionTrack() {
      try {
        const player = document.getElementById("movie_player");
        if (!player || typeof player.getOption !== "function") {
          return null;
        }
        const track = player.getOption("captions", "track");
        return track && typeof track === "object" && this.isTrackForCurrentVideo(track) ? track : null;
      } catch {
        return null;
      }
    }

    getTrackVideoId(track) {
      if (!track || typeof track.baseUrl !== "string" || !track.baseUrl) {
        return "";
      }
      try {
        return transcript.getVideoId(track.baseUrl);
      } catch {
        return "";
      }
    }

    isTrackForCurrentVideo(track) {
      const trackVideoId = this.getTrackVideoId(track);
      return !trackVideoId || trackVideoId === this.videoId;
    }

    getTrackLanguageCode(track) {
      if (track && typeof track.baseUrl === "string" && track.baseUrl) {
        try {
          const translatedLanguage = new URL(track.baseUrl).searchParams.get("tlang");
          if (translatedLanguage) {
            return translatedLanguage.toLowerCase();
          }
        } catch {
          // Ignore malformed track URLs and fall back to metadata.
        }
      }
      const vssId = track && typeof track.vssId === "string" ? track.vssId.toLowerCase() : "";
      if (vssId) {
        const normalizedVssId = vssId.replace(/^a?\./, "");
        if (normalizedVssId) {
          return normalizedVssId;
        }
      }
      const languageCode =
        track && typeof track.languageCode === "string"
          ? track.languageCode
          : track && typeof track.langCode === "string"
            ? track.langCode
            : track && typeof track.language === "string"
              ? track.language
              : "";
      if (languageCode) {
        return languageCode.toLowerCase();
      }
      if (track && typeof track.baseUrl === "string" && track.baseUrl) {
        try {
          return (new URL(track.baseUrl).searchParams.get("lang") || "").toLowerCase();
        } catch {
          return "";
        }
      }
      return "";
    }

    languageMatchesPreference(languageCode, preference) {
      const language = String(languageCode || "").toLowerCase();
      const preferred = String(preference || "").toLowerCase();
      if (!language || !preferred) {
        return false;
      }
      return language === preferred || language.startsWith(preferred + "-") || preferred.startsWith(language + "-");
    }

    isPreferredLanguageTrack(track, preference) {
      return this.languageMatchesPreference(this.getTrackLanguageCode(track), preference);
    }

    isManualCaptionTrack(track) {
      return String(track && track.kind ? track.kind : "").toLowerCase() !== "asr";
    }

    isTranslatedCaptionTrack(track) {
      if (!track || typeof track.baseUrl !== "string" || !track.baseUrl) {
        return false;
      }
      try {
        return new URL(track.baseUrl).searchParams.has("tlang");
      } catch {
        return false;
      }
    }

    getPreferredCaptionTracks(tracklist) {
      const tracks = Array.isArray(tracklist) ? tracklist.filter((track) => this.isTrackForCurrentVideo(track)) : [];
      const ordered = [];
      const used = new Set();

      const pushWhere = (predicate) => {
        for (const track of tracks) {
          if (!track || used.has(track)) {
            continue;
          }
          if (!predicate(track)) {
            continue;
          }
          used.add(track);
          ordered.push(track);
        }
      };

      for (const preference of this.getPreferredLanguageCodes()) {
        pushWhere((track) => this.isPreferredLanguageTrack(track, preference) && this.isManualCaptionTrack(track));
        pushWhere((track) => this.isPreferredLanguageTrack(track, preference));
      }
      pushWhere((track) => this.isManualCaptionTrack(track) && !this.isTranslatedCaptionTrack(track));
      pushWhere((track) => !this.isTranslatedCaptionTrack(track));
      pushWhere(() => true);

      return ordered;
    }

    readTextTrackSnapshotAtCurrentTime() {
      if (!this.video || !this.video.textTracks || !this.video.textTracks.length) {
        return null;
      }
      const now = Number(this.video.currentTime || 0);
      if (!Number.isFinite(now)) {
        return null;
      }
      const tracks = this.getPreferredCaptionTracks(Array.from(this.video.textTracks));

      for (let index = 0; index < tracks.length; index += 1) {
        const track = tracks[index];
        const fragments = [];
        let earliestStart = Number.POSITIVE_INFINITY;
        let latestEnd = 0;
        let tokens = [];
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
            latestEnd = Math.max(latestEnd, end);
            tokens = tokens.concat(this.createCueTokensFromText(text, start, end));
          }
        }
        const merged = this.normalizeLiveCaptionText(fragments.join(" "));
        if (!merged) {
          continue;
        }
        return {
          text: merged,
          startTime: Number.isFinite(earliestStart) ? earliestStart : Number.NaN,
          endTime: Number.isFinite(latestEnd) && latestEnd > 0 ? latestEnd : Number.NaN,
          tokens: tokens
        };
      }
      return null;
    }

    createCueTokensFromText(text, start, end) {
      const words = String(text || "").split(/\s+/).filter(Boolean);
      const cueStart = Number(start);
      const cueEnd = Number(end);
      if (!words.length || !Number.isFinite(cueStart) || !Number.isFinite(cueEnd) || cueEnd <= cueStart) {
        return [];
      }
      const duration = Math.max(0.25, cueEnd - cueStart);
      const each = duration / words.length;
      return words.map((word, index) => ({
        text: word,
        start: cueStart + each * index,
        end: index === words.length - 1 ? cueEnd : cueStart + each * (index + 1)
      }));
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
      const tracks = this.getPreferredCaptionTracks(Array.from(this.video.textTracks));

      for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
        const track = tracks[trackIndex];
        const collected = [];
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
            end: end,
            text: text,
            tokens: this.createCueTokensFromText(text, start, end)
          });
        }

        if (!collected.length) {
          continue;
        }

        collected.sort((left, right) => left.start - right.start);
        let merged = "";
        let latestEnd = 0;
        let tokens = [];
        for (let index = 0; index < collected.length; index += 1) {
          merged = this.mergeLiveCaptionText(merged, collected[index].text);
          latestEnd = Math.max(latestEnd, Number(collected[index].end || 0));
          tokens = tokens.concat(collected[index].tokens || []);
        }
        const normalized = this.normalizeLiveCaptionText(merged);
        if (!normalized) {
          continue;
        }

        return {
          text: normalized,
          startTime: Number.isFinite(collected[0].start) ? collected[0].start : bucketStart,
          endTime: Number.isFinite(latestEnd) && latestEnd > 0 ? latestEnd : bucketEnd,
          tokens: tokens
        };
      }

      return null;
    }

    getLiveWindowSeconds() {
      return this.getLiveWindowSizeSeconds();
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
        minTime: Math.max(0, Math.min(action.targetTime, seekStart - 0.55)),
        maxTime: Math.max(seekStart + 0.25, Number(chunk.end || seekStart + 0.25)),
        expiresAt: Date.now() + 2600
      };
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
      const explicitEnd = Number(opts.endTime);
      const bucketEnd = Number.isFinite(explicitEnd) && explicitEnd > sampleTime
        ? explicitEnd
        : this.getLiveWindowEnd(bucketStart);
      const sampleAnchor = Number.isFinite(sampleTime) ? Math.max(0, Number(sampleTime)) : bucketStart;
      const tokens = Array.isArray(opts.tokens) ? opts.tokens : this.createCueTokensFromText(normalized, sampleAnchor, bucketEnd);
      const bucketStartMs = Math.round(bucketStart * 1000);
      const existingIndex = this.cues.findIndex(
        (cue) => Math.round(Math.max(0, Number(cue.start || 0)) * 1000) === bucketStartMs
      );

      if (existingIndex >= 0) {
        const existingCue = this.cues[existingIndex];
        const existingRaw = this.cleanCaptionCandidateText(existingCue.rawText || existingCue.text);
        const rawMerged = this.mergeLiveCaptionText(existingRaw, normalized);
        if (rawMerged === existingRaw) {
          return false;
        }
        this.cues[existingIndex] = {
          start: bucketStart,
          end: Math.max(bucketEnd, Number(existingCue.end || bucketEnd)),
          anchorStart: Number.isFinite(existingCue.anchorStart)
            ? Math.min(Number(existingCue.anchorStart), sampleAnchor)
            : sampleAnchor,
          text: rawMerged,
          rawText: rawMerged,
          tokens: this.mergeCueTokens(existingCue.tokens, tokens)
        };
        return true;
      }

      this.cues.push({
        start: bucketStart,
        end: bucketEnd,
        anchorStart: sampleAnchor,
        text: normalized,
        rawText: normalized,
        tokens: tokens
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
        const sampleTime = Number.isFinite(snapshot.startTime)
          ? Math.max(0, Number(snapshot.startTime))
          : bucketIndex * this.getLiveWindowSeconds();
        if (this.upsertLiveBucketCue(snapshot.text, sampleTime, {
          force: true,
          endTime: snapshot.endTime,
          tokens: snapshot.tokens
        })) {
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
        const bucketStart = bucketIndex * this.getLiveWindowSeconds();
        const seekStart = Number.isFinite(snapshot.startTime) ? Math.max(0, Number(snapshot.startTime)) : bucketStart;
        const end = Number.isFinite(snapshot.endTime) ? Math.max(seekStart + 0.25, Number(snapshot.endTime)) : this.getLiveWindowEnd(bucketStart);
        previews.push(this.createBubbleRecord({
          sourceId: "future-" + bucketIndex,
          start: seekStart,
          end: end,
          seekStart: seekStart,
          locked: true,
          text: snapshot.text,
          tokens: snapshot.tokens
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
      if (
        !this.liveCaptureEnabled ||
        !this.video ||
        this.settings.panelClosed ||
        !this.isCurrentVideoPage() ||
        this.hasOpenCaptionPreferenceChanged()
      ) {
        return;
      }

      const overlaySuppressed = Date.now() < Number(this.liveCaptureSuppressedUntil || 0);
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
      let endTime = Number.NaN;
      let timingTokens = [];
      let usedOverlayOnlyPath = false;

      if (windowSnapshot && windowSnapshot.text) {
        this.liveOverlayUtterance = null;
        text = windowSnapshot.text;
        if (Number.isFinite(windowSnapshot.startTime)) {
          anchorTime = Math.max(0, Number(windowSnapshot.startTime));
        }
        endTime = Number(windowSnapshot.endTime);
        timingTokens = this.normalizeCaptionTokens(windowSnapshot.tokens);
        if (activeSnapshot && activeSnapshot.text) {
          text = this.mergeLiveCaptionText(text, activeSnapshot.text);
          endTime = Number.isFinite(activeSnapshot.endTime)
            ? Math.max(Number(endTime || 0), Number(activeSnapshot.endTime))
            : endTime;
          timingTokens = this.mergeCueTokens(timingTokens, activeSnapshot.tokens);
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
        endTime = Number(activeSnapshot.endTime);
        timingTokens = this.normalizeCaptionTokens(activeSnapshot.tokens);
        this.updateLiveOverlayAnchorOffset(now, activeSnapshot.startTime);
        if (!overlaySuppressed) {
          const overlayText = this.readVisibleCaptionText();
          if (overlayText) {
            text = this.mergeLiveCaptionText(text, overlayText);
          }
        }
      } else {
        if (!overlaySuppressed) {
          usedOverlayOnlyPath = true;
          text = this.readVisibleCaptionText();
          if (text && !this.hasLiveCaptionContext()) {
            diagnostics.record("captions:overlay-only-ignored", { reason: "missing_caption_context" });
            text = "";
          }
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

      const changed = this.upsertLiveBucketCue(normalized, anchorTime, {
        endTime: endTime,
        tokens: timingTokens
      });
      if (changed || backfilled) {
        this.rebuildChunks();
        this.noteTranscriptActivity("live-capture");
        this.syncActiveChunk(true);
        if (this.panel && this.cues.length === 1) {
          this.panel.setStatus("Live subtitle capture started.", true);
        }
      } else if (futureChanged) {
        this.updateFuturePreviewChunks();
      }
    }

    pickPreferredTrack(tracklist) {
      return this.getPreferredCaptionTracks(tracklist)[0] || null;
    }

    probeCaptionsNow() {
      const now = Date.now();
      this.lastCaptionProbeAt = now;
      this.captureInitialSubtitleState();

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
        if (typeof player.isSubtitlesOn === "function" && typeof player.toggleSubtitles === "function") {
          if (!player.isSubtitlesOn()) {
            player.toggleSubtitles();
            this.nativeCaptions.markEnabledByExtensionIfInitiallyOff();
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

    captureInitialSubtitleState() {
      this.nativeCaptions.captureInitialState();
    }

    resetCaptionEnsureState() {
      this.nativeCaptions.resetEnsureState();
    }

    restoreSubtitlesIfExtensionEnabled() {
      this.nativeCaptions.restoreIfExtensionEnabled();
    }

    ensureCaptionsEnabledOnce() {
      this.nativeCaptions.ensureOnce();
    }

    startCaptionEnsureLoop(sessionId) {
      const captionSessionId = Number(sessionId || this.getActiveCaptionSessionId());
      if (this.nativeCaptions.isEnsureStarted()) {
        return;
      }
      this.nativeCaptions.markEnsureStarted();
      const delaysMs = [0, 350, 800, 1500, 2600, 4200, 6200];
      for (let index = 0; index < delaysMs.length; index += 1) {
        const timerId = window.setTimeout(() => {
          if (!this.isActiveCaptionSession(captionSessionId) || this.nativeCaptions.isEnsured()) {
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

    async refreshCaptionSnapshot() {
      this.ensurePageBridgeForWatchPage();
      if (!pageContext || typeof pageContext.requestSnapshot !== "function") {
        return null;
      }
      try {
        return await pageContext.requestSnapshot(650);
      } catch {
        return null;
      }
    }

    getCaptionPreferenceKeyFromSnapshot(snapshot) {
      const selectedTrack = snapshot && snapshot.selectedCaptionTrack ? snapshot.selectedCaptionTrack : null;
      const selectedLanguage = this.getTrackLanguageCode(selectedTrack);
      if (selectedLanguage) {
        return "selected:" + selectedLanguage;
      }
      const preferredLanguages = this.getPreferredLanguageCodes();
      return preferredLanguages[0] ? "preferred:" + preferredLanguages[0] : "";
    }

    getCurrentCaptionPreferenceKey() {
      return this.getCaptionPreferenceKeyFromSnapshot(
        pageContext && typeof pageContext.getSnapshot === "function" ? pageContext.getSnapshot() : null
      );
    }

    hasOpenCaptionPreferenceChanged() {
      const currentPreferenceKey = this.getCurrentCaptionPreferenceKey();
      return Boolean(
        this.openCaptionPreferenceKey &&
          currentPreferenceKey &&
          currentPreferenceKey !== this.openCaptionPreferenceKey
      );
    }

    async startCaptionWork() {
      if (this.destroyed || this.settings.panelClosed) {
        return;
      }
      if (this.captionWorkStarted) {
        const snapshot = await this.refreshCaptionSnapshot();
        const nextPreferenceKey = this.getCaptionPreferenceKeyFromSnapshot(snapshot);
        const shouldReloadForPreference =
          !this.hasTranscriptActivity() ||
          !this.lastCaptionPreferenceKey ||
          (nextPreferenceKey && nextPreferenceKey !== this.lastCaptionPreferenceKey);
        if (shouldReloadForPreference) {
          const captionSessionId = this.beginCaptionSession("caption-work-reload");
          this.clearCaptionStateForUnavailableVideo();
          this.transcriptLastActivityAt = 0;
          this.openCaptionPreferenceKey = nextPreferenceKey;
          this.ensureCaptionsEnabledOnce();
          this.startCaptionEnsureLoop(captionSessionId);
          if (!this.liveCaptureEnabled) {
            this.enableLiveCaptureMode();
          } else {
            this.startLiveCapturePolling();
          }
          this.syncActiveChunk(true);
          if (this.panel) {
            this.panel.setStatus("Loading subtitles...");
          }
          await this.loadTranscript(captionSessionId);
          this.syncActiveChunk(true);
          if (!this.hasTranscriptActivity()) {
            this.scheduleTranscriptHeartbeatCheck("caption-work-resume", TRANSCRIPT_HEARTBEAT_GRACE_MS, captionSessionId);
          }
          return;
        } else {
          const captionSessionId = this.beginCaptionSession("caption-work-reuse");
          this.openCaptionPreferenceKey = nextPreferenceKey || this.lastCaptionPreferenceKey;
          if (this.liveCaptureEnabled) {
            this.ensureCaptionsEnabledOnce();
            this.startCaptionEnsureLoop(captionSessionId);
            this.startLiveCapturePolling();
          }
          this.syncActiveChunk(true);
          return;
        }
      }

      const captionSessionId = this.beginCaptionSession("caption-work-start");
      this.captionWorkStarted = true;
      this.transcriptLastActivityAt = 0;
      this.transcriptRecoveryAttempts = 0;
      this.transcriptReadinessDeferrals = 0;
      const snapshot = await this.refreshCaptionSnapshot();
      this.openCaptionPreferenceKey = this.getCaptionPreferenceKeyFromSnapshot(snapshot);
      if (this.panel) {
        this.panel.setStatus("Loading subtitles...");
      }
      this.scheduleTranscriptHeartbeatCheck("caption-work-start", TRANSCRIPT_HEARTBEAT_GRACE_MS, captionSessionId);
      this.startCaptionEnsureLoop(captionSessionId);
      this.enableLiveCaptureMode();
      await this.loadTranscript(captionSessionId);
      this.syncActiveChunk(true);
    }

    enableLiveCaptureMode() {
      if (this.liveCaptureEnabled) {
        this.startLiveCapturePolling();
        return;
      }
      this.transcriptMode = "live overlay fallback mode";
      this.liveCaptureEnabled = true;
      this.liveCaptureStartedAt = Date.now();
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
      this.futurePreviewSignature = "";
      if (!Array.isArray(this.transcriptPreviewChunks)) {
        this.transcriptPreviewChunks = [];
      }
      this.liveBubbles = [];
      this.liveBucketToBubble = new Map();
      this.liveDisplayBubbleCache = new Map();
      this.liveNextBubbleUid = 1;
      this.lastCaptionProbeAt = 0;
      this.rebuildChunks();
      this.probeCaptionsNow();
      this.captureLiveCaptionLine();
      diagnostics.record("captions:live-fallback", {});

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
      this.transcriptPreviewChunks = [];
      this.futurePreviewSignature = "";
      this.liveOverlayAnchorOffsetSeconds = 2.5;
      this.liveOverlayUtterance = null;
      this.liveCaptureStartedAt = 0;
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
        if (document.visibilityState === "hidden") {
          return;
        }
        this.maybeProbeCaptions();
        this.captureLiveCaptionLine();
        this.maybeUpgradeLiveCaptureToTranscript();
      }, LIVE_CAPTURE_POLL_INTERVAL_MS);
    }

    stopLiveCapturePolling() {
      if (this.liveCapturePollId) {
        window.clearInterval(this.liveCapturePollId);
        this.liveCapturePollId = 0;
      }
    }

    clearCaptionStateForUnavailableVideo() {
      this.cues = [];
      this.allChunks = [];
      this.chunks = [];
      this.revealedChunkCount = 0;
      this.activeIndex = -1;
      this.liveFuturePreviewChunks = [];
      this.transcriptPreviewChunks = [];
      this.futurePreviewSignature = "";
      this.liveOverlayUtterance = null;
      this.liveBubbles = [];
      this.liveBucketToBubble = new Map();
      this.liveDisplayBubbleCache = new Map();
      if (!this.panel) {
        return;
      }
      this.panel.setChunks([]);
      if (typeof this.panel.setFutureChunks === "function") {
        this.panel.setFutureChunks([]);
      }
      if (typeof this.panel.setTimelineData === "function") {
        this.panel.setTimelineData([], Number.NaN);
      }
      this.panel.setActiveIndex(-1);
      if (typeof this.panel.setPlaybackTime === "function") {
        this.panel.setPlaybackTime(0, { forceGlowReset: true });
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
      if (this.settings.futurePreviewEnabled === false) {
        return false;
      }
      if (Array.isArray(this.transcriptPreviewChunks) && this.transcriptPreviewChunks.length) {
        return true;
      }
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

    getFuturePreviewSignature(activeTimelineIndex) {
      if (!this.canShowFuturePreviewChunks()) {
        return "empty";
      }
      const transcriptSource = Array.isArray(this.transcriptPreviewChunks) && this.transcriptPreviewChunks.length
        ? this.transcriptPreviewChunks
        : [];
      if (transcriptSource.length) {
        const currentTime = this.video ? Number(this.video.currentTime || 0) : 0;
        const currentIndex = Number.isInteger(activeTimelineIndex)
          ? activeTimelineIndex
          : this.findTimelineChunkIndex(transcriptSource, currentTime, 0.45);
        const previewStart = Math.max(0, currentIndex + 1);
        const first = transcriptSource[previewStart];
        const last = transcriptSource[transcriptSource.length - 1];
        return [
          "transcript",
          transcriptSource.length,
          previewStart,
          first ? [first.start, first.end, first.seekStart, first.text].join(":") : "",
          last ? [last.start, last.end, last.seekStart, last.text].join(":") : ""
        ].join("|");
      }
      if (this.liveCaptureEnabled) {
        return "live|" + this.getFuturePreviewKey();
      }
      const previewStart = Math.max(0, Number(this.revealedChunkCount || 0));
      const first = this.allChunks[previewStart];
      const last = this.allChunks[this.allChunks.length - 1];
      return [
        "chunks",
        this.allChunks.length,
        previewStart,
        first ? [first.start, first.end, first.seekStart, first.text].join(":") : "",
        last ? [last.start, last.end, last.seekStart, last.text].join(":") : ""
      ].join("|");
    }

    getFuturePreviewChunks(activeTimelineIndex) {
      if (!this.canShowFuturePreviewChunks()) {
        return [];
      }
      const transcriptSource = Array.isArray(this.transcriptPreviewChunks) && this.transcriptPreviewChunks.length
        ? this.transcriptPreviewChunks
        : [];
      if (transcriptSource.length) {
        const currentTime = this.video ? Number(this.video.currentTime || 0) : 0;
        const currentIndex = Number.isInteger(activeTimelineIndex)
          ? activeTimelineIndex
          : this.findTimelineChunkIndex(transcriptSource, currentTime, 0.45);
        const previewStart = Math.max(0, currentIndex + 1);
        return transcriptSource.slice(previewStart).map((chunk, offset) => ({
          ...chunk,
          actualIndex: previewStart + offset,
          futurePreviewOnly: true
        }));
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
      const previews = [];
      for (let index = previewStart; index < this.allChunks.length; index += 1) {
        previews.push({
          ...this.allChunks[index],
          actualIndex: index,
          futurePreviewOnly: true
        });
      }
      return previews;
    }

    findTimelineChunkIndex(chunks, currentTime, toleranceSeconds) {
      const source = Array.isArray(chunks) ? chunks : [];
      if (!source.length) {
        return -1;
      }
      const now = Number(currentTime);
      if (!Number.isFinite(now)) {
        return -1;
      }
      const tolerance = Math.max(0, Number.isFinite(Number(toleranceSeconds)) ? Number(toleranceSeconds) : 0.35);
      let previousIndex = -1;
      for (let index = 0; index < source.length; index += 1) {
        const chunk = source[index];
        const start = this.getChunkActiveStart(chunk);
        const end = Number(chunk && chunk.end);
        if (!Number.isFinite(start)) {
          continue;
        }
        if (now + tolerance < start) {
          return previousIndex;
        }
        if (Number.isFinite(end) && now >= start - tolerance && now < end + tolerance) {
          return index;
        }
        if (now >= start - tolerance) {
          previousIndex = index;
        }
      }
      return previousIndex;
    }

    findPlaybackActiveIndex(chunks, currentTime) {
      const source = Array.isArray(chunks) ? chunks : [];
      const now = Number(currentTime);
      if (!source.length || !Number.isFinite(now)) {
        return -1;
      }
      const startTolerance = 0.08;
      let index = -1;
      for (let candidate = 0; candidate < source.length; candidate += 1) {
        const start = this.getChunkActiveStart(source[candidate]);
        if (!Number.isFinite(start)) {
          continue;
        }
        if (start <= now + startTolerance) {
          index = candidate;
          continue;
        }
        break;
      }
      if (index < 0) {
        return -1;
      }
      const chunk = source[index];
      const start = this.getChunkActiveStart(chunk);
      const end = Math.max(start + 0.25, Number(chunk && chunk.end ? chunk.end : start + 0.25));
      const nextStart =
        index < source.length - 1
          ? this.getChunkActiveStart(source[index + 1])
          : Number.POSITIVE_INFINITY;
      const activeUntil = Number.isFinite(nextStart) ? nextStart : end + 0.75;
      return now >= start - startTolerance && now <= activeUntil + 0.25 ? index : -1;
    }

    updateFuturePreviewChunks(activeTimelineIndex, options) {
      // Full transcript previews can span long videos; avoid rebuilding the same future list on every playback frame.
      const signature = this.getFuturePreviewSignature(activeTimelineIndex);
      if (!(options && options.force) && signature === this.futurePreviewSignature) {
        return;
      }
      this.futurePreviewSignature = signature;
      if (this.panel && typeof this.panel.setFutureChunks === "function") {
        this.panel.setFutureChunks(this.getFuturePreviewChunks(activeTimelineIndex));
      }
      if (
        this.panel &&
        typeof this.panel.isTimelineFeatureAvailable === "function" &&
        this.panel.isTimelineFeatureAvailable() &&
        typeof this.panel.setTimelineData === "function"
      ) {
        const duration = this.video ? Number(this.video.duration) : Number.NaN;
        this.panel.setTimelineData(this.allChunks, duration);
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
      if (pending && Date.now() <= pending.expiresAt && pending.index >= 0 && pending.index < sourceChunks.length) {
        this.ensureChunkVisible(pending.index);
      } else {
        this.pendingSeekFocus = null;
      }
      const nextIndex = this.findPlaybackActiveIndex(sourceChunks, currentTime);
      if (nextIndex < 0) {
        this.activeIndex = -1;
        this.panel.setActiveIndex(-1);
        if (typeof this.panel.setPlaybackTime === "function") {
          this.panel.setPlaybackTime(currentTime, { forceGlowReset: true });
        }
        this.updateFuturePreviewChunks(nextIndex);
        return;
      }
      this.ensureChunkVisible(nextIndex);
      this.updateFuturePreviewChunks(nextIndex);
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
      this.captionAcquisition.abortLoad();
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
      this.tryUpgradeLiveCaptureToTranscript(this.getActiveCaptionSessionId());
    }

    async tryUpgradeLiveCaptureToTranscript(sessionId) {
      return this.captionAcquisition.tryUpgradeLiveCaptureToTranscript(sessionId);
    }

    async loadTranscript(sessionId) {
      return this.captionAcquisition.loadTranscript(sessionId);
    }

    canApplyFullTranscriptResponse(response, sessionId) {
      return Boolean(
        response &&
          response.ok &&
          response.videoId === this.videoId &&
          Array.isArray(response.cues) &&
          response.cues.length &&
          this.isActiveCaptionSession(sessionId) &&
          this.isCurrentVideoPage()
      );
    }

    getTranscriptLoadedStatusMessage(response) {
      return (
        "Loaded " +
        this.chunks.length +
        " chunks (" +
        (response.mode || response.sourceType || "caption timeline") +
        "). Click any chat bubble to seek."
      );
    }

    applyFullTranscriptResponse(response, sessionId, options) {
      const opts = options || {};
      if (!this.canApplyFullTranscriptResponse(response, sessionId)) {
        return false;
      }
      const currentPreferenceKey = this.getCurrentCaptionPreferenceKey();
      if (opts.preserveOpenCaptionPreference && this.hasOpenCaptionPreferenceChanged()) {
        return false;
      }
      this.disableLiveCaptureMode();
      this.transcriptMode = response.mode || "direct transcript mode";
      this.lastCaptionPreferenceKey = opts.preserveOpenCaptionPreference
        ? currentPreferenceKey || this.openCaptionPreferenceKey || this.getCurrentCaptionPreferenceKey()
        : currentPreferenceKey;
      this.cues = response.cues;
      this.revealedChunkCount = 0;
      this.rebuildChunks();
      this.transcriptPreviewChunks = this.allChunks.slice();
      this.noteTranscriptActivity(opts.activityReason || "full-transcript");
      if (opts.recordLoadedDiagnostic) {
        diagnostics.record("captions:transcript-loaded", {
          cueCount: response.cues.length,
          mode: response.mode || response.sourceType || "direct transcript mode",
          futureCueCount: response.futureCueCount || 0
        });
      }
      if (opts.syncAfterApply) {
        this.syncActiveChunk(true);
      }
      const statusMessage = opts.useLoadedStatusMessage
        ? this.getTranscriptLoadedStatusMessage(response)
        : opts.statusMessage;
      if (this.panel && statusMessage) {
        this.panel.setStatus(statusMessage, true);
      }
      return true;
    }

    buildFixedWindowChunksFromCues(cues) {
      const stepSeconds = this.getLiveWindowSizeSeconds();
      const source = Array.isArray(cues) ? cues.slice() : [];
      source.sort((left, right) => Number(left.start || 0) - Number(right.start || 0));

      const buckets = new Map();
      for (let cueIndex = 0; cueIndex < source.length; cueIndex += 1) {
        const cue = source[cueIndex];
        const cueText = cue && (cue.rawText || cue.text) ? cue.rawText || cue.text : "";
        const rawText = this.cleanCaptionCandidateText(cueText);
        const text = rawText;
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
        const cueEnd = Math.max(cueStart + 0.25, Number(cue && cue.end ? cue.end : bucketEnd));
        const cueTokens = this.normalizeCaptionTokens(cue && cue.tokens);
        const existing = buckets.get(bucketIndex);
        if (!existing) {
          buckets.set(bucketIndex, {
            start: bucketStart,
            end: Math.max(bucketEnd, cueEnd),
            seekStart: cueAnchor,
            text: text,
            rawText: rawText,
            tokens: cueTokens
          });
          continue;
        }
        existing.rawText = this.mergeLiveCaptionText(existing.rawText || existing.text, rawText);
        existing.text = existing.rawText;
        existing.end = Math.max(existing.end, bucketEnd, cueEnd);
        existing.tokens = this.mergeCueTokens(existing.tokens, cueTokens);
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
        const text = this.cleanCaptionCandidateText(bucket.rawText || bucket.text);
        if (!text) {
          continue;
        }
        chunks.push({
          id: chunks.length,
          start: bucket.start,
          end: bucket.end,
          seekStart: Number.isFinite(bucket.seekStart) ? bucket.seekStart : bucket.start,
          text: text,
          rawText: bucket.rawText || text,
          tokens: bucket.tokens || []
        });
      }
      return chunks;
    }

    buildTranscriptChunksFromCues(cues) {
      const chunks = chunker.chunkCues(cues, this.settings.chunkSize || "medium");
      return chunks.map((chunk, index) => {
        const tokens = this.normalizeCaptionTokens(chunk.tokens);
        const firstTokenStart = tokens.length ? Number(tokens[0].start) : Number.NaN;
        const start = Math.max(0, Number(chunk.start || 0));
        const rawText = this.cleanCaptionCandidateText(chunk.rawText || chunk.text);
        return {
          ...chunk,
          id: index,
          start,
          end: Math.max(start + 0.25, Number(chunk.end || start + 0.25)),
          seekStart: Number.isFinite(firstTokenStart) ? Math.max(0, firstTokenStart) : start,
          rawText,
          text: rawText,
          tokens,
          sourceType: "transcript"
        };
      }).filter((chunk) => chunk.text);
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
      const limits = chunker.CONVERSATIONAL_CHUNKING && chunker.CONVERSATIONAL_CHUNKING.live
        ? chunker.CONVERSATIONAL_CHUNKING.live
        : {
            tinyFragmentChars: 90,
            comfortableChars: 300,
            hardChars: 430,
            lyricChars: 240,
            hardPauseSeconds: 2.3,
            maxBucketsWithoutSentence: 3,
            maxBucketsWithSentence: 3
          };
      const previousEnd = Number(previousChunk.end || 0);
      const nextStart = Number(nextChunk.start || 0);
      const gap = nextStart - previousEnd;
      const hasRealPause = Number.isFinite(gap) && gap >= limits.hardPauseSeconds;
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

      if (lyricLike && (bucketCount >= 2 || previousLength >= 160 || combined.length >= limits.lyricChars)) {
        return true;
      }

      if (!this.textEndsNaturally(previousChunk.text)) {
        return (
          bucketCount >= limits.maxBucketsWithoutSentence ||
          previousLength >= limits.comfortableChars ||
          combined.length >= limits.hardChars
        );
      }

      const shouldMergeTinyCompleteThought =
        previousLength < limits.tinyFragmentChars &&
        combined.length <= limits.comfortableChars;
      if (shouldMergeTinyCompleteThought) {
        return false;
      }

      if (
        bucketCount >= limits.maxBucketsWithSentence ||
        previousLength >= limits.comfortableChars ||
        combined.length >= limits.hardChars
      ) {
        return true;
      }

      return false;
    }

    mergeCueTokens(existingTokens, nextTokens) {
      const combined = []
        .concat(Array.isArray(existingTokens) ? existingTokens : [])
        .concat(Array.isArray(nextTokens) ? nextTokens : [])
        .filter((token) => token && token.text && Number.isFinite(Number(token.start)) && Number.isFinite(Number(token.end)));
      combined.sort((left, right) => Number(left.start) - Number(right.start));
      const output = [];
      for (let index = 0; index < combined.length; index += 1) {
        const token = combined[index];
        const previous = output[output.length - 1];
        if (
          previous &&
          this.normalizeCaptionToken(previous.text) === this.normalizeCaptionToken(token.text) &&
          Math.abs(Number(previous.start) - Number(token.start)) < 0.08
        ) {
          previous.end = Math.max(Number(previous.end), Number(token.end));
          continue;
        }
        output.push({
          text: String(token.text),
          start: Number(token.start),
          end: Number(token.end)
        });
      }
      return output;
    }

    sliceTokensForText(tokens, wordOffset, wordCount) {
      const source = this.normalizeCaptionTokens(tokens);
      const offset = Math.max(0, Number.isFinite(Number(wordOffset)) ? Math.floor(Number(wordOffset)) : 0);
      const count = Math.max(0, Number.isFinite(Number(wordCount)) ? Math.floor(Number(wordCount)) : 0);
      if (!source.length || count <= 0) {
        return [];
      }
      return source.slice(offset, offset + count);
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
      const rawText = this.cleanCaptionCandidateText(chunk.rawText || chunk.text);
      const text = rawText;
      return {
        uid: this.getNextLiveBubbleUid(),
        id: this.liveBubbles.length,
        start: Number.isFinite(chunk.seekStart) ? Number(chunk.seekStart) : Number(chunk.start || 0),
        end: Number(chunk.end || 0),
        seekStart: Number.isFinite(chunk.seekStart) ? Number(chunk.seekStart) : Number(chunk.start || 0),
        text,
        locked: false,
        bucketIndexes: [bucketIndex],
        bucketTexts: { [bucketIndex]: rawText },
        bucketStarts: { [bucketIndex]: Number(chunk.start || 0) },
        bucketEnds: { [bucketIndex]: Number(chunk.end || 0) },
        bucketTokens: { [bucketIndex]: this.normalizeCaptionTokens(chunk.tokens) },
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
      let tokens = [];
      for (let index = 0; index < ordered.length; index += 1) {
        const bucketIndex = ordered[index];
        const bucketText = this.cleanCaptionCandidateText(bubble.bucketTexts ? bubble.bucketTexts[bucketIndex] : "");
        text = this.mergeLiveCaptionText(text, bucketText);
        start = Math.min(start, Number(bubble.bucketStarts && bubble.bucketStarts[bucketIndex]));
        end = Math.max(end, Number(bubble.bucketEnds && bubble.bucketEnds[bucketIndex]));
        seekStart = Math.min(seekStart, Number(bubble.bucketSeekStarts && bubble.bucketSeekStarts[bucketIndex]));
        tokens = this.mergeCueTokens(tokens, bubble.bucketTokens ? bubble.bucketTokens[bucketIndex] : []);
      }
      bubble.text = text;
      bubble.start = Number.isFinite(seekStart) ? seekStart : Number.isFinite(start) ? start : 0;
      bubble.seekStart = bubble.start;
      bubble.end = Math.max(bubble.start + 0.25, Number.isFinite(end) ? end : bubble.start + 0.25);
      bubble.tokens = this.normalizeCaptionTokens(tokens);
    }

    appendBucketToLiveBubble(bubble, chunk) {
      if (!bubble || bubble.locked) {
        return;
      }
      const bucketIndex = this.getLiveChunkBucketIndex(chunk);
      if (!bubble.bucketIndexes.includes(bucketIndex)) {
        bubble.bucketIndexes.push(bucketIndex);
      }
      bubble.bucketTexts[bucketIndex] = this.cleanCaptionCandidateText(chunk.rawText || chunk.text);
      bubble.bucketStarts[bucketIndex] = Number(chunk.start || 0);
      bubble.bucketEnds[bucketIndex] = Number(chunk.end || 0);
      bubble.bucketTokens[bucketIndex] = this.normalizeCaptionTokens(chunk.tokens);
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

    pruneLiveBubbleMemory() {
      if (!Array.isArray(this.liveBubbles) || this.liveBubbles.length <= MAX_LIVE_BUBBLE_ENTITIES) {
        return;
      }
      const excessCount = this.liveBubbles.length - MAX_LIVE_BUBBLE_ENTITIES;
      let removeCount = 0;
      while (removeCount < excessCount) {
        const candidate = this.liveBubbles[removeCount];
        if (!candidate || !candidate.locked) {
          break;
        }
        removeCount += 1;
      }
      if (removeCount <= 0) {
        return;
      }
      const removed = this.liveBubbles.splice(0, removeCount);
      if (!this.liveDisplayBubbleCache || !(this.liveDisplayBubbleCache instanceof Map)) {
        this.liveDisplayBubbleCache = new Map();
      }
      for (let index = 0; index < removed.length; index += 1) {
        const bubble = removed[index];
        if (bubble && bubble.uid) {
          this.liveDisplayBubbleCache.delete(bubble.uid);
        }
      }
      this.liveBucketToBubble = new Map();
      for (let index = 0; index < this.liveBubbles.length; index += 1) {
        const bubble = this.liveBubbles[index];
        bubble.id = index;
        const buckets = Array.isArray(bubble.bucketIndexes) ? bubble.bucketIndexes : [];
        for (let bucketOffset = 0; bucketOffset < buckets.length; bucketOffset += 1) {
          this.liveBucketToBubble.set(buckets[bucketOffset], bubble);
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
        const chunkText = chunk && (chunk.rawText || chunk.text) ? chunk.rawText || chunk.text : "";
        const rawText = this.cleanCaptionCandidateText(chunkText);
        const text = rawText;
        if (!chunk || !text) {
          continue;
        }

        const bucketIndex = this.getLiveChunkBucketIndex(chunk);
        const existingBubble = this.liveBucketToBubble.get(bucketIndex);
        if (existingBubble) {
          if (!existingBubble.locked) {
            const previousBubble = this.getPreviousLiveBubble(existingBubble);
            const nextChunk = previousBubble
              ? this.trimLiveChunkAgainstPrevious(previousBubble.text, { ...chunk, text, rawText })
              : { ...chunk, text, rawText };
            if (nextChunk.text) {
              nextChunk.rawText = this.cleanCaptionCandidateText(nextChunk.text);
              this.appendBucketToLiveBubble(existingBubble, nextChunk);
            }
          }
          continue;
        }

        const activeBubble = this.liveBubbles[this.liveBubbles.length - 1];
        if (!activeBubble) {
          const firstBubble = this.createLiveBubbleFromChunk({ ...chunk, text, rawText });
          this.liveBubbles.push(firstBubble);
          this.liveBucketToBubble.set(bucketIndex, firstBubble);
          continue;
        }

        const nextChunk = this.trimLiveChunkAgainstPrevious(activeBubble.text, { ...chunk, text, rawText });
        if (!nextChunk.text) {
          continue;
        }
        nextChunk.rawText = this.cleanCaptionCandidateText(nextChunk.text);

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
      this.pruneLiveBubbleMemory();

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
            text: text,
            tokens: bubble.tokens
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
          const originalSeekStart = Number(part.seekStart);
          const seekStart = Number.isFinite(originalSeekStart) && originalSeekStart >= 0
            ? originalSeekStart
            : start;
          records.push({
            ...part,
            start: start,
            end: end,
            seekStart: seekStart,
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
      const maxLiveBubbleChars = 300;
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
          text: text,
          tokens: this.sliceTokensForText(bubble.tokens, 0, text.split(/\s+/).filter(Boolean).length)
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
          text: parts[partIndex],
          tokens: this.sliceTokensForText(bubble.tokens, wordsBefore, partWords)
        }));
        wordsBefore += partWords;
      }
      return records;
    }

    rebuildChunks() {
      const rawChunks = this.liveCaptureEnabled
        ? this.buildFixedWindowChunksFromCues(this.cues)
        : this.buildTranscriptChunksFromCues(this.cues);
      this.allChunks = this.liveCaptureEnabled
        ? this.syncLiveBubblesFromBuckets(rawChunks)
        : rawChunks;
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
      this.persistSettings(nextSettings, patch);
      const isClosed = Boolean(this.settings.panelClosed);
      const changedPanelClosed =
        patch && Object.prototype.hasOwnProperty.call(patch, "panelClosed") && wasClosed !== isClosed;
      const changedFuturePreview =
        patch && Object.prototype.hasOwnProperty.call(patch, "futurePreviewEnabled");

      if (changedFuturePreview) {
        this.updateFuturePreviewChunks();
      }

      if (changedPanelClosed && isClosed) {
        this.invalidateCaptionSession("panel-close");
        this.abortTranscriptLoad();
        this.stopLiveCapturePolling();
        this.stopTranscriptHeartbeat();
        this.clearTimelineActionState("panel-closed");
        this.restoreSubtitlesIfExtensionEnabled();
        return;
      }
      if (changedPanelClosed && !isClosed) {
        this.startCaptionWork();
      }
    }

    persistSettings(nextSettings, patch) {
      const patchSource =
        patch && typeof patch === "object" && patch.layoutLocked === true
          ? nextSettings
          : patch && typeof patch === "object" ? patch : nextSettings;
      this.settings = settingsStore.normalizeSettings(nextSettings);
      if (settingsStore && typeof settingsStore.savePatch === "function") {
        const savePromise = settingsStore.savePatch(patchSource).then((persisted) => {
          this.settings = settingsStore.normalizeSettings({ ...persisted, ...this.settings });
          if (this.panel && this.panel.settings !== this.settings) {
            this.panel.settings = this.settings;
          }
        });
        return savePromise;
      }
      return settingsStore.save(this.settings);
    }

    persistPanelSnapshot() {
      if (!this.panel || typeof this.panel.getPersistenceSnapshot !== "function") {
        return null;
      }
      const snapshot = this.panel.getPersistenceSnapshot();
      if (!snapshot || typeof snapshot !== "object") {
        return null;
      }
      return this.persistSettings({ ...this.settings, ...snapshot }, snapshot);
    }

    getLiveWindowSizeSeconds() {
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
      const minComfortableChars = 96;
      const maxComfortableChars = 340;

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

    getChunkActiveStart(chunk) {
      return this.getChunkSeekStart(chunk);
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

    hasTranscriptActivity() {
      if (Number.isFinite(this.transcriptLastActivityAt) && this.transcriptLastActivityAt > 0) {
        return true;
      }
      // Activity means the panel has received any usable caption data. The
      // heartbeat is only for the empty-panel stall where neither transcript
      // loading nor live capture has produced a bubble.
      return (
        (Array.isArray(this.cues) && this.cues.length > 0) ||
        (Array.isArray(this.allChunks) && this.allChunks.length > 0) ||
        (Array.isArray(this.chunks) && this.chunks.length > 0)
      );
    }

    noteTranscriptActivity(source) {
      if (!this.hasTranscriptActivity()) {
        return;
      }
      this.transcriptLastActivityAt = Date.now();
      this.transcriptRecoveryAttempts = 0;
      this.transcriptReadinessDeferrals = 0;
      this.stopTranscriptHeartbeat();
      diagnostics.record("captions:activity", { source: source || "unknown" });
    }

    stopTranscriptHeartbeat() {
      if (this.transcriptHeartbeatTimerId) {
        window.clearTimeout(this.transcriptHeartbeatTimerId);
        this.transcriptHeartbeatTimerId = 0;
      }
    }

    isTranscriptHeartbeatExhausted() {
      return (
        this.transcriptRecoveryAttempts >= MAX_TRANSCRIPT_RECOVERY_ATTEMPTS ||
        this.transcriptReadinessDeferrals >= MAX_TRANSCRIPT_HEARTBEAT_READINESS_DEFERRALS
      );
    }

    scheduleTranscriptHeartbeatCheck(reason, delayMs, sessionId) {
      const captionSessionId = Number(sessionId || this.getActiveCaptionSessionId());
      if (!this.isActiveCaptionSession(captionSessionId) || this.hasTranscriptActivity()) {
        this.stopTranscriptHeartbeat();
        return;
      }
      if (this.isTranscriptHeartbeatExhausted()) {
        this.stopTranscriptHeartbeat();
        return;
      }
      if (this.transcriptHeartbeatTimerId) {
        return;
      }
      const delay = Math.max(250, Number.isFinite(Number(delayMs)) ? Number(delayMs) : TRANSCRIPT_HEARTBEAT_GRACE_MS);
      // Use a one-shot timer instead of another poll loop. Follow-up checks are
      // scheduled only while the open panel is still empty.
      this.transcriptHeartbeatTimerId = window.setTimeout(() => {
        this.transcriptHeartbeatTimerId = 0;
        this.checkTranscriptHeartbeat(reason || "timer", captionSessionId);
      }, delay);
    }

    isVideoPlayableForTranscriptRecovery() {
      const video = this.refreshVideoReference();
      if (!(video instanceof HTMLVideoElement)) {
        return false;
      }
      const readyState = Number(video.readyState || 0);
      if (readyState < 1 || video.ended) {
        return false;
      }
      const duration = Number(video.duration);
      return Boolean(video.currentSrc || video.src || Number.isFinite(duration) || duration === Number.POSITIVE_INFINITY);
    }

    checkTranscriptHeartbeat(reason, sessionId) {
      const captionSessionId = Number(sessionId || this.getActiveCaptionSessionId());
      if (!this.isActiveCaptionSession(captionSessionId) || this.hasTranscriptActivity()) {
        this.stopTranscriptHeartbeat();
        return;
      }
      if (!this.isVideoPlayableForTranscriptRecovery()) {
        this.transcriptReadinessDeferrals += 1;
        if (this.isTranscriptHeartbeatExhausted()) {
          diagnostics.record("captions:heartbeat-exhausted", {
            attempts: this.transcriptRecoveryAttempts,
            readinessDeferrals: this.transcriptReadinessDeferrals,
            reason: "video-not-ready"
          });
          return;
        }
        this.scheduleTranscriptHeartbeatCheck("video-not-ready", TRANSCRIPT_HEARTBEAT_VIDEO_WAIT_MS, captionSessionId);
        return;
      }
      this.transcriptReadinessDeferrals = 0;
      this.recoverTranscriptActivity(reason || "heartbeat", captionSessionId);
    }

    recoverTranscriptActivity(reason, sessionId) {
      const captionSessionId = Number(sessionId || this.getActiveCaptionSessionId());
      if (!this.isActiveCaptionSession(captionSessionId) || this.hasTranscriptActivity()) {
        return;
      }
      if (this.isTranscriptHeartbeatExhausted()) {
        diagnostics.record("captions:heartbeat-exhausted", {
          attempts: this.transcriptRecoveryAttempts,
          readinessDeferrals: this.transcriptReadinessDeferrals,
          reason: reason || ""
        });
        return;
      }

      this.transcriptRecoveryAttempts += 1;
      diagnostics.record("captions:heartbeat-recovery", {
        attempts: this.transcriptRecoveryAttempts,
        reason: reason || ""
      });

      this.ensurePageBridgeForWatchPage();
      this.startCaptionEnsureLoop(captionSessionId);
      this.ensureCaptionsEnabledOnce();
      this.probeCaptionsNow();

      if (!this.liveCaptureEnabled) {
        this.enableLiveCaptureMode();
      } else {
        // Do not reinitialize live mode here; existing bucket state is what
        // prevents duplicate bubbles if recovery fires after partial capture.
        this.startLiveCapturePolling();
        this.captureLiveCaptionLine();
      }

      if (!this.transcriptLoadInFlight) {
        this.loadTranscript(captionSessionId);
      }
      this.scheduleTranscriptHeartbeatCheck("post-recovery", TRANSCRIPT_HEARTBEAT_RECHECK_MS, captionSessionId);
    }

    nudgeCaptionWork(reason) {
      if (this.destroyed || this.settings.panelClosed) {
        return;
      }
      this.refreshVideoReference();
      if (!this.captionWorkStarted) {
        this.startCaptionWork();
        return;
      }
      if (this.hasTranscriptActivity() || this.transcriptHeartbeatTimerId || this.isTranscriptHeartbeatExhausted()) {
        return;
      }
      // Same-video route events fire periodically on YouTube. Only nudge the
      // caption pipeline when the open panel is still empty and no heartbeat
      // check is already pending.
      this.ensureCaptionsEnabledOnce();
      if (this.liveCaptureEnabled) {
        this.startLiveCapturePolling();
      }
      this.scheduleTranscriptHeartbeatCheck(reason || "nudge", TRANSCRIPT_HEARTBEAT_GRACE_MS, this.getActiveCaptionSessionId());
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
      diagnostics.record("timeline:click", {
        index: index,
        target: targetTime,
        seekStart: seekStart
      });
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
      diagnostics.record("timeline:future-click", {
        target: targetTime,
        seekStart: baseTime
      });
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
        } else {
          this.persistActivePanelState();
        }
      };
      const onPageHide = () => {
        this.persistActivePanelState();
      };

      window.addEventListener("yt-navigate-finish", onRouteEvent);
      document.addEventListener("yt-page-data-updated", onRouteEvent);
      window.addEventListener("popstate", onRouteEvent);
      window.addEventListener("hashchange", onRouteEvent);
      window.addEventListener("pageshow", onRouteEvent);
      window.addEventListener("pagehide", onPageHide);
      window.addEventListener("beforeunload", onPageHide);
      document.addEventListener("visibilitychange", onVisibilityChange);

      this.cleanupFns.push(() => window.removeEventListener("yt-navigate-finish", onRouteEvent));
      this.cleanupFns.push(() => document.removeEventListener("yt-page-data-updated", onRouteEvent));
      this.cleanupFns.push(() => window.removeEventListener("popstate", onRouteEvent));
      this.cleanupFns.push(() => window.removeEventListener("hashchange", onRouteEvent));
      this.cleanupFns.push(() => window.removeEventListener("pageshow", onRouteEvent));
      this.cleanupFns.push(() => window.removeEventListener("pagehide", onPageHide));
      this.cleanupFns.push(() => window.removeEventListener("beforeunload", onPageHide));
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
        diagnostics.record("route:leave-watch", {});
        this.activeVideoId = null;
        this.teardownApp();
        return;
      }

      const videoId = transcript.getVideoId(url);
      if (!videoId) {
        diagnostics.record("route:missing-video-id", {});
        this.activeVideoId = null;
        this.teardownApp();
        return;
      }

      if (videoId === this.activeVideoId && this.app) {
        if (typeof this.app.nudgeCaptionWork === "function") {
          this.app.nudgeCaptionWork("route-still-active");
        }
        return;
      }

      this.activeVideoId = videoId;
      diagnostics.record("route:watch-video", {});
      this.loadNonce += 1;
      const currentNonce = this.loadNonce;

      this.teardownApp();
      if (settingsStore && typeof settingsStore.flush === "function") {
        await settingsStore.flush();
        if (this.destroyed || currentNonce !== this.loadNonce) {
          return;
        }
      }
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

    persistActivePanelState() {
      if (this.app && typeof this.app.persistPanelSnapshot === "function") {
        this.app.persistPanelSnapshot();
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
