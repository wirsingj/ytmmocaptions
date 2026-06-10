const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");

exports.run = async function runLiveBubbleTests(ctx) {
  const { assert, runCase } = ctx;
  const source = fs.readFileSync(path.join(ROOT_DIR, "src", "content-script.js"), "utf8");

  await runCase("live bubble thresholds prevent paragraph-sized unlocked bubbles", () => {
    assert.ok(source.includes("CONVERSATIONAL_CHUNKING.live"));
    assert.ok(source.includes("bucketCount >= limits.maxBucketsWithoutSentence"));
    assert.ok(source.includes("previousLength >= limits.comfortableChars"));
    assert.ok(source.includes("combined.length >= limits.hardChars"));
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
    assert.ok(method.includes("previousLength >= 160"));
    assert.ok(method.includes("combined.length >= limits.lyricChars"));
  });

  await runCase("tiny complete live thoughts merge instead of fragmenting into subtitle bubbles", () => {
    const method = source.slice(
      source.indexOf("shouldStartNewLiveBubble(previousChunk, nextChunk)"),
      source.indexOf("getLiveChunkBucketIndex(chunk)")
    );
    assert.ok(method.includes("shouldMergeTinyCompleteThought"));
    assert.ok(method.includes("previousLength < limits.tinyFragmentChars"));
    assert.ok(method.includes("return false;"));
  });

  await runCase("locked display bubbles use bounded natural splits and preserve seek starts", () => {
    const start = source.indexOf("    createLockedDisplayBubbles(bubble)");
    const method = source.slice(
      start,
      source.indexOf("    rebuildChunks()", start)
    );
    assert.ok(method.includes("const maxLiveBubbleChars = 300"));
    assert.ok(method.includes("splitTextByNaturalBreaks(text, maxLiveBubbleChars, false)"));
    assert.ok(method.includes("seekStart: alignedStart"));
    assert.ok(method.includes("locked: true"));
    const polishStart = source.indexOf("    polishLiveBubbles(bubbles)");
    const polishMethod = source.slice(
      polishStart,
      source.indexOf("    createLockedDisplayBubbles(bubble)", polishStart)
    );
    assert.ok(polishMethod.includes("const originalSeekStart = Number(part.seekStart);"));
    assert.ok(polishMethod.includes("seekStart: seekStart"));
    assert.ok(!polishMethod.includes("seekStart: start,"));
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
    const captureStart = source.indexOf("    captureLiveCaptionLine()");
    const captureBody = source.slice(captureStart, source.indexOf("    pickPreferredTrack(tracklist)", captureStart));
    assert.ok(captureBody.includes("const overlaySuppressed = Date.now() < Number(this.liveCaptureSuppressedUntil || 0);"));
    assert.ok(!captureBody.includes("if (Date.now() < Number(this.liveCaptureSuppressedUntil || 0)) {\n        return;\n      }"));
    assert.ok(captureBody.includes("if (!overlaySuppressed)"));
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

  await runCase("close restores YouTube captions when MMOCC enabled them", () => {
    const probeStart = source.indexOf("    probeCaptionsNow()");
    const probeBody = source.slice(probeStart, source.indexOf("    isSubtitlesEnabled()", probeStart));
    const restoreStart = source.indexOf("    restoreSubtitlesIfExtensionEnabled()");
    const restoreBody = source.slice(restoreStart, source.indexOf("    ensureCaptionsEnabledOnce()", restoreStart));
    const ensureStart = source.indexOf("    ensureCaptionsEnabledOnce()");
    const ensureBody = source.slice(ensureStart, source.indexOf("    startCaptionEnsureLoop()", ensureStart));

    assert.ok(source.includes("captureInitialSubtitleState()"));
    assert.ok(probeBody.includes("this.captureInitialSubtitleState();"));
    assert.ok(probeBody.includes("this.captionsEnabledByExtension = true;"));
    assert.ok(ensureBody.includes("this.captureInitialSubtitleState();"));
    assert.ok(ensureBody.includes("this.captionsEnabledByExtension = true;"));
    assert.ok(restoreBody.includes("const subtitlesWereOff = this.captionsWereOnBeforeExtension === false;"));
    assert.ok(restoreBody.includes("this.setSubtitlesEnabled(false);"));
    assert.ok(restoreBody.includes("this.captionsWereOnBeforeExtension = null;"));
    assert.ok(restoreBody.includes("this.captionsEnsured = false;"));
    assert.ok(restoreBody.includes("this.captionEnsureStarted = false;"));
  });

  await runCase("caption probing does not change YouTube's selected caption language", () => {
    const pickStart = source.indexOf("    pickPreferredTrack(tracklist)");
    const pickBody = source.slice(pickStart, source.indexOf("    probeCaptionsNow()", pickStart));
    const snapshotStart = source.indexOf("    readTextTrackSnapshotAtCurrentTime()");
    const snapshotBody = source.slice(snapshotStart, source.indexOf("    createCueTokensFromText", snapshotStart));
    const windowStart = source.indexOf("    readTextTrackWindowSnapshot(bucketIndex)");
    const windowBody = source.slice(windowStart, source.indexOf("    getLiveWindowSeconds()", windowStart));

    assert.ok(source.includes("getPreferredLanguageCodes()"));
    assert.ok(source.includes("navigator.languages"));
    assert.ok(source.includes("isTranslatedCaptionTrack(track)"));
    assert.ok(pickBody.includes("return this.getPreferredCaptionTracks(tracklist)[0] || null;"));
    assert.ok(!source.includes("setOption(\"captions\", \"track\""));
    assert.ok(!source.includes("setOption(\"captions\", \"reload\""));
    assert.ok(snapshotBody.includes("const tracks = this.getPreferredCaptionTracks(Array.from(this.video.textTracks));"));
    assert.ok(snapshotBody.includes("return {"));
    assert.ok(windowBody.includes("const tracks = this.getPreferredCaptionTracks(Array.from(this.video.textTracks));"));
    assert.ok(windowBody.includes("continue;"));
  });

  await runCase("transcript heartbeat recovers an open panel without becoming an unbounded poll loop", () => {
    assert.ok(source.includes("MAX_TRANSCRIPT_RECOVERY_ATTEMPTS = 3"));
    assert.ok(source.includes("scheduleTranscriptHeartbeatCheck(reason, delayMs)"));
    assert.ok(source.includes("checkTranscriptHeartbeat(reason)"));
    assert.ok(source.includes("recoverTranscriptActivity(reason)"));
    assert.ok(source.includes("this.transcriptRecoveryAttempts += 1;"));
    assert.ok(source.includes("this.transcriptRecoveryAttempts >= MAX_TRANSCRIPT_RECOVERY_ATTEMPTS"));
    assert.ok(source.includes("MAX_TRANSCRIPT_HEARTBEAT_READINESS_DEFERRALS = 20"));
    assert.ok(source.includes("isTranscriptHeartbeatExhausted()"));
    assert.ok(source.includes("TRANSCRIPT_HEARTBEAT_RECHECK_MS"));
    assert.ok(source.includes("window.setTimeout(() =>"));
    assert.ok(!source.includes("transcriptHeartbeatPollId"));
  });

  await runCase("heartbeat recovery nudges caption ingestion without clearing existing live bubbles", () => {
    const recoverStart = source.indexOf("    recoverTranscriptActivity(reason)");
    const recoverBody = source.slice(
      recoverStart,
      source.indexOf("    nudgeCaptionWork(reason)", recoverStart)
    );
    assert.ok(recoverBody.includes("this.ensurePageBridgeForWatchPage();"));
    assert.ok(recoverBody.includes("this.ensureCaptionsEnabledOnce();"));
    assert.ok(recoverBody.includes("this.probeCaptionsNow();"));
    assert.ok(recoverBody.includes("if (!this.liveCaptureEnabled)"));
    assert.ok(recoverBody.includes("this.startLiveCapturePolling();"));
    assert.ok(recoverBody.includes("this.captureLiveCaptionLine();"));
    assert.ok(recoverBody.includes("if (!this.transcriptLoadInFlight)"));
    assert.ok(recoverBody.includes("this.loadTranscript();"));
    assert.ok(!recoverBody.includes("this.liveBubbles = []"));
    assert.ok(!recoverBody.includes("this.liveBucketToBubble = new Map()"));
  });

  await runCase("reopening the pill refreshes YouTube caption state and reuses unchanged transcripts", () => {
    const startWorkStart = source.indexOf("    async startCaptionWork()");
    const resumeBody = source.slice(
      source.indexOf("if (this.captionWorkStarted)", startWorkStart),
      source.indexOf("this.captionWorkStarted = true;", startWorkStart)
    );
    const openStart = source.indexOf("if (changedPanelClosed && !isClosed)");
    const openBranch = source.slice(openStart, source.indexOf("    persistSettings", openStart));

    assert.ok(source.includes("async refreshCaptionSnapshot()"));
    assert.ok(source.includes("pageContext.requestSnapshot(650)"));
    assert.ok(source.includes("lastCaptionPreferenceKey"));
    assert.ok(source.includes("getCaptionPreferenceKeyFromSnapshot(snapshot)"));
    assert.ok(resumeBody.includes("await this.refreshCaptionSnapshot();"));
    assert.ok(resumeBody.includes("const shouldReloadForPreference"));
    assert.ok(resumeBody.includes("nextPreferenceKey !== this.lastCaptionPreferenceKey"));
    assert.ok(resumeBody.includes("if (shouldReloadForPreference)"));
    assert.ok(resumeBody.includes("if (!shouldReloadForPreference)"));
    assert.ok(resumeBody.includes("this.startCaptionEnsureLoop();"));
    assert.ok(resumeBody.includes("await this.loadTranscript();"));
    assert.ok(resumeBody.indexOf("if (!shouldReloadForPreference)") < resumeBody.indexOf("this.ensureCaptionsEnabledOnce();"));
    assert.ok(resumeBody.indexOf("return;") < resumeBody.indexOf("this.enableLiveCaptureMode();"));
    assert.ok(openBranch.includes("this.startCaptionWork();"));
  });

  await runCase("same-video route and tab restore events nudge heartbeat for old open panels", () => {
    const routeStart = source.indexOf("    async reconcileRoute()");
    const routeBody = source.slice(routeStart, source.indexOf("    teardownApp()", routeStart));
    assert.ok(source.includes("nudgeCaptionWork(reason)"));
    assert.ok(routeBody.includes("this.app.nudgeCaptionWork"));
    assert.ok(routeBody.includes("\"route-still-active\""));
    assert.ok(source.includes("this.scheduleTranscriptHeartbeatCheck(reason || \"nudge\""));
    const nudgeStart = source.indexOf("    nudgeCaptionWork(reason)");
    const nudgeBody = source.slice(nudgeStart, source.indexOf("    isChunkIndexAlignedWithTime", nudgeStart));
    assert.ok(nudgeBody.includes("this.hasTranscriptActivity() || this.transcriptHeartbeatTimerId || this.isTranscriptHeartbeatExhausted()"));
    assert.ok(nudgeBody.indexOf("return;") < nudgeBody.indexOf("this.ensureCaptionsEnabledOnce();"));
  });

  await runCase("video sync listeners are rebound and cleaned when YouTube swaps video elements", () => {
    assert.ok(source.includes("this.videoCleanupFns = [];"));
    assert.ok(source.includes("this.boundVideo = null;"));
    assert.ok(source.includes("if (this.boundVideo === this.video)"));
    assert.ok(source.includes("const boundVideo = this.video;"));
    assert.ok(source.includes('boundVideo.addEventListener("seeking", onSeeking)'));
    assert.ok(source.includes('boundVideo.removeEventListener("seeking", onSeeking)'));
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

  await runCase("route changes wait for pending settings writes before reloading panel", () => {
    const routeStart = source.indexOf("    async reconcileRoute()");
    const routeBody = source.slice(routeStart, source.indexOf("    teardownApp()", routeStart));
    assert.ok(routeBody.includes("settingsStore.flush"));
    assert.ok(routeBody.indexOf("await settingsStore.flush()") < routeBody.indexOf("new DialogueCaptionsApp(videoId)"));
  });

  await runCase("panel open state is snapshotted on teardown and page hide", () => {
    assert.ok(source.includes("persistPanelSnapshot()"));
    const destroyStart = source.indexOf("    destroy()");
    const destroyBody = source.slice(destroyStart, source.indexOf("    ensurePageBridgeForWatchPage()", destroyStart));
    assert.ok(destroyBody.includes("this.persistPanelSnapshot();"));
    assert.ok(source.includes('window.addEventListener("pagehide", onPageHide)'));
    assert.ok(source.includes('window.addEventListener("beforeunload", onPageHide)'));
    assert.ok(source.includes("persistActivePanelState()"));
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

  await runCase("overlay-only live capture requires current caption context", () => {
    assert.ok(source.includes("hasLiveCaptionContext()"));
    assert.ok(source.includes("isSubtitleButtonAvailable()"));
    const captureStart = source.indexOf("    captureLiveCaptionLine()");
    const captureBody = source.slice(captureStart, source.indexOf("    pickPreferredTrack(tracklist)", captureStart));
    assert.ok(captureBody.includes("if (text && !this.hasLiveCaptionContext())"));
    assert.ok(captureBody.includes("captions:overlay-only-ignored"));
  });

  await runCase("timeline sync is event-driven and coordinates seek focus without becoming a master loop", () => {
    assert.ok(source.includes("beginTimelineAction(action)"));
    assert.ok(source.includes("applyTimelineActionFocus(action)"));
    assert.ok(source.includes("getTimelineDisplayTime(currentTime, chunk, index)"));
    assert.ok(source.includes("findPlaybackActiveIndex(chunks, currentTime)"));
    assert.ok(source.includes("const startTolerance = 0.08;"));
    assert.ok(source.includes("maxSettledTime"));
    assert.ok(source.includes("requestTimelineSync(forceScroll)"));
    assert.ok(source.includes("commitTimelineSync(forceScroll)"));
    assert.ok(source.includes("this.requestTimelineSync(false)"));
    assert.ok(!source.includes("syncTimelineTick"));
  });

  await runCase("space forward chooses and reveals a destination bubble instead of losing focus", () => {
    assert.ok(source.includes("findShortcutFocusIndex(chunks, targetTime, isBackward)"));
    assert.ok(source.includes("this.findPlaybackActiveIndex(chunks, target)"));
    assert.ok(source.includes("canRunShortcutSeek(video)"));
    assert.ok(source.includes("isYouTubeAdPlaybackActive()"));
    assert.ok(source.includes("const visibleActiveIndex = Number.isInteger(this.activeIndex) ? this.activeIndex : -1;"));
    assert.ok(source.includes("this.isChunkIndexAlignedWithTime(sourceChunks, visibleActiveIndex, now)"));
    assert.ok(source.includes("!isBackward && this.isChunkIndexAlignedWithTime(sourceChunks, focusIndex, rawTarget)"));
    assert.ok(source.includes('source: isBackward ? "rewind" : "forward"'));
    assert.ok(source.includes("this.applyTimelineActionFocus(action);"));
  });

  await runCase("seek focus does not mark a bubble active before its speech anchor", () => {
    const focusStart = source.indexOf("    applyTimelineActionFocus(action)");
    const focusBody = source.slice(focusStart, source.indexOf("    getTimelineDisplayTime", focusStart));
    assert.ok(focusBody.includes("seekStart - 0.55"));
    assert.ok(!focusBody.includes("this.activeIndex = action.index;"));
    assert.ok(!focusBody.includes("this.panel.setActiveIndex(action.index"));

    const activeStart = source.indexOf("    findPlaybackActiveIndex(chunks, currentTime)");
    const activeBody = source.slice(activeStart, source.indexOf("    updateFuturePreviewChunks()", activeStart));
    assert.ok(activeBody.includes("this.getChunkActiveStart(source[candidate])"));
    assert.ok(activeBody.includes("this.getChunkActiveStart(chunk)"));
    assert.ok(activeBody.includes("this.getChunkActiveStart(source[index + 1])"));
  });

  await runCase("future caption previews use the full transcript timeline when available", () => {
    const futureMethod = source.slice(
      source.indexOf("    getFuturePreviewChunks(activeTimelineIndex)"),
      source.indexOf("    findTimelineChunkIndex(chunks, currentTime, toleranceSeconds)")
    );
    const liveFallbackMethod = source.slice(
      source.indexOf("    readFuturePreviewChunksFromTextTracks(currentBucketIndex)"),
      source.indexOf("    shouldContinueOverlayUtterance(previousCanonical, nextCanonical)")
    );
    assert.ok(source.includes("getFuturePreviewChunks(activeTimelineIndex)"));
    assert.ok(source.includes("findTimelineChunkIndex(chunks, currentTime, toleranceSeconds)"));
    assert.ok(source.includes("readFuturePreviewChunksFromTextTracks(currentBucketIndex)"));
    assert.ok(source.includes("this.settings.futurePreviewEnabled === false"));
    assert.ok(liveFallbackMethod.includes("offset <= 4"));
    assert.ok(source.includes("getFuturePreviewSignature(activeTimelineIndex)"));
    assert.ok(source.includes("signature === this.futurePreviewSignature"));
    assert.ok(source.includes("this.futurePreviewSignature = signature"));
    assert.ok(source.includes("this.updateFuturePreviewChunks(nextIndex)"));
    assert.ok(futureMethod.includes("transcriptSource.slice(previewStart).map"));
    assert.ok(futureMethod.includes("for (let index = previewStart; index < this.allChunks.length; index += 1)"));
    assert.ok(futureMethod.includes("futurePreviewOnly"));
    assert.ok(futureMethod.includes("currentIndex + 1"));
    assert.ok(futureMethod.includes("actualIndex: index"));
    assert.ok(!futureMethod.includes("transcriptSource.slice(previewStart, previewStart + 4)"));
    assert.ok(!futureMethod.includes("previewStart + 4"));
    assert.ok(source.includes("setFutureChunks(this.getFuturePreviewChunks(activeTimelineIndex))"));
  });

  await runCase("full transcript timelines use conversational chunks instead of keyboard skip buckets", () => {
    const rebuildStart = source.indexOf("    rebuildChunks()");
    const rebuildBody = source.slice(
      rebuildStart,
      source.indexOf("    onSettingsChanged(nextSettings, patch)", rebuildStart)
    );
    assert.ok(source.includes("buildTranscriptChunksFromCues(cues)"));
    assert.ok(rebuildBody.includes("? this.buildFixedWindowChunksFromCues(this.cues)"));
    assert.ok(rebuildBody.includes(": this.buildTranscriptChunksFromCues(this.cues);"));
    assert.ok(rebuildBody.includes(": rawChunks;"));
    assert.ok(!rebuildBody.includes(": this.polishFixedWindowChunks(rawChunks);"));
  });

  await runCase("live fallback periodically upgrades to full transcript for future previews", () => {
    assert.ok(source.includes("maybeUpgradeLiveCaptureToTranscript()"));
    assert.ok(source.includes("tryUpgradeLiveCaptureToTranscript()"));
    assert.ok(source.includes("this.transcriptUpgradeAttempts >= 8"));
    assert.ok(source.includes("Full caption timeline loaded. Next up previews are available."));
    assert.ok(source.includes("this.disableLiveCaptureMode();"));
  });

  await runCase("panel seek callback forwards options for latest jump", () => {
    assert.ok(source.includes("onSeek: (target, options) => this.seekToChunk(target, options)"));
  });

  await runCase("unavailable transcript clears stale current future and timeline state", () => {
    const failureStart = source.indexOf("if (!response || !response.ok)");
    const failureBody = source.slice(failureStart, source.indexOf("if (response.videoId !== this.videoId)", failureStart));
    const clearStart = source.indexOf("    clearCaptionStateForUnavailableVideo()");
    const clearBody = source.slice(clearStart, source.indexOf("    requestTimelineSync", clearStart));
    assert.ok(failureBody.includes("this.clearCaptionStateForUnavailableVideo();"));
    assert.ok(failureBody.includes("!this.cues.length || !this.hasLiveCaptionContext()"));
    assert.ok(clearBody.includes("this.cues = [];"));
    assert.ok(clearBody.includes("this.panel.setChunks([]);"));
    assert.ok(clearBody.includes("this.panel.setFutureChunks([]);"));
    assert.ok(clearBody.includes("this.panel.setTimelineData([], Number.NaN);"));
    assert.ok(clearBody.includes("this.panel.setActiveIndex(-1);"));
    assert.ok(clearBody.includes("this.panel.setPlaybackTime(0, { forceGlowReset: true });"));
  });
};
