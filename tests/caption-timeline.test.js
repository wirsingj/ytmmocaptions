exports.run = async function runCaptionTimelineTests(ctx) {
  const { assert, loadModule, runCase } = ctx;

  await runCase("caption timeline normalizes full transcript results into one shared shape", async () => {
    const calls = [];
    const module = loadModule("caption-timeline.js", {
      windowProps: {
        navigator: { userAgent: "Mozilla/5.0 Chrome/125" },
        DialogueCaptions: {
          diagnostics: {
            record(name, payload) {
              calls.push({ name, payload });
            }
          },
          transcript: {
            getVideoId() {
              return "abc123";
            },
            async loadTranscript() {
              return {
                ok: true,
                videoId: "abc123",
                mode: "direct transcript mode",
                cues: [
                  { start: 8, end: 10, text: "future line" },
                  { start: 1, end: 3, text: "current line", tokens: [{ text: "current", start: 1, end: 2 }] }
                ]
              };
            }
          }
        }
      }
    });

    const result = await module.captionTimeline.acquireFullTimeline(
      "https://www.youtube.com/watch?v=abc123",
      new AbortController().signal,
      {
        videoElement: {
          currentTime: 2,
          textTracks: { length: 1 }
        }
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.sourceType, "direct transcript mode");
    assert.equal(result.timeline.sourceType, "direct transcript mode");
    assert.equal(result.timeline.browser, "chrome");
    assert.deepEqual(result.cues.map((cue) => cue.text), ["current line", "future line"]);
    assert.equal(result.cues[0].startMs, 1000);
    assert.equal(result.cues[0].endMs, 3000);
    assert.equal(result.futureCueCount, 1);
    assert.equal(result.attempts.some((attempt) => attempt.stage === "accepted"), true);
    assert.equal(calls.some((call) => call.name === "timeline:acquired"), true);
  });

  await runCase("caption timeline records acquisition failures without falling through silently", async () => {
    const calls = [];
    const module = loadModule("caption-timeline.js", {
      windowProps: {
        navigator: { userAgent: "Mozilla/5.0 Firefox/149" },
        DialogueCaptions: {
          diagnostics: {
            record(name, payload) {
              calls.push({ name, payload });
            }
          },
          transcript: {
            getVideoId() {
              return "def456";
            },
            async loadTranscript() {
              return {
                ok: false,
                reason: "No subtitle cues were found in available tracks."
              };
            }
          }
        }
      }
    });

    const result = await module.captionTimeline.acquireFullTimeline(
      "https://www.youtube.com/watch?v=def456",
      new AbortController().signal,
      {
        videoElement: {
          currentTime: 12,
          textTracks: { length: 0 }
        }
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.browser, "firefox");
    assert.equal(result.attempts[0].source, "full-transcript-provider");
    assert.equal(result.attempts[1].stage, "failed");
    assert.equal(result.attempts[1].reason, "No subtitle cues were found in available tracks.");
    assert.equal(calls.some((call) => call.name === "timeline:acquire-failed"), true);
  });
};
