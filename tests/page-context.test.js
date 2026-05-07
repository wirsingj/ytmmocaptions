exports.run = async function runPageContextTests(ctx) {
  const { assert, loadModule, runCase } = ctx;

  function loadContext() {
    const listeners = {};
    const posted = [];
    const module = loadModule("page-context.js", {
      windowProps: {
        location: {
          href: "https://www.youtube.com/watch?v=video-a",
          origin: "https://www.youtube.com"
        },
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
            remove() {}
          };
        },
        head: {
          append() {}
        },
        documentElement: {
          append() {}
        }
      }
    });
    return {
      pageContext: module.pageContext,
      listeners,
      posted
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
};
