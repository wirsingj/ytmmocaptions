exports.run = async function runCaptionSessionTests(ctx) {
  const { assert, loadModule, runCase } = ctx;

  function loadSessionModule() {
    const module = loadModule("caption-session.js", {
      windowProps: {
        AbortController
      }
    });
    return module.CaptionSessionManager;
  }

  await runCase("caption sessions reject stale session ids", () => {
    const CaptionSessionManager = loadSessionModule();
    const sessions = new CaptionSessionManager();
    const first = sessions.begin("first-open");
    const second = sessions.begin("reopen");

    assert.notEqual(first, second);
    assert.equal(sessions.isActive(first), false);
    assert.equal(sessions.isActive(second), true);
    assert.equal(sessions.getCurrentId(), second);
  });

  await runCase("caption sessions abort owned controllers on invalidation", () => {
    const CaptionSessionManager = loadSessionModule();
    const sessions = new CaptionSessionManager();
    const sessionId = sessions.begin("load");
    const controller = sessions.createAbortController(sessionId);

    assert.ok(controller);
    assert.equal(controller.signal.aborted, false);

    sessions.invalidate("panel-close");

    assert.equal(controller.signal.aborted, true);
    assert.equal(sessions.isActive(sessionId), false);
  });

  await runCase("caption sessions do not create controllers for stale sessions", () => {
    const CaptionSessionManager = loadSessionModule();
    const sessions = new CaptionSessionManager();
    const oldSession = sessions.begin("old");
    sessions.begin("new");

    assert.equal(sessions.createAbortController(oldSession), null);
  });

  await runCase("caption sessions release controllers without aborting current work", () => {
    const CaptionSessionManager = loadSessionModule();
    const sessions = new CaptionSessionManager();
    const sessionId = sessions.begin("load");
    const controller = sessions.createAbortController(sessionId);

    sessions.releaseAbortController(sessionId, controller);
    sessions.invalidate("after-release");

    assert.equal(controller.signal.aborted, false);
  });
};
