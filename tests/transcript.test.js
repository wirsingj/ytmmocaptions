function makeJsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

function makeTextResponse(text, status, contentType) {
  return {
    ok: typeof status === "number" ? status >= 200 && status < 300 : true,
    status: typeof status === "number" ? status : 200,
    headers: { get: () => contentType || "text/html" },
    async json() {
      return {};
    },
    async text() {
      return text;
    }
  };
}

exports.run = async function runTranscriptTests(ctx) {
  const { assert, loadModule, readFixture, runCase } = ctx;

  class SimpleXmlParser {
    parseFromString(input, type) {
      const source = String(input || "");
      if (String(type || "").toLowerCase() === "text/html") {
        return {
          body: {
            textContent: source
              .replace(/^<body>/i, "")
              .replace(/<\/body>$/i, "")
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
          }
        };
      }
      const textNodes = [];
      source.replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi, (_match, attrs, body) => {
        textNodes.push({
          textContent: body,
          getAttribute(name) {
            const pattern = new RegExp(name + '="([^"]*)"', "i");
            const found = String(attrs || "").match(pattern);
            return found ? found[1] : null;
          }
        });
        return "";
      });
      return {
        querySelector() {
          return null;
        },
        getElementsByTagName(localName) {
          return localName === "text" ? textNodes : [];
        },
        getElementsByTagNameNS(_namespace, localName) {
          return localName === "text" ? textNodes : [];
        }
      };
    }
  }

  await runCase("transcript loads and parses sample subtitle data", async () => {
    const playerResponse = readFixture("player-response.json");
    const json3Data = readFixture("json3-sample.json");

    const transcript = loadModule("transcript.js", {
      windowProps: {
        ytInitialPlayerResponse: playerResponse,
        location: { href: "https://www.youtube.com/watch?v=abc123" }
      },
      DOMParser: SimpleXmlParser,
      fetch: async (url) => {
        if (String(url).includes("fmt=json3")) {
          return makeJsonResponse(json3Data);
        }
        return makeTextResponse("<html></html>");
      }
    }).transcript;

    const result = await transcript.loadTranscript(
      "https://www.youtube.com/watch?v=abc123",
      new AbortController().signal
    );

    assert.equal(result.ok, true);
    assert.equal(result.cues.length, 2);
    assert.equal(result.cues[0].text, "Line one from witness.");
  });

  await runCase("transcript handles missing metadata safely", async () => {
    const transcript = loadModule("transcript.js", {
      fetch: async () => makeTextResponse("<html><body>no player response</body></html>")
    }).transcript;

    const result = await transcript.loadTranscript(
      "https://www.youtube.com/watch?v=missing",
      new AbortController().signal
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "Transcript metadata is unavailable.");
  });

  await runCase("transcript handles malformed track data without crashing", async () => {
    const transcript = loadModule("transcript.js", {
      windowProps: {
        ytInitialPlayerResponse: {
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [{ baseUrl: 123, languageCode: "en" }]
            }
          }
        }
      },
      fetch: async () => makeTextResponse("")
    }).transcript;

    const result = await transcript.loadTranscript(
      "https://www.youtube.com/watch?v=badtrack",
      new AbortController().signal
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "No subtitle cues were found in available tracks.");
  });

  await runCase("transcript accepts intercepted player-caption payloads", async () => {
    const json3Data = readFixture("json3-sample.json");
    const videoId = "intercepted123";
    const transcript = loadModule("transcript.js", {
      windowProps: {
        DialogueCaptions: {
          pageContext: {
            getSnapshot() {
              return {
                hasPlayerResponse: false,
                captionTracks: []
              };
            },
            getTimedtextCaptures(requestVideoId) {
              if (requestVideoId !== videoId) {
                return [];
              }
              return [
                {
                  url: "https://www.youtube.com/api/timedtext?v=" + videoId + "&lang=en&fmt=json3",
                  status: 200,
                  contentType: "application/json",
                  body: JSON.stringify(json3Data),
                  source: "fetch",
                  seenAt: Date.now(),
                  videoId: videoId
                }
              ];
            }
          }
        }
      },
      fetch: async () => makeTextResponse("")
    }).transcript;

    const result = await transcript.loadTranscript(
      "https://www.youtube.com/watch?v=" + videoId,
      new AbortController().signal
    );

    assert.equal(result.ok, true);
    assert.equal(result.mode, "intercepted player-caption mode");
    assert.equal(result.cues.length, 2);
    assert.equal(result.track.kind, "intercepted_player_caption");
  });

  await runCase("transcript filters invalid XML cues and sorts parsed cues", async () => {
    const playerResponse = readFixture("player-response.json");
    const transcript = loadModule("transcript.js", {
      windowProps: {
        ytInitialPlayerResponse: playerResponse,
        location: { href: "https://www.youtube.com/watch?v=abc123" }
      },
      DOMParser: SimpleXmlParser,
      fetch: async (url) => {
        const value = String(url);
        if (value.includes("fmt=json3") || value.includes("fmt=vtt")) {
          return makeTextResponse("", 200, "text/plain");
        }
        return makeTextResponse(
          '<transcript><text start="5" dur="1">second</text><text start="bad" dur="1">bad</text><text start="2" dur="1">first</text></transcript>',
          200,
          "text/xml"
        );
      }
    }).transcript;

    const result = await transcript.loadTranscript(
      "https://www.youtube.com/watch?v=abc123",
      new AbortController().signal
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.cues.map((cue) => cue.text), ["first", "second"]);
    assert.deepEqual(result.cues.map((cue) => cue.start), [2, 5]);
  });

  await runCase("transcript cues include estimated word timing tokens", async () => {
    const playerResponse = readFixture("player-response.json");
    const transcript = loadModule("transcript.js", {
      windowProps: {
        ytInitialPlayerResponse: playerResponse,
        location: { href: "https://www.youtube.com/watch?v=abc123" }
      },
      fetch: async (url) => {
        const value = String(url);
        if (value.includes("fmt=json3")) {
          return makeJsonResponse({
            events: [
              {
                tStartMs: 1000,
                dDurationMs: 2000,
                segs: [{ utf8: "alpha beta gamma" }]
              }
            ]
          });
        }
        return makeTextResponse("", 200, "text/plain");
      }
    }).transcript;

    const result = await transcript.loadTranscript(
      "https://www.youtube.com/watch?v=abc123",
      new AbortController().signal
    );

    assert.equal(result.ok, true);
    assert.equal(result.cues[0].tokens.length, 3);
    assert.equal(result.cues[0].tokens[0].text, "alpha");
    assert.equal(result.cues[0].tokens[0].start, 1);
    assert.equal(result.cues[0].tokens[2].end, 3);
  });
};
