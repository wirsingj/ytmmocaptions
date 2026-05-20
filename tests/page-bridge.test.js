const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT_DIR = path.resolve(__dirname, "..");

function loadPageBridge(url) {
  const listeners = {};
  const posted = [];
  let intervalCallback = null;
  let fetchCalls = 0;
  let cloneReads = 0;
  let href = url;
  let bridgeToken = "test-bridge-token";
  const source = fs.readFileSync(path.join(ROOT_DIR, "src", "page-bridge.js"), "utf8");
  function makeLocation(nextUrl) {
    const parsed = new URL(nextUrl);
    return {
      get href() {
        return href;
      },
      get origin() {
        return parsed.origin;
      },
      get hostname() {
        return new URL(href).hostname;
      },
      get pathname() {
        return new URL(href).pathname;
      },
      get search() {
        return new URL(href).search;
      }
    };
  }
  const sandbox = {
    window: null,
    location: makeLocation(url),
    Date,
    URL,
    URLSearchParams,
    setTimeout() {},
    setInterval(callback) {
      intervalCallback = callback;
      return 1;
    },
    clearInterval() {},
    postMessage(message) {
      posted.push(message);
    },
    addEventListener(type, callback) {
      listeners[type] = callback;
    },
    fetch() {
      fetchCalls += 1;
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        url: "https://www.youtube.com/api/timedtext",
        headers: { get: () => "application/json" },
        clone() {
          return {
            text: async () => {
              cloneReads += 1;
              return "{}";
            }
          };
        },
        text: async () => "{}"
      });
    },
    XMLHttpRequest: function XMLHttpRequest() {},
    document: {
      currentScript: {
        dataset: {
          dcBridgeToken: bridgeToken
        }
      },
      addEventListener() {},
      getElementById() {
        return null;
      },
      querySelector() {
        return null;
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.XMLHttpRequest.prototype = {};

  vm.runInNewContext(source, sandbox, { filename: "page-bridge.js" });

  async function request(urlToFetch, init, tokenOverride) {
    posted.length = 0;
    listeners.message({
      source: null,
      origin: sandbox.location.origin,
      data: {
        type: "DIALOGUE_CAPTIONS_PAGE_FETCH_REQUEST",
        bridgeToken: tokenOverride || bridgeToken,
        requestId: 7,
        payload: {
          url: urlToFetch,
          init: init || {}
        }
      }
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    return posted.find((message) => message.type === "DIALOGUE_CAPTIONS_PAGE_FETCH_RESPONSE");
  }

  async function requestWithoutToken(urlToFetch, init) {
    posted.length = 0;
    listeners.message({
      source: null,
      origin: sandbox.location.origin,
      data: {
        type: "DIALOGUE_CAPTIONS_PAGE_FETCH_REQUEST",
        requestId: 8,
        payload: {
          url: urlToFetch,
          init: init || {}
        }
      }
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    return posted.find((message) => message.type === "DIALOGUE_CAPTIONS_PAGE_FETCH_RESPONSE");
  }

  return {
    bridgeToken,
    reloadWithToken(nextToken) {
      bridgeToken = nextToken;
      sandbox.document.currentScript.dataset.dcBridgeToken = nextToken;
      posted.length = 0;
      vm.runInNewContext(source, sandbox, { filename: "page-bridge.js" });
      return posted.slice();
    },
    posted,
    request,
    requestWithoutToken,
    setUrl(nextUrl) {
      href = nextUrl;
    },
    runRecurringPost() {
      posted.length = 0;
      if (typeof intervalCallback === "function") {
        intervalCallback();
      }
      return posted.slice();
    },
    async fetchTimedtext() {
      posted.length = 0;
      await sandbox.fetch("https://www.youtube.com/api/timedtext?v=abc123");
      await Promise.resolve();
      await Promise.resolve();
      return posted.slice();
    },
    captionProbe(data) {
      posted.length = 0;
      listeners.message({
        source: null,
        origin: sandbox.location.origin,
        data: data || {
          type: "DIALOGUE_CAPTIONS_PAGE_CAPTION_PROBE_REQUEST",
          bridgeToken
        }
      });
      return posted.slice();
    },
    get fetchCalls() {
      return fetchCalls;
    },
    get cloneReads() {
      return cloneReads;
    }
  };
}

exports.run = async function runPageBridgeTests(ctx) {
  const { assert, runCase } = ctx;

  await runCase("page bridge rejects blocked protocols, hosts, paths, and methods", async () => {
    const bridge = loadPageBridge("https://www.youtube.com/watch?v=abc123");
    const blocked = [
      ["http://www.youtube.com/api/timedtext", { method: "GET" }],
      ["https://evil.example/api/timedtext", { method: "GET" }],
      ["https://m.youtube.com/api/timedtext", { method: "GET" }],
      ["https://www.youtube.com/feeds/videos.xml", { method: "GET" }],
      ["https://www.youtube.com/api/timedtext", { method: "PUT" }]
    ];

    for (const item of blocked) {
      const response = await bridge.request(item[0], item[1]);
      assert.equal(response.payload.error, "blocked_request", item[0]);
    }
    assert.equal(bridge.fetchCalls, 0);
  });

  await runCase("page bridge allows required YouTube transcript endpoints", async () => {
    const bridge = loadPageBridge("https://www.youtube.com/watch?v=abc123");
    const timedtext = await bridge.request("https://www.youtube.com/api/timedtext?v=abc123", { method: "GET" });
    const transcript = await bridge.request("https://www.youtube.com/youtubei/v1/get_transcript", { method: "POST" });
    assert.equal(timedtext.payload.ok, true);
    assert.equal(transcript.payload.ok, true);
    assert.equal(bridge.fetchCalls, 2);
  });

  await runCase("page bridge ignores missing-token requests", async () => {
    const bridge = loadPageBridge("https://www.youtube.com/watch?v=abc123");
    const response = await bridge.requestWithoutToken("https://www.youtube.com/api/timedtext?v=abc123", { method: "GET" });
    assert.equal(response, undefined);
    assert.equal(bridge.fetchCalls, 0);

    bridge.posted.length = 0;
    bridge.captionProbe({
      type: "DIALOGUE_CAPTIONS_PAGE_CAPTION_PROBE_REQUEST"
    });
    assert.equal(bridge.posted.length, 0);
  });

  await runCase("page bridge accepts a fresh token after extension reload", async () => {
    const bridge = loadPageBridge("https://www.youtube.com/watch?v=abc123");
    const reloadPosts = bridge.reloadWithToken("fresh-token-after-reload");
    assert.ok(
      reloadPosts.some((message) => message.bridgeToken === "fresh-token-after-reload"),
      "reloaded bridge should post a snapshot with the fresh token"
    );

    const response = await bridge.request(
      "https://www.youtube.com/api/timedtext?v=abc123",
      { method: "GET" },
      "fresh-token-after-reload"
    );
    assert.equal(response.bridgeToken, "fresh-token-after-reload");
    assert.equal(response.payload.ok, true);
  });

  await runCase("page bridge does not post recurring snapshots off watch pages", () => {
    const bridge = loadPageBridge("https://www.youtube.com/watch?v=abc123");
    bridge.setUrl("https://www.youtube.com/results?search_query=cats");
    const posts = bridge.runRecurringPost();
    assert.equal(posts.length, 0);
  });

  await runCase("page bridge does not post timedtext captures after route leaves watch", async () => {
    const bridge = loadPageBridge("https://www.youtube.com/watch?v=abc123");
    bridge.setUrl("https://www.youtube.com/feed/subscriptions");
    const posts = await bridge.fetchTimedtext();
    assert.equal(posts.length, 0);
    assert.equal(bridge.cloneReads, 0);
  });

  await runCase("page bridge ignores caption probes off watch pages", () => {
    const bridge = loadPageBridge("https://www.youtube.com/watch?v=abc123");
    bridge.setUrl("https://www.youtube.com/results?search_query=cats");
    const posts = bridge.captionProbe();
    assert.equal(posts.length, 0);
  });
};
