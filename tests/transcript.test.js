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

  await runCase("transcript rejects non-YouTube watch URLs", async () => {
    let fetchCalls = 0;
    const transcript = loadModule("transcript.js", {
      fetch: async () => {
        fetchCalls += 1;
        return makeTextResponse("");
      }
    }).transcript;

    const result = await transcript.loadTranscript(
      "https://evil.example/watch?v=abc123",
      new AbortController().signal
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "Not a YouTube watch page.");
    assert.equal(fetchCalls, 0);
  });

  await runCase("transcript blocks non-YouTube caption track URLs", async () => {
    const playerResponse = {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: "https://evil.example/api/timedtext?v=abc123",
              languageCode: "en",
              kind: ""
            }
          ]
        }
      }
    };
    const requested = [];
    const transcript = loadModule("transcript.js", {
      windowProps: {
        ytInitialPlayerResponse: playerResponse,
        location: { href: "https://www.youtube.com/watch?v=abc123" },
        ytcfg: {
          get(key) {
            const values = {
              INNERTUBE_API_KEY: "fake-key",
              INNERTUBE_CONTEXT: { client: { clientName: "WEB", clientVersion: "2.test" } },
              INNERTUBE_CONTEXT_CLIENT_NAME: "1",
              INNERTUBE_CONTEXT_CLIENT_VERSION: "2.test"
            };
            return values[key] || null;
          }
        }
      },
      fetch: async (url) => {
        requested.push(String(url));
        return makeTextResponse("", 200, "text/plain");
      }
    }).transcript;

    const result = await transcript.loadTranscript(
      "https://www.youtube.com/watch?v=abc123",
      new AbortController().signal
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "No subtitle cues were found in available tracks.");
    assert.ok(!requested.some((url) => url.includes("evil.example")));
  });

  await runCase("transcript blocks nested YouTube timedtext-like paths", async () => {
    const playerResponse = {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: "https://www.youtube.com/anything/api/timedtext?v=abc123",
              languageCode: "en",
              kind: ""
            }
          ]
        }
      }
    };
    const requested = [];
    const transcript = loadModule("transcript.js", {
      windowProps: {
        ytInitialPlayerResponse: playerResponse,
        location: { href: "https://www.youtube.com/watch?v=abc123" },
        ytcfg: {
          get(key) {
            const values = {
              INNERTUBE_API_KEY: "fake-key",
              INNERTUBE_CONTEXT: { client: { clientName: "WEB", clientVersion: "2.test" } },
              INNERTUBE_CONTEXT_CLIENT_NAME: "1",
              INNERTUBE_CONTEXT_CLIENT_VERSION: "2.test"
            };
            return values[key] || null;
          }
        }
      },
      fetch: async (url) => {
        requested.push(String(url));
        return makeTextResponse("", 200, "text/plain");
      }
    }).transcript;

    const result = await transcript.loadTranscript(
      "https://www.youtube.com/watch?v=abc123",
      new AbortController().signal
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "No subtitle cues were found in available tracks.");
    assert.ok(!requested.some((url) => url.includes("/anything/api/timedtext")));
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

  await runCase("transcript prefers direct timedtext over intercepted captures when both exist", async () => {
    const playerResponse = readFixture("player-response.json");
    const json3Data = readFixture("json3-sample.json");
    const interceptedData = {
      events: [
        {
          tStartMs: 5000,
          dDurationMs: 1000,
          segs: [{ utf8: "intercepted later line" }]
        }
      ]
    };
    const transcript = loadModule("transcript.js", {
      windowProps: {
        ytInitialPlayerResponse: playerResponse,
        location: { href: "https://www.youtube.com/watch?v=abc123" },
        DialogueCaptions: {
          pageContext: {
            getSnapshot() {
              return {
                hasPlayerResponse: true,
                captionTracks: []
              };
            },
            getTimedtextCaptures() {
              return [
                {
                  url: "https://www.youtube.com/api/timedtext?v=abc123&lang=en&fmt=json3",
                  status: 200,
                  contentType: "application/json",
                  body: JSON.stringify(interceptedData),
                  source: "fetch",
                  seenAt: Date.now(),
                  videoId: "abc123"
                }
              ];
            }
          }
        }
      },
      fetch: async (url) => {
        if (String(url).includes("fmt=json3")) {
          return makeJsonResponse(json3Data);
        }
        return makeTextResponse("", 200, "text/plain");
      }
    }).transcript;

    const result = await transcript.loadTranscript(
      "https://www.youtube.com/watch?v=abc123",
      new AbortController().signal
    );

    assert.equal(result.ok, true);
    assert.equal(result.mode, "direct transcript mode");
    assert.equal(result.cues[0].text, "Line one from witness.");
  });

  await runCase("transcript loads full future timeline from YouTube transcript panel endpoint", async () => {
    const playerResponse = readFixture("player-response.json");
    const panelPayload = {
      actions: [
        {
          updateEngagementPanelAction: {
            content: {
              transcriptRenderer: {
                body: {
                  transcriptBodyRenderer: {
                    cueGroups: [
                      {
                        transcriptCueGroupRenderer: {
                          formattedStartOffset: { simpleText: "0:08" },
                          cues: [
                            {
                              transcriptCueRenderer: {
                                cue: { simpleText: "first panel line." }
                              }
                            }
                          ]
                        }
                      },
                      {
                        transcriptCueGroupRenderer: {
                          formattedStartOffset: { simpleText: "0:16" },
                          cues: [
                            {
                              transcriptCueRenderer: {
                                cue: { simpleText: "second panel line for future preview." }
                              }
                            }
                          ]
                        }
                      }
                    ]
                  }
                }
              }
            }
          }
        }
      ]
    };
    const requested = [];
    const transcript = loadModule("transcript.js", {
      windowProps: {
        ytInitialPlayerResponse: playerResponse,
        location: { href: "https://www.youtube.com/watch?v=panel123" },
        DialogueCaptions: {
          pageContext: {
            getSnapshot() {
              return {
                hasPlayerResponse: true,
                captionTracks: [],
                transcriptPanelParams: "panel-params",
                ytcfg: {
                  INNERTUBE_API_KEY: "fake-key",
                  INNERTUBE_CONTEXT: {
                    client: {
                      clientName: "WEB",
                      clientVersion: "2.test"
                    }
                  },
                  INNERTUBE_CONTEXT_CLIENT_NAME: "1",
                  INNERTUBE_CONTEXT_CLIENT_VERSION: "2.test"
                }
              };
            },
            getTimedtextCaptures() {
              return [];
            },
            async pageFetch(url, init) {
              requested.push({ url: String(url), init });
              if (String(url).includes("/youtubei/v1/get_panel")) {
                return {
                  ok: true,
                  status: 200,
                  url: String(url),
                  contentType: "application/json",
                  body: JSON.stringify(panelPayload)
                };
              }
              return {
                ok: true,
                status: 200,
                url: String(url),
                contentType: "text/plain",
                body: ""
              };
            }
          }
        }
      },
      fetch: async () => makeTextResponse("", 200, "text/plain")
    }).transcript;

    const result = await transcript.loadTranscript(
      "https://www.youtube.com/watch?v=panel123",
      new AbortController().signal
    );

    assert.equal(result.ok, true);
    assert.equal(result.mode, "direct transcript mode");
    assert.equal(result.track.kind, "get_panel");
    assert.deepEqual(result.cues.map((cue) => cue.text), [
      "first panel line.",
      "second panel line for future preview."
    ]);
    assert.equal(result.cues[0].start, 8);
    assert.equal(result.cues[0].end, 16);
    const panelRequest = requested.find((entry) => entry.url.includes("/youtubei/v1/get_panel"));
    assert.ok(panelRequest, "expected get_panel to be requested");
    assert.equal(JSON.parse(panelRequest.init.body).panelId, "PAmodern_transcript_view");
  });

  await runCase("transcript derives modern panel params and parses segment view-model cues", async () => {
    const playerResponse = readFixture("player-response.json");
    const panelPayload = {
      content: {
        sectionListRenderer: {
          contents: [
            {
              itemSectionRenderer: {
                contents: [
                  {
                    transcriptSegmentViewModel: {
                      timestamp: "1:04",
                      simpleText: "modern panel cue one."
                    }
                  },
                  {
                    transcriptSegmentViewModel: {
                      timestamp: "1:12",
                      simpleText: "modern panel cue two."
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    };
    let panelBody = null;
    const transcript = loadModule("transcript.js", {
      windowProps: {
        ytInitialPlayerResponse: playerResponse,
        location: { href: "https://www.youtube.com/watch?v=modern123" },
        DialogueCaptions: {
          pageContext: {
            getSnapshot() {
              return {
                hasPlayerResponse: true,
                captionTracks: [],
                ytcfg: {
                  INNERTUBE_API_KEY: "fake-key",
                  INNERTUBE_CONTEXT: {
                    client: {
                      clientName: "WEB",
                      clientVersion: "2.test"
                    }
                  },
                  INNERTUBE_CONTEXT_CLIENT_NAME: "1",
                  INNERTUBE_CONTEXT_CLIENT_VERSION: "2.test"
                }
              };
            },
            getTimedtextCaptures() {
              return [];
            },
            async pageFetch(url, init) {
              if (String(url).includes("/youtubei/v1/get_panel")) {
                panelBody = JSON.parse(init.body);
                return {
                  ok: true,
                  status: 200,
                  url: String(url),
                  contentType: "application/json",
                  body: JSON.stringify(panelPayload)
                };
              }
              return {
                ok: true,
                status: 200,
                url: String(url),
                contentType: "text/plain",
                body: ""
              };
            }
          }
        }
      },
      fetch: async (url) => {
        throw new Error("get_panel should not fetch the watch page before deriving params: " + url);
      }
    }).transcript;

    const result = await transcript.loadTranscript(
      "https://www.youtube.com/watch?v=modern123",
      new AbortController().signal
    );

    assert.equal(result.ok, true);
    assert.equal(result.track.kind, "get_panel");
    assert.equal(result.cues.length, 2);
    assert.equal(result.cues[0].start, 64);
    assert.equal(result.cues[0].end, 72);
    assert.deepEqual(result.cues.map((cue) => cue.text), [
      "modern panel cue one.",
      "modern panel cue two."
    ]);
    assert.equal(panelBody.panelId, "PAmodern_transcript_view");
    assert.ok(panelBody.params, "derived panel params should be sent");
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
