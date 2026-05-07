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
    assert.ok(source.includes("collapseRepeatedCaptionPhrases"));
    assert.ok(source.includes("collapseRepeatedCaptionSentences"));
    assert.ok(source.includes("mergeLiveCaptionText"));
    assert.ok(source.includes("trimLiveChunkAgainstPrevious"));
  });

  await runCase("quick seek state keeps locked bubbles and flash markers separate", () => {
    assert.ok(source.includes("this.liveDisplayBubbleCache"));
    assert.ok(source.includes("bubbleState.markFlashOnStart"));
    assert.ok(source.includes("bubbleState.consumeFlashOnStart"));
    assert.ok(source.includes("handleDiscontinuousTimeMove"));
  });

  await runCase("clicking or rewinding suppresses stale overlay capture during seek settle", () => {
    assert.ok(source.includes("liveCaptureSuppressedUntil"));
    assert.ok(source.includes("suppressLiveCaptureForSeek(this.timelineAction.targetTime)"));
    assert.ok(source.includes("Date.now() < Number(this.liveCaptureSuppressedUntil || 0)"));
  });

  await runCase("timeline sync is event-driven and coordinates seek focus without becoming a master loop", () => {
    assert.ok(source.includes("beginTimelineAction(action)"));
    assert.ok(source.includes("applyTimelineActionFocus(action)"));
    assert.ok(source.includes("requestTimelineSync(forceScroll)"));
    assert.ok(source.includes("commitTimelineSync(forceScroll)"));
    assert.ok(source.includes("this.requestTimelineSync(false)"));
    assert.ok(!source.includes("syncTimelineTick"));
  });
};
