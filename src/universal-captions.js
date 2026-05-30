(function initUniversalCaptions(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});
  const chunker = app.chunker;
  const settingsStore = app.settingsStore;
  const diagnostics = app.diagnostics || { record() {} };
  const DialoguePanel = app.DialoguePanel;

  if (!chunker || !settingsStore || !DialoguePanel) {
    return;
  }

  const CAPTION_KINDS = new Set(["captions", "subtitles"]);
  const MIN_VIDEO_WIDTH = 160;
  const MIN_VIDEO_HEIGHT = 90;

  function isYouTubePage() {
    return scope.location && scope.location.hostname === "www.youtube.com";
  }

  function isVisibleVideo(video) {
    if (!(video instanceof HTMLVideoElement) || !video.isConnected) {
      return false;
    }
    const rect = video.getBoundingClientRect();
    return rect.width >= MIN_VIDEO_WIDTH && rect.height >= MIN_VIDEO_HEIGHT;
  }

  function hasCaptionTrackElement(video) {
    const tracks = Array.from(video.querySelectorAll("track"));
    return tracks.some((track) => CAPTION_KINDS.has(String(track.kind || "").toLowerCase()));
  }

  function hasCaptionTextTrack(video) {
    const tracks = video && video.textTracks ? video.textTracks : null;
    if (!tracks || !tracks.length) {
      return false;
    }
    for (let index = 0; index < tracks.length; index += 1) {
      const track = tracks[index];
      if (CAPTION_KINDS.has(String(track && track.kind ? track.kind : "").toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  function isEligibleVideo(video) {
    return isVisibleVideo(video) && (hasCaptionTextTrack(video) || hasCaptionTrackElement(video));
  }

  function cueText(cue) {
    if (!cue) {
      return "";
    }
    if (typeof cue.text === "string") {
      return cue.text.replace(/\s+/g, " ").trim();
    }
    return "";
  }

  function normalizeTextTrackCue(cue, index, sourceId, playerId) {
    const start = Number(cue && cue.startTime);
    const end = Number(cue && cue.endTime);
    const text = cueText(cue);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return null;
    }
    return {
      sourceId: sourceId + ":" + index,
      videoId: playerId,
      start,
      end,
      startMs: Math.round(start * 1000),
      endMs: Math.round(end * 1000),
      text,
      sourceType: "text-track",
      confidence: "browser-cue"
    };
  }

  function cueListToArray(cues) {
    if (!cues || typeof cues.length !== "number") {
      return [];
    }
    const output = [];
    for (let index = 0; index < cues.length; index += 1) {
      if (cues[index]) {
        output.push(cues[index]);
      }
    }
    return output;
  }

  class GenericTextTrackAdapter {
    constructor(video, playerId) {
      this.video = video;
      this.playerId = playerId;
      this.originalModes = new Map();
    }

    getTracks() {
      const tracks = [];
      const textTracks = this.video && this.video.textTracks ? this.video.textTracks : null;
      if (!textTracks) {
        return tracks;
      }
      for (let index = 0; index < textTracks.length; index += 1) {
        const track = textTracks[index];
        if (track && CAPTION_KINDS.has(String(track.kind || "").toLowerCase())) {
          tracks.push(track);
        }
      }
      return tracks;
    }

    prepareTracks() {
      const tracks = this.getTracks();
      for (let index = 0; index < tracks.length; index += 1) {
        const track = tracks[index];
        if (!this.originalModes.has(track)) {
          this.originalModes.set(track, track.mode);
        }
        try {
          if (track.mode === "disabled") {
            track.mode = "hidden";
          }
        } catch {
          // Some embedded players expose read-only track state; active cues may still be available.
        }
      }
      return tracks;
    }

    restoreTracks() {
      this.originalModes.forEach((mode, track) => {
        try {
          if (track && typeof mode === "string") {
            track.mode = mode;
          }
        } catch {
          // Some players expose read-only track state. Ignore restore failures.
        }
      });
      this.originalModes.clear();
    }

    acquireTimeline() {
      const tracks = this.prepareTracks();
      const cues = [];
      for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
        const track = tracks[trackIndex];
        const cueList = cueListToArray(track.cues || track.activeCues);
        for (let cueIndex = 0; cueIndex < cueList.length; cueIndex += 1) {
          const cue = normalizeTextTrackCue(cueList[cueIndex], cueIndex, "track-" + trackIndex, this.playerId);
          if (cue) {
            cues.push(cue);
          }
        }
      }
      cues.sort((left, right) => left.start - right.start || left.end - right.end);
      return {
        sourceType: "generic-text-track",
        completeness: cues.length > 1 ? "full-or-extended" : "active-only",
        isLive: !Number.isFinite(Number(this.video && this.video.duration)),
        cues
      };
    }
  }

  class GenericVideoCaptionApp {
    constructor(video, playerId) {
      this.video = video;
      this.playerId = playerId;
      this.adapter = new GenericTextTrackAdapter(video, playerId);
      this.panel = null;
      this.settings = { ...settingsStore.DEFAULTS };
      this.allChunks = [];
      this.chunks = [];
      this.cleanupFns = [];
      this.rafId = 0;
      this.destroyed = false;
      this.lastCueKey = "";
    }

    async init() {
      this.settings = await settingsStore.load();
      this.panel = new DialoguePanel({
        instanceId: this.playerId,
        anchorElement: this.video,
        persistLayout: false,
        settings: { ...this.settings, panelClosed: false, panelPosition: null, launcherPosition: null },
        onSeek: (index) => this.seekToChunk(index),
        onSettingsChange: (settings, patch) => {
          const allowed = {};
          const source = patch && typeof patch === "object" ? patch : {};
          [
            "panelOpacity",
            "textScale",
            "themeName",
            "customThemeColor",
            "fadeTowardVideoCenter",
            "videoCenterFadeStrength",
            "videoCenterFadeMidpoint",
            "videoCenterFadeMinOpacity",
            "layoutLocked",
            "timelineModeEnabled",
            "futurePreviewEnabled",
            "futurePreviewHeight"
          ].forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
              allowed[key] = source[key];
            }
          });
          this.settings = settingsStore.normalizeSettings({ ...this.settings, ...allowed });
          if (typeof settingsStore.savePatch === "function") {
            settingsStore.savePatch(allowed.layoutLocked === true ? this.settings : allowed).then((persisted) => {
              this.settings = settingsStore.normalizeSettings({ ...persisted, ...this.settings });
              if (this.panel && this.panel.settings !== this.settings) {
                this.panel.settings = this.settings;
              }
            });
          } else {
            settingsStore.save(this.settings);
          }
        }
      });
      this.panel.mount();
      this.panel.setStatus("Reading this video's built-in captions.");
      this.bind();
      this.refreshTimeline(true);
    }

    destroy() {
      this.destroyed = true;
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
      for (let index = 0; index < this.cleanupFns.length; index += 1) {
        this.cleanupFns[index]();
      }
      this.cleanupFns.length = 0;
      this.adapter.restoreTracks();
      if (this.panel) {
        this.panel.destroy();
        this.panel = null;
      }
    }

    bind() {
      const schedule = () => this.scheduleRefresh(false);
      const scheduleLayout = () => {
        if (this.panel && typeof this.panel.refreshAnchorLayout === "function") {
          this.panel.refreshAnchorLayout();
        }
      };
      ["timeupdate", "seeked", "loadedmetadata", "durationchange", "play", "pause"].forEach((eventName) => {
        this.video.addEventListener(eventName, schedule);
        this.cleanupFns.push(() => this.video.removeEventListener(eventName, schedule));
      });
      const tracks = this.adapter.prepareTracks();
      for (let index = 0; index < tracks.length; index += 1) {
        const track = tracks[index];
        track.addEventListener("cuechange", schedule);
        this.cleanupFns.push(() => track.removeEventListener("cuechange", schedule));
      }
      window.addEventListener("scroll", scheduleLayout, true);
      window.addEventListener("resize", scheduleLayout);
      document.addEventListener("fullscreenchange", scheduleLayout);
      this.cleanupFns.push(() => window.removeEventListener("scroll", scheduleLayout, true));
      this.cleanupFns.push(() => window.removeEventListener("resize", scheduleLayout));
      this.cleanupFns.push(() => document.removeEventListener("fullscreenchange", scheduleLayout));
      if ("ResizeObserver" in scope) {
        const observer = new ResizeObserver(scheduleLayout);
        observer.observe(this.video);
        this.cleanupFns.push(() => observer.disconnect());
      }
    }

    scheduleRefresh(forceScroll) {
      if (this.rafId || this.destroyed) {
        return;
      }
      this.rafId = requestAnimationFrame(() => {
        this.rafId = 0;
        this.refreshTimeline(Boolean(forceScroll));
      });
    }

    refreshTimeline(forceScroll) {
      if (this.destroyed || !this.panel || !this.video.isConnected) {
        return;
      }
      const timeline = this.adapter.acquireTimeline();
      const cueKey = timeline.cues.map((cue) => cue.start + ":" + cue.end + ":" + cue.text).join("|");
      if (cueKey !== this.lastCueKey) {
        this.lastCueKey = cueKey;
        this.allChunks = chunker.chunkCues(timeline.cues, "medium").map((chunk, index) => ({
          ...chunk,
          id: index,
          sourceType: timeline.sourceType,
          seekStart: Number.isFinite(Number(chunk.seekStart)) ? Number(chunk.seekStart) : Number(chunk.start || 0)
        }));
      }
      const now = Number(this.video.currentTime || 0);
      const currentIndex = chunker.findActiveChunkIndexAtTime(this.allChunks, now, 0.35);
      const floorIndex = chunker.findChunkIndexAtTime(this.allChunks, now);
      const revealThrough = Math.max(currentIndex, floorIndex);
      const visibleCount = Math.max(0, Math.min(this.allChunks.length, revealThrough + 1));
      this.chunks = this.allChunks.slice(0, visibleCount);
      this.panel.setChunks(this.chunks);
      const futureStart = Math.max(0, revealThrough + 1);
      const future = this.settings.futurePreviewEnabled === false
        ? []
        : this.allChunks.slice(futureStart, futureStart + 4).map((chunk, offset) => ({
          ...chunk,
          actualIndex: futureStart + offset,
          futurePreviewOnly: true
        }));
      this.panel.setFutureChunks(future);
      if (typeof this.panel.setTimelineData === "function") {
        this.panel.setTimelineData(this.allChunks, Number(this.video.duration));
      }
      const visibleActive = currentIndex >= 0 && currentIndex < this.chunks.length ? currentIndex : -1;
      this.panel.setActiveIndex(visibleActive, { ensureVisible: forceScroll });
      this.panel.setPlaybackTime(now);
      if (!this.allChunks.length) {
        this.panel.setStatus("This video has caption tracks, but no cues are available yet.");
      } else {
        this.panel.setStatus(timeline.completeness === "active-only" ? "Live caption mode: future text is not available." : "");
      }
      if (typeof this.panel.refreshAnchorLayout === "function") {
        this.panel.refreshAnchorLayout();
      }
    }

    seekToChunk(index) {
      if (!this.video || !this.allChunks.length) {
        return;
      }
      let target = null;
      if (index && typeof index === "object" && index.future) {
        target = index;
      } else if (Number.isInteger(index)) {
        target = this.allChunks[index];
      }
      const seekStart = Number(target && target.seekStart);
      const start = Number(target && target.start);
      const targetTime = Number.isFinite(seekStart) ? seekStart : start;
      if (!Number.isFinite(targetTime)) {
        return;
      }
      this.video.currentTime = Math.max(0, targetTime - 0.35);
      const playResult = this.video.play && this.video.play();
      if (playResult && typeof playResult.catch === "function") {
        playResult.catch(() => {});
      }
      this.scheduleRefresh(true);
    }
  }

  class PlayerRegistry {
    constructor() {
      this.players = new Map();
      this.nextId = 1;
      this.observer = null;
      this.intervalId = 0;
      this.destroyed = false;
    }

    start() {
      this.scan();
      this.observer = new MutationObserver(() => this.scan());
      this.observer.observe(document.documentElement, { childList: true, subtree: true });
      this.intervalId = scope.setInterval(() => this.scan(), 2500);
    }

    destroy() {
      this.destroyed = true;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      if (this.intervalId) {
        scope.clearInterval(this.intervalId);
        this.intervalId = 0;
      }
      this.players.forEach((entry) => entry.app.destroy());
      this.players.clear();
    }

    scan() {
      if (this.destroyed || isYouTubePage()) {
        return;
      }
      const videos = Array.from(document.querySelectorAll("video"));
      for (let index = 0; index < videos.length; index += 1) {
        const video = videos[index];
        if (this.players.has(video) || !isEligibleVideo(video)) {
          continue;
        }
        const playerId = "generic-" + this.nextId;
        this.nextId += 1;
        const runningApp = new GenericVideoCaptionApp(video, playerId);
        this.players.set(video, { app: runningApp, playerId });
        runningApp.init().catch((error) => {
          diagnostics.record("universal:init-failed", { reason: error && error.message ? error.message : "unknown" });
          this.players.delete(video);
        });
      }
      this.players.forEach((entry, video) => {
        if (!video.isConnected || !isVisibleVideo(video)) {
          entry.app.destroy();
          this.players.delete(video);
        } else if (entry.app.panel && typeof entry.app.panel.refreshAnchorLayout === "function") {
          entry.app.panel.refreshAnchorLayout();
        }
      });
    }
  }

  app.universalCaptions = {
    PlayerRegistry,
    GenericTextTrackAdapter,
    normalizeTextTrackCue,
    isEligibleVideo
  };
})(window);
