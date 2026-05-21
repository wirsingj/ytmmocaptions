(function initCaptionTimeline(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});
  const transcript = app.transcript;
  const diagnostics = app.diagnostics || { record() {} };

  function nowMs() {
    return Date.now();
  }

  function getBrowserName() {
    const ua = String(scope.navigator && scope.navigator.userAgent ? scope.navigator.userAgent : "");
    if (/Firefox\//i.test(ua)) {
      return "firefox";
    }
    if (/Edg\//i.test(ua)) {
      return "edge";
    }
    if (/Chrome\//i.test(ua) || /Chromium\//i.test(ua)) {
      return "chrome";
    }
    return "unknown";
  }

  function normalizeCue(cue, index, sourceType) {
    const start = Number(cue && cue.start);
    const end = Number(cue && cue.end);
    const text = String(cue && cue.text ? cue.text : "").trim();
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return null;
    }
    const id = [
      sourceType || "caption",
      Math.round(start * 1000),
      Math.round(end * 1000),
      index
    ].join("-");
    return {
      id,
      start,
      end,
      startMs: Math.round(start * 1000),
      endMs: Math.round(end * 1000),
      text,
      tokens: Array.isArray(cue.tokens) ? cue.tokens.slice() : [],
      source: sourceType || "unknown"
    };
  }

  function normalizeTimeline(response, pageUrl) {
    const sourceType = response && response.mode ? response.mode : "unknown";
    const sourceCues = Array.isArray(response && response.cues) ? response.cues : [];
    const cues = sourceCues
      .map((cue, index) => normalizeCue(cue, index, sourceType))
      .filter(Boolean)
      .sort((left, right) => left.start - right.start);
    return {
      cues,
      sourceType,
      completeness: cues.length > 1 ? "full-or-extended" : "partial",
      acquiredAt: nowMs(),
      videoId: response && response.videoId ? response.videoId : transcript.getVideoId(pageUrl),
      browser: getBrowserName()
    };
  }

  function countFutureCues(cues, currentTimeSeconds) {
    const now = Number(currentTimeSeconds);
    if (!Array.isArray(cues) || !Number.isFinite(now)) {
      return 0;
    }
    return cues.filter((cue) => Number(cue.start || 0) > now + 0.35).length;
  }

  async function acquireFullTimeline(pageUrl, signal, options) {
    const startedAt = nowMs();
    const attempts = [];
    const browser = getBrowserName();
    const videoElement = options && options.videoElement ? options.videoElement : null;
    const currentTime = videoElement ? Number(videoElement.currentTime || 0) : 0;

    attempts.push({
      source: "full-transcript-provider",
      stage: "start",
      browser,
      currentTime,
      hasVideoElement: Boolean(videoElement),
      textTrackCount:
        videoElement && videoElement.textTracks && typeof videoElement.textTracks.length === "number"
          ? videoElement.textTracks.length
          : 0
    });

    if (!transcript || typeof transcript.loadTranscript !== "function") {
      attempts.push({
        source: "full-transcript-provider",
        stage: "failed",
        reason: "missing_transcript_module"
      });
      return {
        ok: false,
        reason: "Caption timeline module is unavailable.",
        attempts,
        browser,
        acquiredAt: startedAt
      };
    }

    const response = await transcript.loadTranscript(pageUrl, signal, {
      videoElement
    });

    if (!response || !response.ok) {
      attempts.push({
        source: "full-transcript-provider",
        stage: "failed",
        reason: response && response.reason ? response.reason : "unknown_failure",
        detail: response && response.detail ? response.detail : ""
      });
      diagnostics.record("timeline:acquire-failed", {
        browser,
        reason: response && response.reason ? response.reason : "unknown_failure"
      });
      return {
        ...(response || {}),
        ok: false,
        attempts,
        browser,
        acquiredAt: startedAt
      };
    }

    const timeline = normalizeTimeline(response, pageUrl);
    const futureCueCount = countFutureCues(timeline.cues, currentTime);
    attempts.push({
      source: timeline.sourceType,
      stage: "accepted",
      cueCount: timeline.cues.length,
      futureCueCount,
      completeness: timeline.completeness,
      elapsedMs: nowMs() - startedAt
    });
    diagnostics.record("timeline:acquired", {
      browser,
      sourceType: timeline.sourceType,
      cueCount: timeline.cues.length,
      futureCueCount
    });

    return {
      ...response,
      ok: true,
      cues: timeline.cues,
      timeline,
      sourceType: timeline.sourceType,
      completeness: timeline.completeness,
      futureCueCount,
      attempts,
      acquiredAt: timeline.acquiredAt,
      browser
    };
  }

  app.captionTimeline = {
    acquireFullTimeline,
    countFutureCues,
    normalizeTimeline
  };
})(window);
