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
      { start: 0, end: 1, text: "A".repeat(80) },
      { start: 1.05, end: 2, text: "B".repeat(80) },
      { start: 2.05, end: 3, text: "C".repeat(80) }
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
};
