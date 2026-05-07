exports.run = async function runNavigationTests(ctx) {
  const { assert, loadModule, runCase } = ctx;
  const chunker = loadModule("chunker.js").chunker;

  await runCase("navigation moves forward and backward correctly", () => {
    assert.equal(chunker.moveIndex(2, 1, 6), 3);
    assert.equal(chunker.moveIndex(2, -1, 6), 1);
    assert.equal(chunker.moveIndex(0, 2, 6), 2);
  });

  await runCase("navigation prevents underflow and overflow", () => {
    assert.equal(chunker.moveIndex(0, -1, 5), 0);
    assert.equal(chunker.moveIndex(4, 1, 5), 4);
    assert.equal(chunker.moveIndex(99, 1, 5), 4);
  });

  await runCase("navigation handles boundary and empty states", () => {
    assert.equal(chunker.moveIndex(0, 1, 0), -1);
    assert.equal(chunker.moveIndex(0, 1, -2), -1);
    assert.equal(chunker.moveIndex(0, 0, 1), 0);
  });
};
