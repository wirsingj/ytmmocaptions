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
    assert.equal(captionText.cleanCandidate("Chinese"), "");
    assert.equal(captionText.cleanCandidate("English"), "");
    assert.equal(captionText.cleanCandidate("Chinese food is not what this caption is about."), "Chinese food is not what this caption is about.");
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

  await runCase("caption text softens all-caps captions into readable sentence case", () => {
    const captionText = loadCaptionText();
    assert.equal(
      captionText.cleanCandidate("HEY EVERYONE. I DON'T KNOW WHY THIS IS SO LOUD TODAY."),
      "Hey everyone. I don't know why this is so loud today."
    );
    assert.equal(
      captionText.cleanCandidate("Stephen: FAVORITE SMELL. Matt: COFFEE MIXED WITH BACON IN THE MORNING."),
      "Stephen: Favorite smell. Matt: Coffee mixed with bacon in the morning."
    );
    assert.equal(
      captionText.cleanCandidate("STEPHEN: FAVORITE SMELL. MATT: COFFEE MIXED WITH BACON IN THE MORNING."),
      "Stephen: Favorite smell. Matt: Coffee mixed with bacon in the morning."
    );
    assert.equal(
      captionText.cleanCandidate("This mixed-case caption should stay as authored."),
      "This mixed-case caption should stay as authored."
    );
  });

  await runCase("caption text can leave all-caps captions alone", () => {
    const captionText = loadCaptionText();
    assert.equal(
      captionText.cleanCandidate("HEY EVERYONE. I DON'T KNOW WHY THIS IS SO LOUD TODAY.", { caseFixEnabled: false }),
      "HEY EVERYONE. I DON'T KNOW WHY THIS IS SO LOUD TODAY."
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
