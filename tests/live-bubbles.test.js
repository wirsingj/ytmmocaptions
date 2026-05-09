const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");

exports.run = async function runLiveBubbleTests(ctx) {
  const { assert, runCase } = ctx;
  const source = fs.readFileSync(path.join(ROOT_DIR, "src", "content-script.js"), "utf8");

  await runCase("live bubble thresholds prevent paragraph-sized unlocked bubbles", () => {
    assert.ok(source.includes("bucketCount >= 3 || previousLength >= 340 || combined.length >= 430"));
    assert.ok(source.includes("bucketCount >= 2 || previousLength >= 220 || combined.length >= 320"));
  });

  await runCase("natural sentence boundaries can start new bubbles earlier", () => {
    const method = source.slice(
      source.indexOf("shouldStartNewLiveBubble(previousChunk, nextChunk)"),
      source.indexOf("getLiveChunkBucketIndex(chunk)")
    );
    assert.ok(method.includes("this.textEndsNaturally(previousChunk.text)"));
    assert.ok(method.includes("return true;"));
  });

  await runCase("lyric-like captions split sooner than regular rambling speech", () => {
    const method = source.slice(
      source.indexOf("shouldStartNewLiveBubble(previousChunk, nextChunk)"),
      source.indexOf("getLiveChunkBucketIndex(chunk)")
    );
    assert.ok(method.includes("captionText.looksLyricLike"));
    assert.ok(method.includes("previousLength >= 180"));
    assert.ok(method.includes("combined.length >= 260"));
  });

  await runCase("locked display bubbles use bounded natural splits and preserve seek starts", () => {
    const start = source.indexOf("    createLockedDisplayBubbles(bubble)");
    const method = source.slice(
      start,
      source.indexOf("    rebuildChunks()", start)
    );
    assert.ok(method.includes("const maxLiveBubbleChars = 240"));
    assert.ok(method.includes("splitTextByNaturalBreaks(text, maxLiveBubbleChars, false)"));
    assert.ok(method.includes("seekStart: alignedStart"));
    assert.ok(method.includes("locked: true"));
  });

  await runCase("finished live bubble entities are sealed before display rendering", () => {
    assert.ok(source.includes("sealFinishedLiveBubbles(currentBucketIndex)"));
    assert.ok(source.includes("shouldSealLiveBubble(bubble, currentBucketIndex)"));
    assert.ok(source.includes("latestBucketIndex < currentBucketIndex"));
    assert.ok(source.includes("bubble.immutable = true"));
    assert.ok(source.includes("this.sealFinishedLiveBubbles(this.liveMaxBucketIndexSeen)"));
    assert.ok(source.includes("activeBubble.locked || this.shouldStartNewLiveBubble(activeBubble, nextChunk)"));
  });

  await runCase("overlay text is deduped and merged instead of duplicated", () => {
    const captionTextSource = fs.readFileSync(path.join(ROOT_DIR, "src", "caption-text.js"), "utf8");
    assert.ok(captionTextSource.includes("collapseRepeatedPhrases"));
    assert.ok(captionTextSource.includes("collapseRepeatedSentences"));
    assert.ok(source.includes("mergeLiveCaptionText"));
    assert.ok(source.includes("trimLiveChunkAgainstPrevious"));
  });

  await runCase("quick seek state keeps locked bubbles and flash markers separate", () => {
    assert.ok(source.includes("this.liveDisplayBubbleCache"));
    assert.ok(source.includes("bubbleState.markFlashOnStart"));
    assert.ok(source.includes("bubbleState.consumeFlashOnStart"));
    assert.ok(source.includes("handleDiscontinuousTimeMove"));
  });

  await runCase("new timeline actions clear stale pending flashes and focus", () => {
    assert.ok(source.includes("clearPendingBubbleStartFlashes()"));
    assert.ok(source.includes("this.clearPendingBubbleStartFlashes();"));
    assert.ok(source.includes("this.timelineAction = null;"));
    assert.ok(source.includes("this.pendingSeekFocus = null;"));
    assert.ok(source.includes("chunk.flashOnStart.done = true;"));
  });

  await runCase("manual seeks clear stale click focus unless the programmatic seek is settling", () => {
    const method = source.slice(
      source.indexOf("handleDiscontinuousTimeMove()"),
      source.indexOf("suppressLiveCaptureForSeek(targetTime)")
    );
    assert.ok(method.includes("isTimelineActionCurrentForTime(currentTime)"));
    assert.ok(method.includes("clearTimelineActionState"));
    assert.ok(source.includes("return Math.abs(now - targetTime) <= 1.15;"));
  });

  await runCase("clicking or rewinding suppresses stale overlay capture during seek settle", () => {
    assert.ok(source.includes("liveCaptureSuppressedUntil"));
    assert.ok(source.includes("suppressLiveCaptureForSeek(this.timelineAction.targetTime)"));
    assert.ok(source.includes("Date.now() < Number(this.liveCaptureSuppressedUntil || 0)"));
  });

  await runCase("closed pill mode pauses caption polling without wiping bubble state", () => {
    const closeBranch = source.slice(
      source.indexOf("if (changedPanelClosed && isClosed)"),
      source.indexOf("if (changedPanelClosed && !isClosed)")
    );
    assert.ok(closeBranch.includes("this.abortTranscriptLoad();"));
    assert.ok(closeBranch.includes("this.stopLiveCapturePolling();"));
    assert.ok(closeBranch.includes("this.restoreSubtitlesIfExtensionEnabled();"));
    assert.ok(source.includes("startLiveCapturePolling()"));
    assert.ok(source.includes("stopLiveCapturePolling()"));
    assert.ok(source.includes("this.settings.panelClosed"));
    assert.ok(!closeBranch.includes("disableLiveCaptureMode()"));
  });

  await runCase("video sync listeners are rebound and cleaned when YouTube swaps video elements", () => {
    assert.ok(source.includes("this.videoCleanupFns = [];"));
    assert.ok(source.includes("this.boundVideo = null;"));
    assert.ok(source.includes("if (this.boundVideo === this.video)"));
    assert.ok(source.includes("const boundVideo = this.video;"));
    assert.ok(source.includes("boundVideo.removeEventListener"));
    assert.ok(source.includes("this.cleanupVideoSync();"));
  });

  await runCase("async init exits safely if SPA navigation destroys the app mid-load", () => {
    const initStart = source.indexOf("    async init()");
    const initBody = source.slice(initStart, source.indexOf("    destroy()", initStart));
    assert.ok(initBody.includes("this.settings = await settingsStore.load();"));
    assert.ok(initBody.includes("if (this.destroyed)"));
    assert.ok(initBody.includes("this.video = await this.waitForVideoElement(12000);"));
    assert.ok(initBody.includes("if (this.panel)"));
  });

  await runCase("live capture avoids repeated expensive caption reads during steady playback", () => {
    assert.ok(source.includes("liveLastBackfillBucketIndex"));
    assert.ok(source.includes("nowMs - Number(this.liveLastBackfillAt || 0) < 900"));
    const captureStart = source.indexOf("    captureLiveCaptionLine()");
    const captureBody = source.slice(captureStart, source.indexOf("    pickPreferredTrack(tracklist)", captureStart));
    assert.ok(captureBody.includes("const overlayText = this.readVisibleCaptionText();"));
    assert.ok(captureBody.includes("text = this.readVisibleCaptionText();"));
    assert.ok(!captureBody.includes("const overlayText = this.readVisibleCaptionText();\n      let text = \"\";"));
  });

  await runCase("timeline sync is event-driven and coordinates seek focus without becoming a master loop", () => {
    assert.ok(source.includes("beginTimelineAction(action)"));
    assert.ok(source.includes("applyTimelineActionFocus(action)"));
    assert.ok(source.includes("getTimelineDisplayTime(currentTime, chunk, index)"));
    assert.ok(source.includes("maxSettledTime"));
    assert.ok(source.includes("requestTimelineSync(forceScroll)"));
    assert.ok(source.includes("commitTimelineSync(forceScroll)"));
    assert.ok(source.includes("this.requestTimelineSync(false)"));
    assert.ok(!source.includes("syncTimelineTick"));
  });
};
