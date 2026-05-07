exports.run = async function runBubbleStateTests(ctx) {
  const { assert, loadModule, runCase } = ctx;

  function loadBubbleState() {
    const module = loadModule("bubble-state.js");
    return module.bubbleState;
  }

  await runCase("bubble records preserve atomic immutable fields", () => {
    const bubbleState = loadBubbleState();
    const record = bubbleState.createBubbleRecord(
      {
        sourceId: "live-7",
        partIndex: 2,
        start: 12,
        end: 18,
        seekStart: 12.4,
        locked: true,
        text: " hello "
      },
      (value) => String(value || "").trim()
    );

    assert.equal(record.sourceId, "live-7");
    assert.equal(record.partIndex, 2);
    assert.equal(record.start, 12);
    assert.equal(record.seekStart, 12.4);
    assert.equal(record.text, "hello");
    assert.equal(record.locked, true);
    assert.equal(record.immutable, true);
  });

  await runCase("trimmed overlap advances seek start with removed text", () => {
    const bubbleState = loadBubbleState();
    const chunk = {
      start: 10,
      end: 18,
      seekStart: 10,
      text: "one two three four five six"
    };
    const trimmed = bubbleState.trimChunkAgainstPrevious(
      "zero one two three",
      chunk,
      {
        normalizeText: (value) => String(value || "").trim(),
        normalizeToken: (value) => String(value || "").toLowerCase(),
        fallbackDurationSeconds: 8
      }
    );

    assert.equal(trimmed.text, "four five six");
    assert.ok(trimmed.seekStart > chunk.seekStart);
    assert.ok(trimmed.seekStart < chunk.end);
  });

  await runCase("trim overlap handles empty and non-overlap edges", () => {
    const bubbleState = loadBubbleState();
    const options = {
      normalizeText: (value) => String(value || "").trim(),
      normalizeToken: (value) => String(value || "").toLowerCase()
    };
    assert.deepEqual(
      bubbleState.trimLeadingOverlap("", "new words", options),
      { text: "new words", removedTokens: 0, originalTokens: 2 }
    );
    assert.deepEqual(
      bubbleState.trimLeadingOverlap("alpha beta", "gamma delta", options),
      { text: "gamma delta", removedTokens: 0, originalTokens: 2 }
    );
  });

  await runCase("adjust seek start clamps invalid or excessive trim data", () => {
    const bubbleState = loadBubbleState();
    assert.equal(
      bubbleState.adjustSeekStartForTrim({ start: 4, end: 12 }, { removedTokens: 0, originalTokens: 8 }, 8),
      4
    );
    const adjusted = bubbleState.adjustSeekStartForTrim(
      { start: 4, end: 12 },
      { removedTokens: 99, originalTokens: 100 },
      8
    );
    assert.ok(adjusted > 4);
    assert.ok(adjusted < 12);
  });

  await runCase("bubble start flash is consumed once at timestamp", () => {
    const bubbleState = loadBubbleState();
    const bubble = {};

    assert.equal(bubbleState.markFlashOnStart(bubble, 42, "rewind"), true);
    assert.deepEqual(bubble.flashOnStart, { at: 42, source: "rewind", done: false });
    assert.equal(bubbleState.consumeFlashOnStart(bubble, 41.9), false);
    assert.equal(bubble.flashOnStart.done, false);
    assert.equal(bubbleState.consumeFlashOnStart(bubble, 42), true);
    assert.equal(bubble.flashOnStart.done, true);
    assert.equal(bubbleState.consumeFlashOnStart(bubble, 43), false);
  });

  await runCase("flash helpers reject invalid targets safely", () => {
    const bubbleState = loadBubbleState();
    assert.equal(bubbleState.markFlashOnStart(null, 3, "bad"), false);
    assert.equal(bubbleState.markFlashOnStart({}, NaN, "bad"), false);
    assert.equal(bubbleState.consumeFlashOnStart({}, 3), false);
  });

  await runCase("display ids are assigned only to visible text bubbles", () => {
    const bubbleState = loadBubbleState();
    const records = bubbleState.withDisplayIds([
      { id: 99, text: "first" },
      { id: 100, text: "" },
      { id: 101, text: "second" }
    ]);

    assert.equal(records.length, 2);
    assert.equal(records[0].id, 0);
    assert.equal(records[1].id, 1);
    assert.equal(records[1].text, "second");
  });
};
