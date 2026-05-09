exports.run = async function runCaptionTextTests(ctx) {
  const { assert, loadModule, runCase } = ctx;

  function loadCaptionText() {
    return loadModule("caption-text.js").captionText;
  }

  await runCase("caption text removes YouTube overlay chrome", () => {
    const captionText = loadCaptionText();
    assert.equal(
      captionText.cleanCandidate("English (auto-generated) Click for settings Hello there"),
      "Hello there"
    );
    assert.equal(captionText.cleanCandidate("CC"), "");
  });

  await runCase("caption text dedupes repeated overlay phrases", () => {
    const captionText = loadCaptionText();
    const result = captionText.collapseOverlaySpam(
      "hello there friend hello there friend hello there friend"
    );
    assert.equal(result, "hello there friend");
  });

  await runCase("caption text merges overlapping live captions", () => {
    const captionText = loadCaptionText();
    assert.equal(
      captionText.mergeText("this mission, if I press complete", "if I press complete, we rebuild this thing"),
      "this mission, if I press complete, we rebuild this thing"
    );
  });

  await runCase("caption text splits long thoughts on natural breaks", () => {
    const captionText = loadCaptionText();
    const parts = captionText.splitByNaturalBreaks(
      "First sentence stays whole and keeps enough words to matter for a roomy bubble. Second sentence also stays together with enough words to cross the limit. Third sentence finishes cleanly with its own complete thought.",
      120,
      false
    );
    assert.deepEqual(parts, [
      "First sentence stays whole and keeps enough words to matter for a roomy bubble.",
      "Second sentence also stays together with enough words to cross the limit.",
      "Third sentence finishes cleanly with its own complete thought."
    ]);
  });

  await runCase("caption text detects lyric-like caption text conservatively", () => {
    const captionText = loadCaptionText();
    assert.equal(captionText.looksLyricLike("[Music] I don't love you like I did yesterday"), true);
    assert.equal(
      captionText.looksLyricLike("I don't know why you say goodbye I say hello and then we go"),
      true
    );
    assert.equal(
      captionText.looksLyricLike("I think this part should remain normal speech because it has punctuation."),
      false
    );
  });
};
