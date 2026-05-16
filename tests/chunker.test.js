exports.run = async function runChunkerTests(ctx) {
  const { assert, loadModule, readFixture, runCase } = ctx;
  const chunker = loadModule("chunker.js").chunker;

  await runCase("chunker groups cues into readable chunks", () => {
    const cues = readFixture("cues-basic.json");
    const chunks = chunker.chunkCues(cues, "short");

    assert.equal(chunks.length, 2);
    assert.ok(chunks[0].text.includes("Welcome to the city."));
    assert.equal(chunks[1].text, "Good luck!");
  });

  await runCase("chunker splits long cue streams by max length", () => {
    const cues = [
      { start: 0, end: 1, text: "A".repeat(120) },
      { start: 1.05, end: 2, text: "B".repeat(120) },
      { start: 2.05, end: 3, text: "C".repeat(120) }
    ];
    const chunks = chunker.chunkCues(cues, "short");

    assert.equal(chunks.length, 2);
    assert.ok(chunks[0].text.includes("A"));
    assert.ok(chunks[1].text.includes("C"));
  });

  await runCase("chunker handles empty and edge input safely", () => {
    assert.deepEqual(chunker.chunkCues([], "short"), []);
    assert.equal(chunker.findChunkIndexAtTime([], 1.5), -1);
    assert.equal(chunker.findChunkIndexAtTime([{ start: 10, end: 12, text: "x" }], 1), -1);
    assert.equal(chunker.findChunkIndexAtTime([{ start: 10, end: 12, text: "x" }], 10), 0);
  });

  await runCase("chunker merges tiny fragments into a conversational thought", () => {
    const cues = [
      { start: 0, end: 0.8, text: "I mean" },
      { start: 0.9, end: 1.6, text: "that's the thing" },
      { start: 1.7, end: 2.5, text: "it felt weird" },
      { start: 2.6, end: 3.4, text: "but it worked." }
    ];
    const chunks = chunker.chunkCues(cues, "short");

    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].text, "I mean that's the thing it felt weird but it worked.");
  });

  await runCase("chunker respects long conversational pauses", () => {
    const cues = [
      { start: 0, end: 1, text: "That was a complete thought." },
      { start: 4, end: 5, text: "Here is the next one." }
    ];
    const chunks = chunker.chunkCues(cues, "short");

    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].reason, "upcoming-hard-pause");
  });

  await runCase("chunker prefers sentence boundaries once a thought is substantial", () => {
    const cues = [
      { start: 0, end: 3.5, text: "This opening idea has enough detail to feel like a real message in the chat log." },
      { start: 3.6, end: 7.3, text: "It keeps going with another related sentence that belongs nearby and finishes the thought." },
      { start: 7.4, end: 9, text: "Now we are starting a different point for the viewer." }
    ];
    const chunks = chunker.chunkCues(cues, "short");

    assert.equal(chunks.length, 2);
    assert.ok(chunks[0].text.endsWith("finishes the thought."));
    assert.equal(chunks[0].reason, "sentence-target");
  });

  await runCase("chunker stabilizes rapid-fire fragments without desyncing starts", () => {
    const cues = [
      { start: 10, end: 10.4, text: "look" },
      { start: 10.45, end: 10.8, text: "at this" },
      { start: 10.85, end: 11.2, text: "tiny" },
      { start: 11.25, end: 11.7, text: "little thing" },
      { start: 11.75, end: 12.3, text: "right here." }
    ];
    const chunks = chunker.chunkCues(cues, "short");

    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].start, 10);
    assert.equal(chunks[0].end, 12.3);
    assert.ok(chunks[0].metrics.cueCount >= 5);
  });
};
