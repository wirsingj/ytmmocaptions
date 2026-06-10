exports.run = async function runPageContextTests(ctx) {
  const { assert, loadModule, runCase } = ctx;

  function loadContext(options) {
    const opts = options || {};
    const listeners = {};
    const posted = [];
    const location = {
      href: "https://www.youtube.com/watch?v=video-a",
      origin: "https://www.youtube.com"
    };
    const appendedScripts = [];
    const module = loadModule("page-context.js", {
      windowProps: {
        location,
        setTimeout,
        clearTimeout,
        postMessage(message) {
          posted.push(message);
        },
        addEventListener(type, callback) {
          listeners[type] = callback;
        },
        platform: {
          runtimeGetURL(path) {
            return "moz-extension://example/" + path;
          }
        },
        DialogueCaptions: {
          platform: {
            runtimeGetURL(path) {
              return "moz-extension://example/" + path;
            }
          }
        }
      },
      document: {
        getElementById() {
          return null;
        },
        createElement() {
          return {
            dataset: {},
            src: "",
            async: true,
            remove() {}
          };
        },
        head: {
          append(script) {
            appendedScripts.push(script);
            if (opts.failBridgeLoads && typeof script.onerror === "function") {
              script.onerror();
            }
          }
        },
        documentElement: {
          append(script) {
            appendedScripts.push(script);
            if (opts.failBridgeLoads && typeof script.onerror === "function") {
              script.onerror();
            }
          }
        }
      }
    });
    return {
      pageContext: module.pageContext,
      location,
      listeners,
      posted,
      appendedScripts
    };
  }

  await runCase("page context scopes timedtext captures to the current video", () => {
    const { pageContext, listeners } = loadContext();
    const token = pageContext.bridgeToken;
    listeners.message({
      source: null,
      origin: "https://www.youtube.com",
      data: {
        type: "DIALOGUE_CAPTIONS_PAGE_TIMEDTEXT_CAPTURE",
        bridgeToken: token,
        payload: {
          url: "https://www.youtube.com/api/timedtext?v=video-a",
          body: "a",
          videoId: "video-a"
        }
      }
    });
    assert.equal(pageContext.getTimedtextCaptures("video-a").length, 1);

    listeners.message({
      source: null,
      origin: "https://www.youtube.com",
      data: {
        type: "DIALOGUE_CAPTIONS_PAGE_TIMEDTEXT_CAPTURE",
        bridgeToken: token,
        payload: {
          url: "https://www.youtube.com/api/timedtext?v=video-b",
          body: "b",
          videoId: "video-b"
        }
      }
    });

    assert.equal(pageContext.getTimedtextCaptures("video-a").length, 0);
    assert.equal(pageContext.getTimedtextCaptures("video-b").length, 1);
  });

  await runCase("page context ignores bridge messages without the token", () => {
    const { pageContext, listeners } = loadContext();
    listeners.message({
      source: null,
      origin: "https://www.youtube.com",
      data: {
        type: "DIALOGUE_CAPTIONS_PAGE_TIMEDTEXT_CAPTURE",
        payload: {
          url: "https://www.youtube.com/api/timedtext?v=video-a",
          body: "a",
          videoId: "video-a"
        }
      }
    });
    assert.equal(pageContext.getTimedtextCaptures("video-a").length, 0);
  });

  await runCase("page context does not send bridge requests off watch pages", async () => {
    const { pageContext, location, posted } = loadContext();
    location.href = "https://www.youtube.com/results?search_query=captions";
    assert.equal(pageContext.isCurrentWatchPageWithVideo(), false);
    assert.equal(pageContext.triggerCaptionProbe(), false);
    assert.equal(posted.length, 0);
    const result = await pageContext.pageFetch("https://www.youtube.com/api/timedtext?v=video-a", {}, 1);
    assert.equal(result, null);
  });

  await runCase("page context resets bridge injection attempts on video change", () => {
    const { pageContext, location, appendedScripts } = loadContext({ failBridgeLoads: true });
    for (let index = 0; index < 6; index += 1) {
      pageContext.ensureBridgeInjected();
    }
    assert.equal(appendedScripts.length, 4);

    location.href = "https://www.youtube.com/watch?v=video-b";
    pageContext.ensureBridgeInjected();
    assert.equal(appendedScripts.length, 5);
    assert.equal(pageContext.getCurrentWatchVideoId(), "video-b");
  });

  await runCase("page context requests a read-only selected caption snapshot", async () => {
    const { pageContext, listeners, posted } = loadContext();
    const pending = pageContext.requestSnapshot(1000);
    const request = posted.find((message) => message.type === "DIALOGUE_CAPTIONS_PAGE_SNAPSHOT_REQUEST");
    assert.ok(request);
    assert.equal(request.bridgeToken, pageContext.bridgeToken);

    listeners.message({
      source: null,
      origin: "https://www.youtube.com",
      data: {
        type: "DIALOGUE_CAPTIONS_PAGE_CONTEXT",
        bridgeToken: pageContext.bridgeToken,
        payload: {
          videoId: "video-a",
          selectedCaptionTrack: { languageCode: "fr" }
        }
      }
    });

    const snapshot = await pending;
    assert.equal(snapshot.selectedCaptionTrack.languageCode, "fr");
  });
};
