exports.run = async function runChunkerRegressionTests(ctx) {
  const { assert, loadModule, runCase } = ctx;
  const chunker = loadModule("chunker.js").chunker;

  await runCase("findChunkIndexAtTime handles sparse starts predictably", () => {
    const chunks = [
      { start: 0, end: 8, text: "a" },
      { start: 16, end: 24, text: "b" },
      { start: 32, end: 40, text: "c" }
    ];
    assert.equal(chunker.findChunkIndexAtTime(chunks, 0), 0);
    assert.equal(chunker.findChunkIndexAtTime(chunks, 7.9), 0);
    assert.equal(chunker.findChunkIndexAtTime(chunks, 8.1), 0);
    assert.equal(chunker.findChunkIndexAtTime(chunks, 16), 1);
    assert.equal(chunker.findChunkIndexAtTime(chunks, 33), 2);
  });

  await runCase("findChunkIndexAtTime returns no chunk before the first start", () => {
    const chunks = [{ start: 10, end: 18, text: "first" }];
    assert.equal(chunker.findChunkIndexAtTime(chunks, 9.99), -1);
  });

  await runCase("pause boundary resets stale hard and sentence checks before adding new cue", () => {
    const cues = [
      { start: 0, end: 1, text: "This sentence is comfortably long and ends now." },
      { start: 2.5, end: 3, text: "Short." },
      { start: 3.1, end: 4, text: "Continues after pause." }
    ];
    const chunks = chunker.chunkCues(cues, "short");
    assert.equal(chunks.length, 2);
    assert.equal(chunks[1].text, "Short. Continues after pause.");
  });

  await runCase("findChunkIndexAtTime clamps to last known chunk after tail", () => {
    const chunks = [
      { start: 0, end: 8, text: "a" },
      { start: 8, end: 16, text: "b" },
      { start: 16, end: 24, text: "c" }
    ];
    assert.equal(chunker.findChunkIndexAtTime(chunks, 24), 2);
    assert.equal(chunker.findChunkIndexAtTime(chunks, 999), 2);
  });

  await runCase("formatTimestamp stays stable for minute and hour ranges", () => {
    assert.equal(chunker.formatTimestamp(5), "0:05");
    assert.equal(chunker.formatTimestamp(65), "1:05");
    assert.equal(chunker.formatTimestamp(3661), "1:01:01");
  });
};
