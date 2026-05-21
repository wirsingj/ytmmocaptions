exports.run = async function runTimelineScrubTests(ctx) {
  const { assert, loadModule, runCase } = ctx;

  function loadTimelineScrub() {
    return loadModule("timeline-scrub.js").timelineScrub;
  }

  const chunks = [
    { start: 10, end: 14, text: "first thought" },
    { start: 20, end: 25, text: "second thought" },
    { start: 35, end: 40, text: "third thought" }
  ];

  await runCase("timeline scrub maps transcript chunk time to x position", () => {
    const scrub = loadTimelineScrub();
    assert.equal(scrub.chunkToPercent({ start: 30, end: 35, text: "middle" }, 120), 25);
  });

  await runCase("timeline scrub sorts chunks numerically and assigns stable indices", () => {
    const scrub = loadTimelineScrub();
    const sorted = scrub.sortChunks([
      { start: 30, end: 35, text: "third" },
      { start: 10, end: 15, text: "first" }
    ]);
    assert.deepEqual(sorted.map((chunk) => chunk.text), ["first", "third"]);
    assert.deepEqual(sorted.map((chunk) => chunk.timelineIndex), [0, 1]);
  });

  await runCase("timeline scrub maps hover x position back to timestamp", () => {
    const scrub = loadTimelineScrub();
    assert.equal(scrub.hoverXToTime(250, 1000, 200), 50);
    assert.equal(scrub.hoverXToTime(-20, 1000, 200), 0);
    assert.equal(scrub.hoverXToTime(1200, 1000, 200), 200);
  });

  await runCase("timeline scrub selects the active chunk inside a chunk", () => {
    const scrub = loadTimelineScrub();
    assert.equal(scrub.findChunkIndexAtTime(chunks, 22, 0.35), 1);
  });

  await runCase("timeline scrub selects nearest previous chunk between chunks", () => {
    const scrub = loadTimelineScrub();
    assert.equal(scrub.findChunkIndexAtTime(chunks, 29, 0.35), 1);
  });

  await runCase("timeline scrub applies small timing tolerance across browser rounding", () => {
    const scrub = loadTimelineScrub();
    assert.equal(scrub.findChunkIndexAtTime(chunks, 19.8, 0.35), 1);
  });

  await runCase("timeline scrub exposes previous current and next context", () => {
    const scrub = loadTimelineScrub();
    assert.deepEqual(scrub.getContextIndices(chunks, 1), [
      { index: 0, role: "previous" },
      { index: 1, role: "current" },
      { index: 2, role: "next" }
    ]);
  });

  await runCase("timeline scrub clamps bubble position inside video frame", () => {
    const scrub = loadTimelineScrub();
    assert.equal(scrub.clampBubbleLeft(5, 200, 500, 8), 8);
    assert.equal(scrub.clampBubbleLeft(495, 200, 500, 8), 292);
  });

  await runCase("timeline scrub samples dense chunks instead of rendering all bubbles", () => {
    const scrub = loadTimelineScrub();
    const dense = Array.from({ length: 400 }, (_, index) => ({ start: index, end: index + 1, text: "cue " + index }));
    const sampled = scrub.sampleMarkerChunks(dense, 100);
    assert.ok(sampled.length <= 100);
    assert.equal(sampled[1].index, 4);
    assert.equal(sampled[1].clustered, true);
  });
};
