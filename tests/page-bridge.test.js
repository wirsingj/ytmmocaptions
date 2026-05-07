const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT_DIR = path.resolve(__dirname, "..");

function loadPageBridge(url) {
  const listeners = {};
  const posted = [];
  let fetchCalls = 0;
  const sandbox = {
    window: null,
    location: new URL(url),
    Date,
    URL,
    setTimeout() {},
    setInterval() {
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
          return { text: async () => "{}" };
        },
        text: async () => "{}"
      });
    },
    XMLHttpRequest: function XMLHttpRequest() {},
    document: {
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

  const source = fs.readFileSync(path.join(ROOT_DIR, "src", "page-bridge.js"), "utf8");
  vm.runInNewContext(source, sandbox, { filename: "page-bridge.js" });

  async function request(urlToFetch, init) {
    posted.length = 0;
    listeners.message({
      source: null,
      origin: sandbox.location.origin,
      data: {
        type: "DIALOGUE_CAPTIONS_PAGE_FETCH_REQUEST",
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

  return {
    request,
    get fetchCalls() {
      return fetchCalls;
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
};
