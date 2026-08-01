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
        trustedTypes: opts.trustedTypes,
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
    const snapshot = await pageContext.requestSnapshot(1);
    assert.equal(snapshot, null);
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

  await runCase("page context uses Trusted Types when injecting the bridge script", () => {
    const createdPolicies = [];
    const { pageContext, appendedScripts } = loadContext({
      trustedTypes: {
        createPolicy(name, rules) {
          createdPolicies.push(name);
          return {
            createScriptURL(value) {
              return { trustedScriptUrl: rules.createScriptURL(value) };
            }
          };
        }
      }
    });

    pageContext.ensureBridgeInjected();

    assert.equal(createdPolicies.length, 1);
    assert.equal(createdPolicies[0].startsWith("dialogue-captions-page-bridge-"), true);
    assert.equal(appendedScripts.length, 1);
    assert.equal(appendedScripts[0].src.trustedScriptUrl, "moz-extension://example/scripts/page-bridge.js");
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

  await runCase("page context does not reuse stale snapshots after video changes", async () => {
    const { pageContext, listeners, location } = loadContext();
    listeners.message({
      source: null,
      origin: "https://www.youtube.com",
      data: {
        type: "DIALOGUE_CAPTIONS_PAGE_CONTEXT",
        bridgeToken: pageContext.bridgeToken,
        payload: {
          videoId: "video-a",
          selectedCaptionTrack: { languageCode: "zh" }
        }
      }
    });
    assert.equal(pageContext.getSnapshot().selectedCaptionTrack.languageCode, "zh");

    location.href = "https://www.youtube.com/watch?v=video-b";
    assert.equal(pageContext.getSnapshot(), null);
    const timedOutSnapshot = await pageContext.requestSnapshot(1);
    assert.equal(timedOutSnapshot, null);
  });

  await runCase("page context ignores stale bridge snapshots for the previous video", async () => {
    const { pageContext, listeners, location } = loadContext();
    location.href = "https://www.youtube.com/watch?v=video-b";
    const pending = pageContext.requestSnapshot(1);
    listeners.message({
      source: null,
      origin: "https://www.youtube.com",
      data: {
        type: "DIALOGUE_CAPTIONS_PAGE_CONTEXT",
        bridgeToken: pageContext.bridgeToken,
        payload: {
          videoId: "video-a",
          selectedCaptionTrack: { languageCode: "zh" }
        }
      }
    });

    assert.equal(pageContext.getSnapshot(), null);
    assert.equal(await pending, null);
  });

  await runCase("page context drops bridged fetch responses after video changes", async () => {
    const { pageContext, listeners, location, posted } = loadContext();
    const pending = pageContext.pageFetch("https://www.youtube.com/youtubei/v1/get_transcript", { method: "POST" }, 1000);
    const request = posted.find((message) => message.type === "DIALOGUE_CAPTIONS_PAGE_FETCH_REQUEST");
    assert.ok(request);

    location.href = "https://www.youtube.com/watch?v=video-b";
    listeners.message({
      source: null,
      origin: "https://www.youtube.com",
      data: {
        type: "DIALOGUE_CAPTIONS_PAGE_FETCH_RESPONSE",
        bridgeToken: pageContext.bridgeToken,
        requestId: request.requestId,
        payload: {
          ok: true,
          status: 200,
          body: "{}"
        }
      }
    });

    assert.equal(await pending, null);
  });
};
