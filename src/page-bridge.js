(function initDialogueCaptionsPageBridge(scope) {
  if (scope.__dialogueCaptionsPageBridgeLoaded) {
    return;
  }
  scope.__dialogueCaptionsPageBridgeLoaded = true;

  const MESSAGE_TYPE = "DIALOGUE_CAPTIONS_PAGE_CONTEXT";
  const FETCH_REQUEST_TYPE = "DIALOGUE_CAPTIONS_PAGE_FETCH_REQUEST";
  const FETCH_RESPONSE_TYPE = "DIALOGUE_CAPTIONS_PAGE_FETCH_RESPONSE";
  const CAPTION_PROBE_REQUEST_TYPE = "DIALOGUE_CAPTIONS_PAGE_CAPTION_PROBE_REQUEST";
  const TIMEDTEXT_CAPTURE_TYPE = "DIALOGUE_CAPTIONS_PAGE_TIMEDTEXT_CAPTURE";
  const timedtextProbe = {
    lastRichUrl: "",
    lastVideoId: "",
    lastSeenAt: 0
  };

  function getVideoId(url) {
    try {
      return new URL(url).searchParams.get("v") || "";
    } catch {
      return "";
    }
  }

  function walkObjects(root, visit, seen) {
    if (!root || typeof root !== "object") {
      return;
    }
    const cache = seen || new WeakSet();
    if (cache.has(root)) {
      return;
    }
    cache.add(root);
    visit(root);
    if (Array.isArray(root)) {
      for (let index = 0; index < root.length; index += 1) {
        walkObjects(root[index], visit, cache);
      }
      return;
    }
    const keys = Object.keys(root);
    for (let index = 0; index < keys.length; index += 1) {
      walkObjects(root[keys[index]], visit, cache);
    }
  }

  function findTranscriptParams(initialData) {
    let params = "";
    walkObjects(initialData, function (node) {
      if (params) {
        return;
      }
      if (
        node &&
        typeof node === "object" &&
        node.getTranscriptEndpoint &&
        typeof node.getTranscriptEndpoint.params === "string"
      ) {
        params = node.getTranscriptEndpoint.params;
      }
    });
    return params;
  }

  function readYtcfg(keys) {
    const output = {};
    const ytcfg = scope.ytcfg;
    if (!ytcfg || typeof ytcfg.get !== "function") {
      return output;
    }
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      try {
        output[key] = ytcfg.get(key);
      } catch {
        output[key] = null;
      }
    }
    return output;
  }

  function isTimedtextUrl(url) {
    return String(url || "").includes("/api/timedtext");
  }

  function isRichTimedtextUrl(url) {
    const value = String(url || "");
    if (!value) {
      return false;
    }
    return (
      value.includes("pot=") ||
      value.includes("potc=") ||
      value.includes("xorb=") ||
      value.includes("x-youtube-client-name")
    );
  }

  function recordTimedtextUrl(url) {
    const value = String(url || "");
    if (!isTimedtextUrl(value) || !isRichTimedtextUrl(value)) {
      return;
    }
    timedtextProbe.lastRichUrl = value;
    timedtextProbe.lastVideoId = getVideoId(value) || getVideoId(scope.location.href);
    timedtextProbe.lastSeenAt = Date.now();
  }

  function detectTimedtextPayloadKind(contentType, body) {
    const type = String(contentType || "").toLowerCase();
    const text = String(body || "").trim();
    if (!text) {
      return "empty";
    }
    if (/^<!doctype html/i.test(text) || /^<html[\s>]/i.test(text) || type.includes("text/html")) {
      return "html";
    }
    if (/^webvtt/i.test(text) || type.includes("text/vtt")) {
      return "vtt";
    }
    if (type.includes("json") || text[0] === "{" || text[0] === "[") {
      return "json";
    }
    if (
      type.includes("xml") ||
      /^<\?xml/i.test(text) ||
      /^<timedtext[\s>]/i.test(text) ||
      /^<transcript[\s>]/i.test(text) ||
      /^<text[\s>]/i.test(text) ||
      /^<tt[\s>]/i.test(text)
    ) {
      return "xml";
    }
    return "unknown";
  }

  function postTimedtextCapture(url, status, contentType, body, source) {
    const timedtextUrl = String(url || "");
    if (!isTimedtextUrl(timedtextUrl)) {
      return;
    }
    const payloadBody = typeof body === "string" ? body : "";
    const kind = detectTimedtextPayloadKind(contentType, payloadBody);
    const maxBodyLength = 450000;
    const boundedBody =
      payloadBody.length > maxBodyLength ? payloadBody.slice(0, maxBodyLength) : payloadBody;
    const payload = {
      url: timedtextUrl,
      status: Number(status || 0),
      contentType: typeof contentType === "string" ? contentType : "",
      body: boundedBody,
      payloadKind: kind,
      source: source || "",
      seenAt: Date.now(),
      videoId: getVideoId(timedtextUrl) || getVideoId(scope.location.href)
    };
    try {
      scope.postMessage(
        {
          type: TIMEDTEXT_CAPTURE_TYPE,
          payload: payload
        },
        scope.location.origin
      );
    } catch {
      // Ignore bridge delivery failures.
    }
  }

  function installTimedtextProbeHooks() {
    if (scope.__dcTimedtextProbeInstalled) {
      return;
    }
    scope.__dcTimedtextProbeInstalled = true;

    const originalFetch = scope.fetch;
    if (typeof originalFetch === "function") {
      scope.fetch = function wrappedFetch(input, init) {
        const requestUrl = input && typeof input === "object" && typeof input.url === "string" ? input.url : String(input || "");
        recordTimedtextUrl(requestUrl);
        return originalFetch.call(this, input, init).then(function (response) {
          if (response && typeof response.url === "string") {
            recordTimedtextUrl(response.url);
          }
          if (response && isTimedtextUrl(response.url || requestUrl) && typeof response.clone === "function") {
            const clone = response.clone();
            const responseUrl = response.url || requestUrl;
            const contentType = response.headers && typeof response.headers.get === "function"
              ? response.headers.get("content-type") || ""
              : "";
            clone
              .text()
              .then(function (text) {
                postTimedtextCapture(responseUrl, response.status, contentType, text, "fetch");
              })
              .catch(function () {
                postTimedtextCapture(responseUrl, response.status, contentType, "", "fetch");
              });
          }
          return response;
        });
      };
    }

    const xhrPrototype = scope.XMLHttpRequest && scope.XMLHttpRequest.prototype;
    if (!xhrPrototype || typeof xhrPrototype.open !== "function") {
      return;
    }

    const originalOpen = xhrPrototype.open;
    xhrPrototype.open = function wrappedOpen(method, url) {
      this.__dcTimedtextUrl = String(url || "");
      recordTimedtextUrl(this.__dcTimedtextUrl);
      return originalOpen.apply(this, arguments);
    };

    const originalSend = xhrPrototype.send;
    xhrPrototype.send = function wrappedSend(body) {
      if (this && typeof this.addEventListener === "function") {
        this.addEventListener(
          "loadend",
          function () {
            if (this && this.responseURL) {
              recordTimedtextUrl(this.responseURL);
            }
            const responseUrl = this && this.responseURL ? this.responseURL : this.__dcTimedtextUrl;
            if (!isTimedtextUrl(responseUrl)) {
              return;
            }
            const responseType = this && typeof this.responseType === "string" ? this.responseType : "";
            const responseBody =
              !responseType || responseType === "text"
                ? String(this.responseText || "")
                : "";
            const responseStatus = this && Number.isFinite(this.status) ? this.status : 0;
            const responseContentType =
              this && typeof this.getResponseHeader === "function"
                ? this.getResponseHeader("content-type") || ""
                : "";
            postTimedtextCapture(responseUrl, responseStatus, responseContentType, responseBody, "xhr");
          },
          { once: true }
        );
      }
      return originalSend.call(this, body);
    };
  }

  function buildPayload() {
    const playerResponse = scope.ytInitialPlayerResponse && typeof scope.ytInitialPlayerResponse === "object"
      ? scope.ytInitialPlayerResponse
      : null;
    const initialData = scope.ytInitialData && typeof scope.ytInitialData === "object" ? scope.ytInitialData : null;
    const tracks =
      playerResponse &&
      playerResponse.captions &&
      playerResponse.captions.playerCaptionsTracklistRenderer &&
      Array.isArray(playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks)
        ? playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks
        : [];

    const ytcfgValues = readYtcfg([
      "INNERTUBE_API_KEY",
      "INNERTUBE_CONTEXT",
      "INNERTUBE_CONTEXT_CLIENT_NAME",
      "INNERTUBE_CONTEXT_CLIENT_VERSION",
      "INNERTUBE_CLIENT_VERSION",
      "VISITOR_DATA",
      "PAGE_CL",
      "PAGE_BUILD_LABEL",
      "LOGGED_IN"
    ]);

    return {
      href: scope.location.href,
      videoId: getVideoId(scope.location.href),
      hasPlayerResponse: Boolean(playerResponse),
      hasInitialData: Boolean(initialData),
      captionTracks: tracks.map(function (track) {
        return {
          baseUrl: track && typeof track.baseUrl === "string" ? track.baseUrl : "",
          languageCode: track && typeof track.languageCode === "string" ? track.languageCode : "",
          kind: track && typeof track.kind === "string" ? track.kind : "",
          vssId: track && typeof track.vssId === "string" ? track.vssId : ""
        };
      }),
      transcriptParams: findTranscriptParams(initialData),
      timedtextProbe: {
        lastRichUrl: timedtextProbe.lastRichUrl,
        lastVideoId: timedtextProbe.lastVideoId,
        lastSeenAt: timedtextProbe.lastSeenAt
      },
      ytcfg: ytcfgValues
    };
  }

  function postPayload() {
    try {
      scope.postMessage(
        {
          type: MESSAGE_TYPE,
          payload: buildPayload()
        },
        scope.location.origin
      );
    } catch {
      // Ignore cross-context bridge errors.
    }
  }

  function normalizeHeadersObject(input) {
    if (!input || typeof input !== "object") {
      return {};
    }
    const output = {};
    const keys = Object.keys(input);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const value = input[key];
      if (typeof value === "string") {
        output[key] = value;
      }
    }
    return output;
  }

  function isAllowedFetchUrl(url) {
    try {
      const parsed = new URL(String(url || ""), scope.location.href);
      if (parsed.protocol !== "https:") {
        return false;
      }
      const host = parsed.hostname.toLowerCase();
      if (host !== "www.youtube.com") {
        return false;
      }
      const path = parsed.pathname.toLowerCase();
      return path.endsWith("/api/timedtext") || path === "/youtubei/v1/get_transcript";
    } catch {
      return false;
    }
  }

  function postFetchResponse(requestId, payload) {
    try {
      scope.postMessage(
        {
          type: FETCH_RESPONSE_TYPE,
          requestId: requestId,
          payload: payload
        },
        scope.location.origin
      );
    } catch {
      // Ignore message bridge failures.
    }
  }

  function pickPreferredTrack(tracklist) {
    const tracks = Array.isArray(tracklist) ? tracklist : [];
    if (!tracks.length) {
      return null;
    }
    const englishManual = tracks.find(function (track) {
      const languageCode = String(track && track.languageCode ? track.languageCode : "").toLowerCase();
      const kind = String(track && track.kind ? track.kind : "").toLowerCase();
      return languageCode.startsWith("en") && kind !== "asr";
    });
    if (englishManual) {
      return englishManual;
    }
    const manual = tracks.find(function (track) {
      const kind = String(track && track.kind ? track.kind : "").toLowerCase();
      return kind !== "asr";
    });
    return manual || tracks[0];
  }

  function handleCaptionProbeRequest() {
    const player = document.getElementById("movie_player");
    if (!player) {
      return;
    }
    try {
      if (typeof player.loadModule === "function") {
        player.loadModule("captions");
      }
    } catch {
      // Ignore unsupported module load calls.
    }

    try {
      if (typeof player.getOption === "function" && typeof player.setOption === "function") {
        const tracklist = player.getOption("captions", "tracklist");
        const preferred = pickPreferredTrack(tracklist);
        if (preferred) {
          player.setOption("captions", "track", preferred);
        }
        player.setOption("captions", "reload", true);
      }
    } catch {
      // Ignore player option failures.
    }

    try {
      if (typeof player.isSubtitlesOn === "function" && typeof player.toggleSubtitles === "function") {
        if (!player.isSubtitlesOn()) {
          player.toggleSubtitles();
        }
      }
    } catch {
      // Ignore subtitle toggle failures.
    }

    try {
      const subtitleButton = document.querySelector(".ytp-subtitles-button");
      if (subtitleButton instanceof HTMLElement) {
        const pressed = String(subtitleButton.getAttribute("aria-pressed") || "").toLowerCase();
        if (pressed !== "true") {
          subtitleButton.click();
        }
      }
    } catch {
      // Ignore subtitle button click failures.
    }

    postPayload();
  }

  async function handleFetchRequest(data) {
    const requestId = typeof data.requestId === "number" ? data.requestId : NaN;
    const payload = data.payload;
    const url = payload && typeof payload.url === "string" ? payload.url : "";
    const init = payload && payload.init && typeof payload.init === "object" ? payload.init : {};
    if (!Number.isFinite(requestId) || !url) {
      return;
    }

    const method = typeof init.method === "string" ? init.method : "GET";
    const headers = normalizeHeadersObject(init.headers);
    const body = typeof init.body === "string" ? init.body : undefined;
    const methodUpper = method.toUpperCase();
    if (!isAllowedFetchUrl(url) || (methodUpper !== "GET" && methodUpper !== "POST")) {
      postFetchResponse(requestId, {
        ok: false,
        status: 0,
        statusText: "",
        url: "",
        contentType: "",
        body: "",
        error: "blocked_request"
      });
      return;
    }

    try {
      const response = await fetch(url, {
        method: method,
        headers: headers,
        body: body,
        credentials: "include",
        redirect: "follow"
      });
      const text = await response.text();
      postFetchResponse(requestId, {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText || "",
        url: response.url || "",
        contentType: response.headers.get("content-type") || "",
        body: text
      });
    } catch (error) {
      postFetchResponse(requestId, {
        ok: false,
        status: 0,
        statusText: "",
        url: "",
        contentType: "",
        body: "",
        error: String(error && error.message ? error.message : error)
      });
    }
  }

  let intervalId = 0;
  function scheduleRecurringPosts() {
    if (intervalId) {
      scope.clearInterval(intervalId);
    }
    intervalId = scope.setInterval(postPayload, 8000);
  }

  scope.addEventListener("yt-navigate-finish", postPayload);
  document.addEventListener("yt-page-data-updated", postPayload);
  scope.addEventListener("popstate", postPayload);
  scope.addEventListener("hashchange", postPayload);
  scope.addEventListener("message", function (event) {
    if (event.source && event.source !== scope) {
      return;
    }
    if (typeof event.origin === "string" && event.origin && event.origin !== scope.location.origin) {
      return;
    }
    const data = event.data;
    if (!data || typeof data !== "object" || typeof data.type !== "string") {
      return;
    }
    if (data.type === CAPTION_PROBE_REQUEST_TYPE) {
      handleCaptionProbeRequest();
      return;
    }
    if (data.type !== FETCH_REQUEST_TYPE) {
      return;
    }
    handleFetchRequest(data);
  });

  installTimedtextProbeHooks();
  postPayload();
  scope.setTimeout(postPayload, 300);
  scope.setTimeout(postPayload, 1200);
  scheduleRecurringPosts();
})(window);
