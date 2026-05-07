(function initContentScript(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});
  const transcript = app.transcript;
  const chunker = app.chunker;
  const settingsStore = app.settingsStore;
  const featureFlags = app.featureFlags;
  const platform = app.platform;
  const pageContext = app.pageContext;
  const DialoguePanel = app.DialoguePanel;

  if (!transcript || !chunker || !settingsStore || !featureFlags || !platform || !DialoguePanel) {
    console.warn("[Dialogue Captions] Missing required modules.");
    return;
  }

  if (pageContext && typeof pageContext.ensureBridgeInjected === "function") {
    pageContext.ensureBridgeInjected();
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
      this.entitlement = { plan: "free", source: "settings" };
      this.features = featureFlags.buildFeatureState("free", {});

      this.cleanupFns = [];
      this.syncRafId = 0;
      this.loadAbortController = null;
      this.destroyed = false;
      this.suppressSpaceKeyUp = false;
      this.liveCaptureEnabled = false;
      this.liveCapturePollId = 0;
      this.liveLastObservedTime = Number.NaN;
      this.liveMaxBucketIndexSeen = -1;
      this.liveLockCutoffIndex = -1;
      this.liveOverlayAnchorOffsetSeconds = 2.5;
      this.liveOverlayUtterance = null;
      this.lastCaptionProbeAt = 0;
      this.captionsEnsured = false;
      this.transcriptMode = "initializing";
      this.transcriptLoadAttempts = 0;
    }

    async init() {
      this.settings = await settingsStore.load();
      if (Number(this.settings.keyboardStepSeconds) !== 8) {
        this.settings.keyboardStepSeconds = 8;
        settingsStore.save(this.settings);
      }
      if (this.settings.collapsed) {
        this.settings.collapsed = false;
        settingsStore.save(this.settings);
      }
      if (this.settings.panelClosed) {
        this.settings.panelClosed = false;
        settingsStore.save(this.settings);
      }
      await this.refreshEntitlement();
      this.panel = new DialoguePanel({
        settings: this.settings,
        features: this.features,
        onSeek: (index) => this.seekToChunk(index),
        onChunkSizeChange: (chunkSize) => this.onChunkSizeChange(chunkSize),
        onSettingsChange: (settings) => this.onSettingsChanged(settings)
      });
      this.panel.mount();
      this.panel.setStatus("Loading subtitles...");

      this.video = await this.waitForVideoElement(12000);
      if (!this.video) {
        this.panel.setStatus("Could not find the YouTube video element.");
        return;
      }

      this.bindKeyboardHandler();
      this.bindVideoSync();
      this.startCaptionEnsureLoop();
      this.enableLiveCaptureMode();
      await this.loadTranscript();
      this.syncActiveChunk(true);
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
      this.disableLiveCaptureMode();

      if (this.panel) {
        this.panel.destroy();
        this.panel = null;
      }
      this.video = null;
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
      const onTimeUpdate = () => {
        this.scheduleSync();
        if (this.liveCaptureEnabled) {
          this.captureLiveCaptionLine();
        }
      };
      const onSeeked = () => {
        if (this.liveCaptureEnabled) {
          this.handleDiscontinuousTimeMove("seeked");
        }
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

      this.video.addEventListener("timeupdate", onTimeUpdate);
      this.video.addEventListener("seeked", onSeeked);
      this.video.addEventListener("loadedmetadata", onLoadedMetadata);

      this.cleanupFns.push(() => this.video && this.video.removeEventListener("timeupdate", onTimeUpdate));
      this.cleanupFns.push(() => this.video && this.video.removeEventListener("seeked", onSeeked));
      this.cleanupFns.push(() => this.video && this.video.removeEventListener("loadedmetadata", onLoadedMetadata));
    }

    normalizeLiveCaptionText(input) {
      const raw = String(input || "")
        .replace(/\u200b/g, "")
        .replace(/\r\n?/g, "\n")
        .replace(/\s+>>\s+/g, "\n");
      const lines = raw
        .split("\n")
        .map((line) =>
          line
            .replace(/^\s*>>\s*/, "")
            .replace(/\s+/g, " ")
            .trim()
        )
        .filter(Boolean);
      return lines.join("\n");
    }

    sanitizeOverlayCandidateText(input) {
      return String(input || "")
        .replace(/\benglish\s*\(auto-generated\)\b/gi, " ")
        .replace(/\bclick for settings\b/gi, " ")
        .replace(/\[\s*[_-]+\s*\]/g, " ");
    }

    collapseOverlaySpamIfNeeded(input) {
      const normalized = this.normalizeLiveCaptionText(input);
      if (!normalized) {
        return "";
      }
      const collapsed = this.collapseRepeatedCaptionPhrases(normalized);
      if (!collapsed) {
        return "";
      }
      const beforeWords = normalized.split(/\s+/).filter(Boolean).length;
      const afterWords = collapsed.split(/\s+/).filter(Boolean).length;
      if (beforeWords - afterWords >= 6) {
        return collapsed;
      }
      return normalized;
    }

    toCaptionCanonical(text) {
      return String(text || "")
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    collapseRepeatedCaptionPhrases(text) {
      const input = this.normalizeLiveCaptionText(text);
      if (!input) {
        return "";
      }
      const words = input.split(" ").filter(Boolean);
      if (words.length < 6) {
        return input;
      }

      const compact = words.slice();
      let changed = true;
      while (changed) {
        changed = false;
        const maxWindow = Math.min(14, Math.floor(compact.length / 2));
        for (let windowSize = maxWindow; windowSize >= 3; windowSize -= 1) {
          for (let index = 0; index + windowSize * 2 <= compact.length; index += 1) {
            let same = true;
            for (let offset = 0; offset < windowSize; offset += 1) {
              const left = String(compact[index + offset] || "").toLowerCase();
              const right = String(compact[index + windowSize + offset] || "").toLowerCase();
              if (left !== right) {
                same = false;
                break;
              }
            }
            if (!same) {
              continue;
            }
            compact.splice(index + windowSize, windowSize);
            changed = true;
            index = Math.max(-1, index - windowSize);
          }
        }
      }

      return this.normalizeLiveCaptionText(compact.join(" "));
    }

    dedupeCaptionCandidates(candidates) {
      const source = Array.isArray(candidates) ? candidates : [];
      const selected = [];
      for (let index = 0; index < source.length; index += 1) {
        const candidate = this.collapseOverlaySpamIfNeeded(this.sanitizeOverlayCandidateText(source[index]));
        if (!candidate) {
          continue;
        }
        let dropped = false;
        for (let selectedIndex = 0; selectedIndex < selected.length; selectedIndex += 1) {
          const existing = selected[selectedIndex];
          if (!this.isHighOverlapText(candidate, existing)) {
            continue;
          }
          if (candidate.length > existing.length + 6) {
            selected[selectedIndex] = candidate;
          }
          dropped = true;
          break;
        }
        if (!dropped) {
          selected.push(candidate);
        }
      }
      return selected.slice(0, 6);
    }

    mergeLiveCaptionText(previousText, nextText) {
      const previous = this.normalizeLiveCaptionText(previousText);
      const next = this.normalizeLiveCaptionText(nextText);
      if (!previous) {
        return next;
      }
      if (!next) {
        return previous;
      }
      if (previous === next) {
        return previous;
      }

      const previousCanonical = this.toCaptionCanonical(previous);
      const nextCanonical = this.toCaptionCanonical(next);
      if (previousCanonical && nextCanonical) {
        if (previousCanonical.includes(nextCanonical)) {
          return previous;
        }
        if (nextCanonical.includes(previousCanonical)) {
          return next;
        }
      }

      const previousTokens = previous.split(/\s+/).filter(Boolean);
      const nextTokens = next.split(/\s+/).filter(Boolean);
      const maxOverlap = Math.min(18, previousTokens.length, nextTokens.length);
      let overlap = 0;
      for (let size = maxOverlap; size >= 1; size -= 1) {
        let matches = true;
        for (let index = 0; index < size; index += 1) {
          const left = String(previousTokens[previousTokens.length - size + index] || "").toLowerCase();
          const right = String(nextTokens[index] || "").toLowerCase();
          if (left !== right) {
            matches = false;
            break;
          }
        }
        if (matches) {
          overlap = size;
          break;
        }
      }

      if (overlap > 0) {
        const tail = nextTokens.slice(overlap).join(" ");
        if (!tail) {
          return previous;
        }
        return this.normalizeLiveCaptionText(previous + " " + tail);
      }

      return this.normalizeLiveCaptionText(previous + " " + next);
    }

    isHighOverlapText(leftText, rightText) {
      const left = this.toCaptionCanonical(leftText);
      const right = this.toCaptionCanonical(rightText);
      if (!left || !right) {
        return false;
      }
      if (left === right) {
        return true;
      }
      if (left.length >= 22 && right.length >= 22) {
        if (left.includes(right) || right.includes(left)) {
          return true;
        }
      }

      const leftTokens = left.split(" ").filter(Boolean);
      const rightTokens = right.split(" ").filter(Boolean);
      if (!leftTokens.length || !rightTokens.length) {
        return false;
      }
      const rightSet = new Set(rightTokens);
      let overlap = 0;
      for (let index = 0; index < leftTokens.length; index += 1) {
        if (rightSet.has(leftTokens[index])) {
          overlap += 1;
        }
      }
      const ratio = overlap / Math.max(leftTokens.length, rightTokens.length);
      return ratio >= 0.8;
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
      const windowNodes = container.querySelectorAll(".ytp-caption-window");
      windowNodes.forEach((node) => {
        if (!this.isNodeVisible(node)) {
          return;
        }
        const text = this.collapseOverlaySpamIfNeeded(this.sanitizeOverlayCandidateText(node.textContent || ""));
        if (text) {
          lineCandidates.push(text);
        }
      });

      if (!lineCandidates.length) {
        const segmentNodes = container.querySelectorAll(
          [".ytp-caption-segment", ".caption-visual-line", ".captions-text span"].join(", ")
        );
        segmentNodes.forEach((node) => {
          if (!this.isNodeVisible(node)) {
            return;
          }
          const text = this.collapseOverlaySpamIfNeeded(this.sanitizeOverlayCandidateText(node.textContent || ""));
          if (text) {
            lineCandidates.push(text);
          }
        });
      }

      if (!lineCandidates.length) {
        return this.collapseOverlaySpamIfNeeded(this.sanitizeOverlayCandidateText(container.textContent || ""));
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
          const text = this.normalizeLiveCaptionText(cue && cue.text ? cue.text : "");
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
          const text = this.normalizeLiveCaptionText(cue && cue.text ? cue.text : "");
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
        startTime: bucketStart
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
      if (!this.liveCaptureEnabled) {
        return;
      }
      this.liveLastObservedTime = this.video ? Number(this.video.currentTime || 0) : Number.NaN;
      this.liveOverlayUtterance = null;
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
      const normalized = this.normalizeLiveCaptionText(text);
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
        return;
      }
      if (currentBucketIndex <= this.liveMaxBucketIndexSeen) {
        return;
      }
      this.liveLockCutoffIndex = Math.max(this.liveLockCutoffIndex, currentBucketIndex - 4);
      this.liveMaxBucketIndexSeen = currentBucketIndex;
    }

    captureLiveCaptionLine() {
      if (!this.liveCaptureEnabled || !this.video) {
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

      const windowSnapshot = this.readTextTrackWindowSnapshot(currentBucketIndex);
      const activeSnapshot = this.readTextTrackSnapshotAtCurrentTime();
      const overlayText = this.readVisibleCaptionText();
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
        if (overlayText) {
          text = this.mergeLiveCaptionText(text, overlayText);
        }
      } else {
        usedOverlayOnlyPath = true;
        text = overlayText;
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
        }
        this.maybeProbeCaptions();
        return;
      }

      const normalized = this.normalizeLiveCaptionText(text);
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

    ensureCaptionsEnabledOnce() {
      if (this.destroyed) {
        return;
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
      }
    }

    startCaptionEnsureLoop() {
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
      const now = Date.now();
      if (now - this.lastCaptionProbeAt < 2500) {
        return;
      }
      this.probeCaptionsNow();
    }

    enableLiveCaptureMode() {
      if (this.liveCaptureEnabled) {
        return;
      }
      this.transcriptMode = "live overlay fallback mode";
      this.liveCaptureEnabled = true;
      this.cues = [];
      this.revealedChunkCount = 0;
      this.liveLastObservedTime = Number.NaN;
      this.liveMaxBucketIndexSeen = -1;
      this.liveLockCutoffIndex = -1;
      this.lastCaptionProbeAt = 0;
      this.rebuildChunks();
      this.probeCaptionsNow();
      this.captureLiveCaptionLine();

      if (!this.liveCapturePollId) {
        this.liveCapturePollId = window.setInterval(() => {
          this.maybeProbeCaptions();
          this.captureLiveCaptionLine();
        }, 120);
      }
    }

    disableLiveCaptureMode() {
      this.liveCaptureEnabled = false;
      this.liveLastObservedTime = Number.NaN;
      this.liveMaxBucketIndexSeen = -1;
      this.liveLockCutoffIndex = -1;
      this.liveOverlayAnchorOffsetSeconds = 2.5;
      this.liveOverlayUtterance = null;
      if (this.liveCapturePollId) {
        window.clearInterval(this.liveCapturePollId);
        this.liveCapturePollId = 0;
      }
    }

    scheduleSync() {
      if (this.syncRafId) {
        return;
      }
      this.syncRafId = platform.requestFrame(() => {
        this.syncRafId = 0;
        this.syncActiveChunk(false);
      });
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
      }
    }

    syncActiveChunk(forceScroll) {
      if (!this.video || !this.panel) {
        return;
      }
      const sourceChunks = this.allChunks;
      if (!sourceChunks.length) {
        return;
      }
      const currentTime = this.video.currentTime || 0;
      const nextIndex = chunker.findChunkIndexAtTime(sourceChunks, currentTime);
      if (nextIndex < 0) {
        return;
      }
      this.ensureChunkVisible(nextIndex);
      this.activeIndex = Math.max(0, Math.min(nextIndex, this.chunks.length - 1));
      this.panel.setActiveIndex(this.activeIndex, { ensureVisible: forceScroll });
    }

    abortTranscriptLoad() {
      if (this.loadAbortController) {
        this.loadAbortController.abort();
        this.loadAbortController = null;
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
          this.panel.setChunks([]);
          this.panel.setStatus(
            shouldEnableLiveCapture
              ? "Live overlay fallback mode active. Turn YouTube CC on and play; lines will stream into this log."
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
        const text = this.normalizeLiveCaptionText(cue && cue.text ? cue.text : "");
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
        chunks.push({
          id: chunks.length,
          start: bucket.start,
          end: bucket.end,
          seekStart: Number.isFinite(bucket.seekStart) ? bucket.seekStart : bucket.start,
          text: bucket.text
        });
      }
      return this.polishFixedWindowChunks(chunks);
    }

    rebuildChunks() {
      this.allChunks = this.buildFixedWindowChunksFromCues(this.cues);
      const previousRevealed = Math.max(0, Number(this.revealedChunkCount || 0));
      const initialVisible = Math.min(this.allChunks.length, previousRevealed);
      this.revealedChunkCount = initialVisible;
      this.chunks = this.allChunks.slice(0, this.revealedChunkCount);
      if (this.panel) {
        this.panel.setChunks(this.chunks);
      }
      this.activeIndex = -1;
    }

    onChunkSizeChange(chunkSize) {
      if (!this.features.chunkSizeControl) {
        return;
      }
      if (chunkSize === this.settings.chunkSize) {
        return;
      }
      this.persistSettings({ chunkSize: chunkSize });
      this.rebuildChunks();
      this.syncActiveChunk(true);
    }

    onSettingsChanged(nextSettings) {
      this.persistSettings(nextSettings, true);
    }

    persistSettings(nextSettings, alreadyNormalized) {
      this.settings = alreadyNormalized
        ? settingsStore.normalizeSettings(nextSettings)
        : settingsStore.normalizeSettings({ ...this.settings, ...nextSettings });
      this.applyFeatureGates();
      settingsStore.save(this.settings);
    }

    async refreshEntitlement() {
      this.entitlement = await featureFlags.resolveEntitlement(this.settings);
      this.features = featureFlags.buildFeatureState(
        this.entitlement.plan,
        this.settings.featureOverrides
      );
      this.applyFeatureGates();
    }

    applyFeatureGates() {
      if (!this.features.globalKeyboardMode) {
        this.settings.globalKeyboardEnabled = false;
      }
      this.settings.chunkSize = "medium";
      this.settings.keyboardStepSeconds = 8;
      if (!this.features.autoScrollControl) {
        this.settings.autoScroll = true;
      }
    }

    getKeyboardStepSeconds() {
      return 8;
    }

    textEndsNaturally(text) {
      return /[.!?]["')\]]?$/.test(String(text || "").trim());
    }

    splitTextByNaturalBreaks(text, maxChars) {
      const normalized = this.normalizeLiveCaptionText(text);
      if (!normalized) {
        return [];
      }
      const limit = Number.isFinite(maxChars) ? Math.max(120, Number(maxChars)) : 330;
      if (normalized.length <= limit) {
        return [normalized];
      }

      const sentences = normalized.match(/[^.!?]+[.!?]["')\]]*|[^.!?]+$/g) || [normalized];
      const pieces = [];
      let buffer = "";

      const flush = () => {
        const value = this.normalizeLiveCaptionText(buffer);
        if (value) {
          pieces.push(value);
        }
        buffer = "";
      };

      for (let index = 0; index < sentences.length; index += 1) {
        const sentence = this.normalizeLiveCaptionText(sentences[index]);
        if (!sentence) {
          continue;
        }
        const candidate = buffer ? buffer + " " + sentence : sentence;
        if (buffer && candidate.length > limit) {
          flush();
        }
        if (sentence.length <= limit) {
          buffer = buffer ? buffer + " " + sentence : sentence;
          continue;
        }

        const words = sentence.split(/\s+/).filter(Boolean);
        for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
          const word = words[wordIndex];
          const next = buffer ? buffer + " " + word : word;
          if (buffer && next.length > limit) {
            flush();
          }
          buffer = buffer ? buffer + " " + word : word;
        }
      }
      flush();
      return pieces;
    }

    polishFixedWindowChunks(chunks) {
      const source = Array.isArray(chunks) ? chunks : [];
      const merged = [];
      const minComfortableChars = 72;
      const maxComfortableChars = 330;

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
        this.video = liveVideo;
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

      if (isBackward && canUseChunkNavigation) {
        const rewindIndex = chunker.findChunkIndexAtTime(sourceChunks, rawTarget);
        if (rewindIndex >= 0) {
          const anchoredStart = this.getChunkSeekStart(sourceChunks[rewindIndex]);
          if (Number.isFinite(anchoredStart) && anchoredStart <= now - 0.2) {
            target = anchoredStart;
          }
        }
      }

      target = Math.max(0, Math.min(upperBound, target));
      const wasPaused = video.paused;
      video.currentTime = target;
      this.syncActiveChunk(true);
      this.scheduleSync();
      window.setTimeout(() => this.syncActiveChunk(true), 80);
      window.setTimeout(() => this.enforcePlaybackState(wasPaused), 0);
      window.setTimeout(() => this.enforcePlaybackState(wasPaused), 80);
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
      if (!video || !this.panel || index < 0 || index >= this.allChunks.length) {
        return;
      }
      const opts = options && typeof options === "object" ? options : {};
      this.ensureChunkVisible(index);
      const chunk = this.allChunks[index];
      const seekLeadSeconds = Number.isFinite(opts.seekLeadSeconds) ? Math.max(0, Number(opts.seekLeadSeconds)) : 1;
      let targetTime = Math.max(0, this.getChunkSeekStart(chunk) - seekLeadSeconds);
      if (Number.isFinite(opts.minTargetTime)) {
        targetTime = Math.max(targetTime, Number(opts.minTargetTime));
      }
      const wasPaused = video.paused;
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
      this.activeIndex = index;
      this.panel.setActiveIndex(index, { ensureVisible: opts.ensureVisible !== false });
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
