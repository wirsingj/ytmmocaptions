(function initPageContext(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});
  if (app.pageContext && app.pageContext.__initialized) {
    return;
  }
  const platform = app.platform;

  const BRIDGE_MESSAGE_TYPE = "DIALOGUE_CAPTIONS_PAGE_CONTEXT";
  const BRIDGE_FETCH_REQUEST_TYPE = "DIALOGUE_CAPTIONS_PAGE_FETCH_REQUEST";
  const BRIDGE_FETCH_RESPONSE_TYPE = "DIALOGUE_CAPTIONS_PAGE_FETCH_RESPONSE";
  const BRIDGE_CAPTION_PROBE_REQUEST_TYPE = "DIALOGUE_CAPTIONS_PAGE_CAPTION_PROBE_REQUEST";
  const BRIDGE_TIMEDTEXT_CAPTURE_TYPE = "DIALOGUE_CAPTIONS_PAGE_TIMEDTEXT_CAPTURE";
  const BRIDGE_SCRIPT_ID = "dc-page-context-bridge";
  const BRIDGE_BOOT_MAX_ATTEMPTS = 4;
  const BRIDGE_SCRIPT_PATHS = ["scripts/page-bridge.js", "src/page-bridge.js"];

  let snapshot = null;
  let requestCounter = 0;
  const pendingRequests = new Map();
  const timedtextCaptures = [];
  let bridgeEnsureAttempts = 0;
  let bridgeEnsureTimer = 0;
  let bridgeScriptPathIndex = 0;

  function isObject(value) {
    return Boolean(value && typeof value === "object");
  }

  function setSnapshot(nextSnapshot) {
    if (!isObject(nextSnapshot)) {
      return;
    }
    snapshot = nextSnapshot;
  }

  function getSnapshot() {
    return snapshot;
  }

  function normalizeTimedtextCapture(input) {
    if (!isObject(input)) {
      return null;
    }
    const url = typeof input.url === "string" ? input.url : "";
    if (!url) {
      return null;
    }
    const body = typeof input.body === "string" ? input.body : "";
    return {
      url: url,
      status: Number(input.status || 0),
      contentType: typeof input.contentType === "string" ? input.contentType : "",
      body: body,
      source: typeof input.source === "string" ? input.source : "",
      seenAt: Number(input.seenAt || Date.now()),
      videoId: typeof input.videoId === "string" ? input.videoId : ""
    };
  }

  function pushTimedtextCapture(input) {
    const normalized = normalizeTimedtextCapture(input);
    if (!normalized) {
      return;
    }
    timedtextCaptures.push(normalized);
    while (timedtextCaptures.length > 20) {
      timedtextCaptures.shift();
    }
  }

  function getTimedtextCaptures(videoId) {
    if (!videoId) {
      return timedtextCaptures.slice();
    }
    return timedtextCaptures.filter(function (capture) {
      return capture.videoId === videoId || capture.url.indexOf("v=" + encodeURIComponent(videoId)) >= 0;
    });
  }

  function onWindowMessage(event) {
    if (event.source && event.source !== scope) {
      return;
    }
    if (typeof event.origin === "string" && event.origin && event.origin !== scope.location.origin) {
      return;
    }
    const data = event.data;
    if (!isObject(data) || typeof data.type !== "string") {
      return;
    }

    if (data.type === BRIDGE_MESSAGE_TYPE) {
      if (!isObject(data.payload)) {
        return;
      }
      setSnapshot(data.payload);
      return;
    }

    if (data.type === BRIDGE_TIMEDTEXT_CAPTURE_TYPE) {
      pushTimedtextCapture(data.payload);
      return;
    }

    if (data.type !== BRIDGE_FETCH_RESPONSE_TYPE) {
      return;
    }
    const requestId = typeof data.requestId === "number" ? data.requestId : NaN;
    if (!Number.isFinite(requestId) || !pendingRequests.has(requestId)) {
      return;
    }
    const pending = pendingRequests.get(requestId);
    pendingRequests.delete(requestId);
    pending.resolve(isObject(data.payload) ? data.payload : null);
  }

  async function pageFetch(url, init, timeoutMs) {
    const safeUrl = String(url || "");
    if (!safeUrl) {
      return null;
    }
    const requestId = ++requestCounter;
    const safeInit = isObject(init) ? init : {};
    const timeout = Number.isFinite(timeoutMs) ? timeoutMs : 9000;

    return new Promise((resolve) => {
      const timer = scope.setTimeout(() => {
        pendingRequests.delete(requestId);
        resolve(null);
      }, timeout);
      pendingRequests.set(requestId, {
        resolve(payload) {
          scope.clearTimeout(timer);
          resolve(payload);
        }
      });
      scope.postMessage(
        {
          type: BRIDGE_FETCH_REQUEST_TYPE,
          requestId: requestId,
          payload: {
            url: safeUrl,
            init: safeInit
          }
        },
        scope.location.origin
      );
    });
  }

  function ensureBridgeInjected() {
    if (!platform || typeof platform.runtimeGetURL !== "function") {
      return;
    }
    if (bridgeEnsureAttempts >= BRIDGE_BOOT_MAX_ATTEMPTS) {
      return;
    }
    if (document.getElementById(BRIDGE_SCRIPT_ID)) {
      return;
    }
    bridgeEnsureAttempts += 1;
    const script = document.createElement("script");
    script.id = BRIDGE_SCRIPT_ID;
    script.src = platform.runtimeGetURL(BRIDGE_SCRIPT_PATHS[bridgeScriptPathIndex]);
    script.async = false;
    script.onload = function () {
      script.remove();
      if (bridgeEnsureTimer) {
        scope.clearTimeout(bridgeEnsureTimer);
        bridgeEnsureTimer = 0;
      }
    };
    script.onerror = function () {
      script.remove();
      if (bridgeScriptPathIndex < BRIDGE_SCRIPT_PATHS.length - 1) {
        bridgeScriptPathIndex += 1;
      }
      if (bridgeEnsureAttempts < BRIDGE_BOOT_MAX_ATTEMPTS) {
        if (bridgeEnsureTimer) {
          scope.clearTimeout(bridgeEnsureTimer);
        }
        bridgeEnsureTimer = scope.setTimeout(() => {
          bridgeEnsureTimer = 0;
          ensureBridgeInjected();
        }, 450);
      }
    };
    (document.head || document.documentElement).append(script);
  }

  function triggerCaptionProbe() {
    scope.postMessage(
      {
        type: BRIDGE_CAPTION_PROBE_REQUEST_TYPE
      },
      scope.location.origin
    );
  }

  scope.addEventListener("message", onWindowMessage);

  app.pageContext = {
    __initialized: true,
    BRIDGE_MESSAGE_TYPE,
    BRIDGE_FETCH_REQUEST_TYPE,
    BRIDGE_FETCH_RESPONSE_TYPE,
    BRIDGE_CAPTION_PROBE_REQUEST_TYPE,
    BRIDGE_TIMEDTEXT_CAPTURE_TYPE,
    ensureBridgeInjected,
    getSnapshot,
    getTimedtextCaptures,
    pageFetch,
    triggerCaptionProbe
  };
})(window);
