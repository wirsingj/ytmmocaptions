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

  await runCase("trimmed overlap drops stale token timings before live chunks merge", () => {
    const bubbleState = loadBubbleState();
    const chunk = {
      start: 10,
      end: 15,
      seekStart: 10,
      text: "one two three four five",
      tokens: [
        { text: "one", start: 10, end: 11 },
        { text: "two", start: 11, end: 12 },
        { text: "three", start: 12, end: 13 },
        { text: "four", start: 13, end: 14 },
        { text: "five", start: 14, end: 15 }
      ]
    };
    const trimmed = bubbleState.trimChunkAgainstPrevious(
      "zero one two three",
      chunk,
      {
        normalizeText: (value) => String(value || "").trim(),
        normalizeToken: (value) => String(value || "").toLowerCase(),
        fallbackDurationSeconds: 4
      }
    );

    assert.equal(trimmed.text, "four five");
    assert.deepEqual(trimmed.tokens.map((token) => token.text), ["four", "five"]);
    assert.equal(trimmed.seekStart, 13);
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

  await runCase("reading glow range advances deterministically through phrase windows", () => {
    const bubbleState = loadBubbleState();
    const bubble = {
      start: 10,
      end: 18,
      seekStart: 10,
      text: "one two three four five six seven eight"
    };

    const early = bubbleState.getReadingGlowRange(bubble, 10.1);
    const middle = bubbleState.getReadingGlowRange(bubble, 14);
    const late = bubbleState.getReadingGlowRange(bubble, 17.9);

    assert.equal(early.firstWord, 0);
    assert.ok(middle.firstWord > early.firstWord);
    assert.ok(late.firstWord >= middle.firstWord);
    assert.ok(late.lastWord <= 7);
  });

  await runCase("reading glow uses a readable rolling phrase window for rapid text", () => {
    const bubbleState = loadBubbleState();
    const bubble = {
      start: 0,
      end: 3,
      text: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen"
    };
    const range = bubbleState.getReadingGlowRange(bubble, 1.5);
    assert.ok(range.lastWord - range.firstWord + 1 <= 6);
    assert.ok(range.lastWord - range.firstWord + 1 >= 3);
  });

  await runCase("reading glow covers about three or more words by default", () => {
    const bubbleState = loadBubbleState();
    const bubble = {
      start: 0,
      end: 8,
      text: "one two three four five six seven eight"
    };
    const range = bubbleState.getReadingGlowRange(bubble, 1);
    assert.ok(range.lastWord - range.firstWord + 1 >= 3);
  });

  await runCase("reading glow centers around the estimated spoken word instead of leading ahead", () => {
    const bubbleState = loadBubbleState();
    const bubble = {
      start: 0,
      end: 10,
      text: "zero one two three four five six seven eight nine"
    };
    const range = bubbleState.getReadingGlowRange(bubble, 5, { leadSeconds: 0, windowWords: 5 });
    assert.ok(range.firstWord <= 5);
    assert.ok(range.lastWord >= 5);
    assert.equal(range.firstWord, 3);
    assert.equal(range.lastWord, 7);
  });

  await runCase("reading glow split preserves text without layout-side mutations", () => {
    const bubbleState = loadBubbleState();
    const text = "alpha beta gamma delta";
    const range = bubbleState.getReadingGlowRange({ start: 0, end: 4, text }, 2);
    const parts = bubbleState.splitTextByRange(text, range);
    assert.equal(parts.map((part) => part.text).join(""), text);
    assert.equal(parts.filter((part) => part.active).length, 1);
  });

  await runCase("reading glow can lead the playback position to avoid visual lag", () => {
    const bubbleState = loadBubbleState();
    const bubble = {
      start: 0,
      end: 8,
      text: "one two three four five six seven eight"
    };
    const noLead = bubbleState.getReadingGlowRange(bubble, 3, { leadSeconds: 0 });
    const withLead = bubbleState.getReadingGlowRange(bubble, 3, { leadSeconds: 1 });
    assert.ok(withLead.firstWord > noLead.firstWord);
  });

  await runCase("reading glow caps suspicious speech rates instead of sprinting to the end", () => {
    const bubbleState = loadBubbleState();
    const bubble = {
      start: 0,
      end: 4,
      text: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty"
    };
    const range = bubbleState.getReadingGlowRange(bubble, 3.5, { leadSeconds: 0 });
    assert.ok(range.firstWord < 18);
  });

  await runCase("reading glow gives sentence endings a little timeline weight", () => {
    const bubbleState = loadBubbleState();
    const plain = {
      start: 0,
      end: 8,
      text: "one two three four five six seven eight"
    };
    const punctuated = {
      start: 0,
      end: 8,
      text: "one two three. four five six seven eight"
    };
    const plainRange = bubbleState.getReadingGlowRange(plain, 4, { leadSeconds: 0 });
    const punctuatedRange = bubbleState.getReadingGlowRange(punctuated, 4, { leadSeconds: 0 });
    assert.ok(punctuatedRange.firstWord <= plainRange.firstWord);
  });

  await runCase("reading glow uses explicit token timestamps when available", () => {
    const bubbleState = loadBubbleState();
    const bubble = {
      start: 10,
      end: 14,
      seekStart: 10,
      text: "alpha beta gamma delta",
      tokens: [
        { text: "alpha", start: 10, end: 11 },
        { text: "beta", start: 11, end: 12 },
        { text: "gamma", start: 12, end: 13 },
        { text: "delta", start: 13, end: 14 }
      ]
    };
    const early = bubbleState.getReadingGlowRange(bubble, 10.2, { leadSeconds: 0, windowWords: 3 });
    const late = bubbleState.getReadingGlowRange(bubble, 12.2, { leadSeconds: 0, windowWords: 3 });

    assert.equal(early.firstWord, 0);
    assert.equal(late.firstWord, 1);
    assert.equal(late.lastWord, 3);
  });

  await runCase("token reading glow centers on the spoken word instead of starting ahead", () => {
    const bubbleState = loadBubbleState();
    const bubble = {
      start: 0,
      end: 6,
      seekStart: 0,
      text: "zero one two three four five",
      tokens: [
        { text: "zero", start: 0, end: 1 },
        { text: "one", start: 1, end: 2 },
        { text: "two", start: 2, end: 3 },
        { text: "three", start: 3, end: 4 },
        { text: "four", start: 4, end: 5 },
        { text: "five", start: 5, end: 6 }
      ]
    };
    const range = bubbleState.getReadingGlowRange(bubble, 3.2, { leadSeconds: 0, windowWords: 3 });
    assert.equal(range.firstWord, 2);
    assert.equal(range.lastWord, 4);
  });

  await runCase("reading glow matches token text to rendered words after small drift", () => {
    const bubbleState = loadBubbleState();
    const bubble = {
      start: 0,
      end: 4,
      seekStart: 0,
      text: "well alpha beta gamma delta",
      tokens: [
        { text: "alpha", start: 0, end: 1 },
        { text: "beta", start: 1, end: 2 },
        { text: "gamma", start: 2, end: 3 },
        { text: "delta", start: 3, end: 4 }
      ]
    };
    const range = bubbleState.getReadingGlowRange(bubble, 2.2, { leadSeconds: 0, windowWords: 3 });

    assert.equal(range.firstWord, 2);
    assert.equal(range.lastWord, 4);
  });

  await runCase("token reading glow walks repeated words forward without snapping back", () => {
    const bubbleState = loadBubbleState();
    const bubble = {
      start: 0,
      end: 8,
      seekStart: 0,
      text: "we can test and we can ship and we can learn",
      tokens: [
        { text: "we", start: 0, end: 0.6 },
        { text: "can", start: 0.6, end: 1.2 },
        { text: "test", start: 1.2, end: 1.8 },
        { text: "and", start: 1.8, end: 2.4 },
        { text: "we", start: 2.4, end: 3.0 },
        { text: "can", start: 3.0, end: 3.6 },
        { text: "ship", start: 3.6, end: 4.2 },
        { text: "and", start: 4.2, end: 4.8 },
        { text: "we", start: 4.8, end: 5.4 },
        { text: "can", start: 5.4, end: 6.0 },
        { text: "learn", start: 6.0, end: 6.6 }
      ]
    };
    const middle = bubbleState.getReadingGlowRange(bubble, 3.1, { leadSeconds: 0, windowWords: 3 });
    const late = bubbleState.getReadingGlowRange(bubble, 5.0, { leadSeconds: 0, windowWords: 3 });

    assert.equal(middle.firstWord, 4);
    assert.equal(middle.lastWord, 6);
    assert.equal(late.firstWord, 7);
    assert.equal(late.lastWord, 9);
  });
};
