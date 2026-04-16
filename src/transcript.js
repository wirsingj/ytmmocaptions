(function initTranscript(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});
  const DEBUG_PREFIX = "[Dialogue Captions][Transcript]";
  const DEBUG_STORAGE_KEY = "dialogueCaptions.debug";

  function isDebugEnabled() {
    try {
      if (scope.localStorage && scope.localStorage.getItem(DEBUG_STORAGE_KEY) === "1") {
        return true;
      }
    } catch {
      // Ignore storage access errors.
    }
    try {
      const parsed = new URL(scope.location.href);
      return parsed.searchParams.get("dcdebug") === "1";
    } catch {
      return false;
    }
  }

  const DEBUG_ENABLED = isDebugEnabled();

  function logDebug(message, extra) {
    if (!DEBUG_ENABLED) {
      return;
    }
    if (typeof extra === "undefined") {
      console.info(DEBUG_PREFIX, message);
      return;
    }
    console.info(DEBUG_PREFIX, message, extra);
  }

  function getPageContextSnapshot() {
    if (!app.pageContext || typeof app.pageContext.getSnapshot !== "function") {
      return null;
    }
    return app.pageContext.getSnapshot();
  }

  function getPageTimedtextCaptures(videoId) {
    if (!app.pageContext || typeof app.pageContext.getTimedtextCaptures !== "function") {
      return [];
    }
    return app.pageContext.getTimedtextCaptures(videoId);
  }

  function getRichTimedtextProbeForVideo(videoId) {
    const pageSnapshot = getPageContextSnapshot();
    const probe = pageSnapshot && pageSnapshot.timedtextProbe ? pageSnapshot.timedtextProbe : null;
    if (!probe || typeof probe.lastRichUrl !== "string" || !probe.lastRichUrl) {
      return null;
    }
    try {
      const parsed = new URL(probe.lastRichUrl);
      const probeVideoId = parsed.searchParams.get("v") || probe.lastVideoId || "";
      if (videoId && probeVideoId && probeVideoId !== videoId) {
        return null;
      }
      return {
        url: parsed.toString(),
        languageCode: parsed.searchParams.get("lang") || "",
        seenAt: Number(probe.lastSeenAt || 0)
      };
    } catch {
      return null;
    }
  }

  function classifyFetchError(error) {
    const text = String(error && error.message ? error.message : error || "").toLowerCase();
    if (text.includes("blocked") || text.includes("content blocker") || text.includes("adblock")) {
      return "blocked_request";
    }
    if (text.includes("networkerror") || text.includes("failed to fetch") || text.includes("network")) {
      return "network_error";
    }
    return "request_error";
  }

  function summarizeCaptionUrl(baseUrl) {
    try {
      const parsed = new URL(baseUrl);
      const keys = Array.from(parsed.searchParams.keys());
      return {
        hasPot: parsed.searchParams.has("pot") || parsed.searchParams.has("po"),
        hasSignature: parsed.searchParams.has("signature") || parsed.searchParams.has("sig"),
        hasExpire: parsed.searchParams.has("expire"),
        keys: keys
      };
    } catch {
      return {
        hasPot: false,
        hasSignature: false,
        hasExpire: false,
        keys: []
      };
    }
  }

  function bodyPreview(body) {
    return String(body || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  }

  function detectPayloadKind(contentType, body) {
    const type = String(contentType || "").toLowerCase();
    const text = String(body || "");
    const trimmed = text.trim();
    if (!trimmed) {
      return "empty";
    }
    if (/^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed) || type.includes("text/html")) {
      return "html";
    }
    if (/^webvtt/i.test(trimmed) || type.includes("text/vtt")) {
      return "vtt";
    }
    if (type.includes("json") || /^[\[{]/.test(trimmed)) {
      return "json";
    }
    if (
      type.includes("xml") ||
      /^<\?xml/i.test(trimmed) ||
      /^<timedtext[\s>]/i.test(trimmed) ||
      /^<transcript[\s>]/i.test(trimmed) ||
      /^<text[\s>]/i.test(trimmed) ||
      /^<tt[\s>]/i.test(trimmed)
    ) {
      return "xml";
    }
    return "unknown";
  }

  function looksLikeWatchPagePayload(body, finalUrl) {
    const text = String(body || "");
    const lowered = text.toLowerCase();
    const url = String(finalUrl || "").toLowerCase();
    return (
      url.includes("/watch") ||
      lowered.includes("ytinitialplayerresponse") ||
      lowered.includes("ytd-app") ||
      lowered.includes("<title>youtube")
    );
  }

  function logFetchInspection(
    sourcePath,
    requestedUrl,
    response,
    body,
    parserSelected,
    rejectionReason,
    payloadKind,
    fetchTransport
  ) {
    const contentType =
      response && response.headers
        ? response.headers.get("content-type") || ""
        : response && typeof response.contentType === "string"
          ? response.contentType
          : "";
    logDebug("payload inspection", {
      sourcePath: sourcePath,
      requestedUrl: requestedUrl,
      finalUrl: response && response.url ? response.url : "",
      status: response && typeof response.status === "number" ? response.status : 0,
      contentType: contentType,
      preview: bodyPreview(body),
      payloadKind: payloadKind || "",
      fetchTransport: fetchTransport || "",
      parserSelected: parserSelected || "",
      rejectionReason: rejectionReason || ""
    });
  }

  async function fetchTextWithContext(sourcePath, requestedUrl, signal, init) {
    const safeInit = init && typeof init === "object" ? init : {};
    const pageContext = app.pageContext;
    if (pageContext && typeof pageContext.pageFetch === "function") {
      try {
        const bridged = await pageContext.pageFetch(requestedUrl, safeInit, 10000);
        if (bridged && typeof bridged === "object") {
          return {
            ok: Boolean(bridged.ok),
            status: Number(bridged.status || 0),
            url: typeof bridged.url === "string" ? bridged.url : "",
            contentType: typeof bridged.contentType === "string" ? bridged.contentType : "",
            body: typeof bridged.body === "string" ? bridged.body : "",
            error: typeof bridged.error === "string" ? bridged.error : "",
            transport: "page-context"
          };
        }
        logDebug("page-context fetch unavailable for request", {
          sourcePath: sourcePath,
          requestedUrl: requestedUrl,
          reason: "bridge_result_null"
        });
      } catch (error) {
        logDebug("page-context fetch failed", {
          sourcePath: sourcePath,
          requestedUrl: requestedUrl,
          reason: classifyFetchError(error),
          message: String(error && error.message ? error.message : error)
        });
      }
    }

    try {
      const response = await fetch(requestedUrl, {
        ...safeInit,
        credentials: "include",
        signal: signal
      });
      const body = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        url: response.url || "",
        contentType: response.headers.get("content-type") || "",
        body: body,
        error: "",
        transport: "content-script"
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        url: "",
        contentType: "",
        body: "",
        error: String(error && error.message ? error.message : error),
        transport: "content-script"
      };
    }
  }

  function getVideoId(url) {
    try {
      return new URL(url).searchParams.get("v");
    } catch {
      return null;
    }
  }

  function isWatchPage(url) {
    try {
      return new URL(url).pathname === "/watch";
    } catch {
      return false;
    }
  }

  function decodeHtmlEntities(input) {
    const parser = new DOMParser();
    const xml = parser.parseFromString("<body>" + String(input || "") + "</body>", "text/html");
    return xml && xml.body ? xml.body.textContent || "" : "";
  }

  function normalizeCueText(text) {
    return decodeHtmlEntities(String(text || ""))
      .replace(/\u200b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractJsonObjectFromOpenBrace(source, openBraceIndex) {
    if (openBraceIndex < 0) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = openBraceIndex; index < source.length; index += 1) {
      const character = source[index];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (character === "\\") {
          escaped = true;
          continue;
        }
        if (character === "\"") {
          inString = false;
        }
        continue;
      }

      if (character === "\"") {
        inString = true;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          return source.slice(openBraceIndex, index + 1);
        }
      }
    }

    return null;
  }

  function extractJsonObjectAfterToken(source, token) {
    const tokenIndex = source.indexOf(token);
    if (tokenIndex < 0) {
      return null;
    }
    const openBraceIndex = source.indexOf("{", tokenIndex + token.length);
    return extractJsonObjectFromOpenBrace(source, openBraceIndex);
  }

  function parsePlayerResponseFromHtml(html) {
    const tokens = [
      "ytInitialPlayerResponse =",
      "var ytInitialPlayerResponse =",
      "window['ytInitialPlayerResponse'] =",
      "window[\"ytInitialPlayerResponse\"] ="
    ];

    for (let index = 0; index < tokens.length; index += 1) {
      const jsonText = extractJsonObjectAfterToken(html, tokens[index]);
      if (!jsonText) {
        continue;
      }
      try {
        return JSON.parse(jsonText);
      } catch {
        continue;
      }
    }

    return null;
  }

  function parseInitialDataFromHtml(html) {
    const tokens = [
      "ytInitialData =",
      "var ytInitialData =",
      "window['ytInitialData'] =",
      "window[\"ytInitialData\"] ="
    ];

    for (let index = 0; index < tokens.length; index += 1) {
      const jsonText = extractJsonObjectAfterToken(html, tokens[index]);
      if (!jsonText) {
        continue;
      }
      try {
        return JSON.parse(jsonText);
      } catch {
        continue;
      }
    }

    return null;
  }

  function parseYtcfgFromHtml(html) {
    const token = "ytcfg.set({";
    let position = 0;
    const mergedConfig = {};
    let hasConfig = false;

    while (position < html.length) {
      const tokenIndex = html.indexOf(token, position);
      if (tokenIndex < 0) {
        break;
      }
      const objectText = extractJsonObjectFromOpenBrace(html, tokenIndex + "ytcfg.set(".length);
      if (objectText) {
        try {
          Object.assign(mergedConfig, JSON.parse(objectText));
          hasConfig = true;
        } catch {
          // Keep scanning next ytcfg.set calls.
        }
      }
      position = tokenIndex + token.length;
    }

    return hasConfig ? mergedConfig : null;
  }

  function getPlayerResponseFromWindow() {
    const pageSnapshot = getPageContextSnapshot();
    if (pageSnapshot && Array.isArray(pageSnapshot.captionTracks) && pageSnapshot.captionTracks.length) {
      return {
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: pageSnapshot.captionTracks
          }
        }
      };
    }
    if (scope.ytInitialPlayerResponse && typeof scope.ytInitialPlayerResponse === "object") {
      return scope.ytInitialPlayerResponse;
    }
    return null;
  }

  function getInitialDataFromWindow() {
    const pageSnapshot = getPageContextSnapshot();
    if (pageSnapshot && typeof pageSnapshot.transcriptParams === "string" && pageSnapshot.transcriptParams) {
      return {
        getTranscriptEndpoint: {
          params: pageSnapshot.transcriptParams
        }
      };
    }
    if (scope.ytInitialData && typeof scope.ytInitialData === "object") {
      return scope.ytInitialData;
    }
    return null;
  }

  function getPlayerResponseFromScripts() {
    const scripts = document.querySelectorAll("script");
    for (let index = 0; index < scripts.length; index += 1) {
      const text = scripts[index].textContent;
      if (!text || text.indexOf("ytInitialPlayerResponse") === -1) {
        continue;
      }
      const parsed = parsePlayerResponseFromHtml(text);
      if (parsed) {
        return parsed;
      }
    }
    return null;
  }

  function getInitialDataFromScripts() {
    const scripts = document.querySelectorAll("script");
    for (let index = 0; index < scripts.length; index += 1) {
      const text = scripts[index].textContent;
      if (!text || text.indexOf("ytInitialData") === -1) {
        continue;
      }
      const parsed = parseInitialDataFromHtml(text);
      if (parsed) {
        return parsed;
      }
    }
    return null;
  }

  async function getPlayerResponseByFetch(pageUrl, signal) {
    const response = await fetch(pageUrl, { credentials: "include", signal: signal });
    if (!response.ok) {
      throw new Error("Failed to load watch page: HTTP " + response.status);
    }
    const html = await response.text();
    return parsePlayerResponseFromHtml(html);
  }

  async function getInitialDataByFetch(pageUrl, signal) {
    const response = await fetch(pageUrl, { credentials: "include", signal: signal });
    if (!response.ok) {
      throw new Error("Failed to load watch page: HTTP " + response.status);
    }
    const html = await response.text();
    return parseInitialDataFromHtml(html);
  }

  async function resolvePlayerResponse(pageUrl, signal) {
    const fromWindow = getPlayerResponseFromWindow();
    if (fromWindow) {
      return fromWindow;
    }

    const fromScripts = getPlayerResponseFromScripts();
    if (fromScripts) {
      return fromScripts;
    }

    return getPlayerResponseByFetch(pageUrl, signal);
  }

  async function resolveInitialData(pageUrl, signal) {
    const fromWindow = getInitialDataFromWindow();
    if (fromWindow) {
      return fromWindow;
    }

    const fromScripts = getInitialDataFromScripts();
    if (fromScripts) {
      return fromScripts;
    }

    return getInitialDataByFetch(pageUrl, signal);
  }

  function getCaptionTracks(playerResponse) {
    const trackListRenderer = playerResponse && playerResponse.captions && playerResponse.captions.playerCaptionsTracklistRenderer;
    const tracks = trackListRenderer && Array.isArray(trackListRenderer.captionTracks) ? trackListRenderer.captionTracks : [];
    return tracks;
  }

  function chooseTrack(tracks) {
    if (!tracks.length) {
      return null;
    }

    const englishManual = tracks.find(function (track) {
      const languageCode = typeof track.languageCode === "string" ? track.languageCode.toLowerCase() : "";
      return languageCode.indexOf("en") === 0 && track.kind !== "asr";
    });
    if (englishManual) {
      return englishManual;
    }

    const manualTrack = tracks.find(function (track) {
      return track.kind !== "asr";
    });
    return manualTrack || tracks[0];
  }

  function buildTrackCandidates(tracks) {
    const normalizedTracks = Array.isArray(tracks) ? tracks : [];
    const used = new Set();
    const candidates = [];

    function push(track) {
      if (!track || !track.baseUrl) {
        return;
      }
      if (used.has(track.baseUrl)) {
        return;
      }
      used.add(track.baseUrl);
      candidates.push(track);
    }

    const primary = chooseTrack(normalizedTracks);
    push(primary);

    for (const track of normalizedTracks) {
      const languageCode = typeof track.languageCode === "string" ? track.languageCode.toLowerCase() : "";
      if (languageCode.startsWith("en") && track.kind !== "asr") {
        push(track);
      }
    }
    for (const track of normalizedTracks) {
      if (track.kind !== "asr") {
        push(track);
      }
    }
    for (const track of normalizedTracks) {
      const languageCode = typeof track.languageCode === "string" ? track.languageCode.toLowerCase() : "";
      if (languageCode.startsWith("en")) {
        push(track);
      }
    }
    for (const track of normalizedTracks) {
      push(track);
    }

    return candidates;
  }

  function withFmt(baseUrl, fmt) {
    const rawUrl = String(baseUrl || "");
    if (!rawUrl) {
      return "";
    }
    try {
      const parsed = new URL(rawUrl);
      parsed.searchParams.set("fmt", fmt);
      return parsed.toString();
    } catch {
      return rawUrl + (rawUrl.indexOf("?") >= 0 ? "&" : "?") + "fmt=" + encodeURIComponent(fmt);
    }
  }

  function mapJson3ToCues(payload) {
    const events = payload && Array.isArray(payload.events) ? payload.events : [];
    return events
      .map(function (event) {
        if (!event || typeof event.tStartMs !== "number" || !Array.isArray(event.segs)) {
          return null;
        }
        const text = normalizeCueText(
          event.segs
            .map(function (segment) {
              return segment && typeof segment.utf8 === "string" ? segment.utf8 : "";
            })
            .join("")
        );
        if (!text) {
          return null;
        }
        const start = event.tStartMs / 1000;
        const duration = typeof event.dDurationMs === "number" ? event.dDurationMs / 1000 : 2;
        return {
          start: start,
          end: Math.max(start + 0.25, start + duration),
          text: text
        };
      })
      .filter(Boolean);
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

  function mapXmlToCues(xmlText) {
    const xmlSource = String(xmlText || "").trim();
    if (!xmlSource) {
      return [];
    }
    if (detectPayloadKind("text/xml", xmlSource) !== "xml") {
      return [];
    }

    function parseClockValue(value) {
      const text = String(value || "").trim();
      if (!text) {
        return 0;
      }
      if (/^\d+(\.\d+)?s$/.test(text)) {
        return Number(text.replace(/s$/, ""));
      }
      if (/^\d+(\.\d+)?ms$/.test(text)) {
        return Number(text.replace(/ms$/, "")) / 1000;
      }
      if (/^\d+(\.\d+)?$/.test(text)) {
        return Number(text);
      }

      const parts = text.split(":").map(Number);
      if (parts.some(Number.isNaN)) {
        return 0;
      }
      if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
      if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
      }
      return parts[0] || 0;
    }

    function collectNodesByLocalName(xmlDocument, localName) {
      const result = [];
      if (!xmlDocument || !localName) {
        return result;
      }

      const direct = xmlDocument.getElementsByTagName(localName);
      for (let index = 0; index < direct.length; index += 1) {
        result.push(direct[index]);
      }

      if (typeof xmlDocument.getElementsByTagNameNS === "function") {
        const namespaced = xmlDocument.getElementsByTagNameNS("*", localName);
        for (let index = 0; index < namespaced.length; index += 1) {
          const node = namespaced[index];
          if (!result.includes(node)) {
            result.push(node);
          }
        }
      }

      return result;
    }

    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlSource, "text/xml");
    if (xml.querySelector("parsererror")) {
      return [];
    }
    const textNodes = collectNodesByLocalName(xml, "text");
    const textCues = textNodes
      .map(function (node) {
        const text = normalizeCueText(node.textContent || "");
        if (!text) {
          return null;
        }
        const start = Number(node.getAttribute("start") || "0");
        const duration = Number(node.getAttribute("dur") || "2");
        return {
          start: start,
          end: Math.max(start + 0.25, start + duration),
          text: text
        };
      })
      .filter(Boolean);

    if (textCues.length) {
      return textCues;
    }

    const paragraphNodes = collectNodesByLocalName(xml, "p");
    return paragraphNodes
      .map(function (node) {
        const text = normalizeCueText(node.textContent || "");
        if (!text) {
          return null;
        }

        const begin = parseClockValue(node.getAttribute("begin"));
        const endAttr = node.getAttribute("end");
        const durAttr = node.getAttribute("dur");
        const end = endAttr ? parseClockValue(endAttr) : begin + parseClockValue(durAttr || "2");
        return {
          start: begin,
          end: Math.max(begin + 0.25, end),
          text: text
        };
      })
      .filter(Boolean);
  }

  function mapVttToCues(vttText) {
    const text = String(vttText || "");
    const cueRegex =
      /(\d{2}:)?\d{2}:\d{2}\.\d{3}\s+-->\s+(\d{2}:)?\d{2}:\d{2}\.\d{3}\s*[\r\n]+([\s\S]*?)(?=(\r?\n){2,}|$)/g;
    const cues = [];

    function parseVttTime(timeText) {
      const parts = String(timeText || "").split(":");
      const secondsPart = Number(parts.pop() || "0");
      const minutesPart = Number(parts.pop() || "0");
      const hoursPart = Number(parts.pop() || "0");
      return hoursPart * 3600 + minutesPart * 60 + secondsPart;
    }

    let match;
    while ((match = cueRegex.exec(text)) !== null) {
      const block = match[0];
      const lines = block.split(/\r?\n/).filter(Boolean);
      if (!lines.length) {
        continue;
      }
      const timing = lines[0].includes("-->") ? lines[0] : lines[1];
      if (!timing || !timing.includes("-->")) {
        continue;
      }
      const [startText, endText] = timing.split("-->").map((v) => v.trim().split(" ")[0]);
      const cueText = normalizeCueText(lines.slice(timing === lines[0] ? 1 : 2).join(" "));
      if (!cueText) {
        continue;
      }
      const start = parseVttTime(startText);
      const end = parseVttTime(endText);
      cues.push({
        start: start,
        end: Math.max(start + 0.25, end),
        text: cueText
      });
    }
    return cues;
  }

  function parseCuesByPayloadKind(payloadKind, body) {
    if (payloadKind === "json") {
      try {
        return mapJson3ToCues(JSON.parse(body));
      } catch {
        return [];
      }
    }
    if (payloadKind === "xml") {
      return mapXmlToCues(body);
    }
    if (payloadKind === "vtt") {
      return mapVttToCues(body);
    }
    return [];
  }

  function cueListToArray(cueList) {
    if (!cueList || typeof cueList.length !== "number") {
      return [];
    }
    const cues = [];
    for (let index = 0; index < cueList.length; index += 1) {
      cues.push(cueList[index]);
    }
    return cues;
  }

  function mapTextTrackToCues(track) {
    const cues = cueListToArray(track && track.cues);
    return cues
      .map(function (cue) {
        const text = normalizeCueText(cue && typeof cue.text === "string" ? cue.text : "");
        if (!text) {
          return null;
        }
        const start = Number(cue.startTime || 0);
        const end = Number(cue.endTime || 0);
        return {
          start: start,
          end: Math.max(start + 0.25, end),
          text: text
        };
      })
      .filter(Boolean);
  }

  function parseTimestampLabel(label) {
    const value = String(label || "").trim();
    if (!value) {
      return NaN;
    }
    const cleaned = value.replace(/[^\d:.]/g, "");
    if (!cleaned) {
      return NaN;
    }
    const parts = cleaned.split(":");
    if (parts.length < 2 || parts.length > 3) {
      return NaN;
    }
    const seconds = Number(parts.pop());
    const minutes = Number(parts.pop());
    const hours = parts.length ? Number(parts.pop()) : 0;
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
      return NaN;
    }
    return Math.max(0, hours * 3600 + minutes * 60 + seconds);
  }

  function collectTranscriptDomEntries() {
    const segmentNodes = Array.from(document.querySelectorAll("ytd-transcript-segment-renderer"));
    if (!segmentNodes.length) {
      return [];
    }

    const entries = [];
    const seen = new Set();
    for (let index = 0; index < segmentNodes.length; index += 1) {
      const node = segmentNodes[index];
      const textNode = node.querySelector("#segment-text, .segment-text");
      const offsetNode = node.querySelector("#start-offset, .segment-timestamp");
      const text = normalizeCueText(textNode ? textNode.textContent || "" : "");
      const start = parseTimestampLabel(offsetNode ? offsetNode.textContent || "" : "");
      if (!text || !Number.isFinite(start)) {
        continue;
      }
      const key = start + "|" + text;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      entries.push({ start: start, text: text });
    }
    return entries;
  }

  function mapTranscriptDomEntriesToCues(entries) {
    const normalized = Array.isArray(entries) ? entries.slice() : [];
    normalized.sort(function (a, b) {
      return a.start - b.start;
    });

    const cues = [];
    for (let index = 0; index < normalized.length; index += 1) {
      const current = normalized[index];
      const next = normalized[index + 1];
      const start = Math.max(0, Number(current.start || 0));
      const end = next && Number.isFinite(next.start) && next.start > start ? next.start : start + 2;
      cues.push({
        start: start,
        end: Math.max(start + 0.25, end),
        text: current.text
      });
    }
    return cues;
  }

  function findTranscriptOpenControl() {
    const controls = Array.from(
      document.querySelectorAll(
        "ytd-menu-service-item-renderer, tp-yt-paper-item, [role='menuitem'], button, a"
      )
    );
    for (let index = 0; index < controls.length; index += 1) {
      const control = controls[index];
      const label = [
        control.getAttribute("aria-label"),
        control.getAttribute("title"),
        control.textContent
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!label.includes("transcript")) {
        continue;
      }
      if (!control.isConnected) {
        continue;
      }
      if (control.closest("#dc-panel, .dc-launcher")) {
        continue;
      }
      const element = control;
      if (typeof element.getBoundingClientRect === "function") {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          continue;
        }
      }
      const clickTarget =
        control.matches("tp-yt-paper-item, button, a, [role='menuitem']")
          ? control
          : control.querySelector("tp-yt-paper-item, button, a, [role='menuitem']") || control;
      return clickTarget;
    }
    return null;
  }

  function findMoreActionsControl() {
    const controls = Array.from(document.querySelectorAll("button, tp-yt-paper-button"));
    for (let index = 0; index < controls.length; index += 1) {
      const control = controls[index];
      const label = [
        control.getAttribute("aria-label"),
        control.getAttribute("title"),
        control.textContent
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (
        !label.includes("more actions") &&
        !label.includes("action menu") &&
        !label.includes("actions")
      ) {
        continue;
      }
      if (!control.isConnected) {
        continue;
      }
      if (control.closest("#dc-panel, .dc-launcher")) {
        continue;
      }
      const rect = typeof control.getBoundingClientRect === "function" ? control.getBoundingClientRect() : null;
      if (rect && (rect.width <= 0 || rect.height <= 0)) {
        continue;
      }
      return control;
    }
    return null;
  }

  async function openTranscriptFromActionMenu(signal) {
    const menuControl = findMoreActionsControl();
    if (!menuControl) {
      return null;
    }
    try {
      menuControl.click();
    } catch {
      return null;
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < 1800) {
      if (signal && signal.aborted) {
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        throw abortError;
      }
      const transcriptControl = findTranscriptOpenControl();
      if (transcriptControl) {
        return transcriptControl;
      }
      await new Promise(function (resolve) {
        window.setTimeout(resolve, 80);
      });
    }
    return null;
  }

  async function waitForTranscriptDomEntries(signal, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (signal && signal.aborted) {
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        throw abortError;
      }
      const entries = collectTranscriptDomEntries();
      if (entries.length) {
        return entries;
      }
      await new Promise(function (resolve) {
        window.setTimeout(resolve, 180);
      });
    }
    return [];
  }

  async function loadFromTranscriptDom(signal) {
    const existingEntries = collectTranscriptDomEntries();
    if (existingEntries.length) {
      logDebug("transcript DOM found existing entries", { entries: existingEntries.length });
      return mapTranscriptDomEntriesToCues(existingEntries);
    }

    let openControl = findTranscriptOpenControl();
    if (openControl) {
      try {
        openControl.click();
      } catch {
        return null;
      }
    } else {
      openControl = await openTranscriptFromActionMenu(signal);
      if (!openControl) {
        logDebug("transcript DOM rejected: transcript action menu item not found");
        return null;
      }
      try {
        openControl.click();
      } catch {
        return null;
      }
    }

    const entries = await waitForTranscriptDomEntries(signal, 4200);
    if (!entries.length) {
      logDebug("transcript DOM rejected: panel opened but no entries");
      return null;
    }
    logDebug("transcript DOM parsed", { entries: entries.length });
    return mapTranscriptDomEntriesToCues(entries);
  }

  function findTranscriptParams(initialData) {
    if (
      initialData &&
      typeof initialData === "object" &&
      initialData.getTranscriptEndpoint &&
      typeof initialData.getTranscriptEndpoint.params === "string"
    ) {
      return initialData.getTranscriptEndpoint.params;
    }

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

  function getYtcfgValue(key) {
    const pageSnapshot = getPageContextSnapshot();
    if (pageSnapshot && pageSnapshot.ytcfg && Object.prototype.hasOwnProperty.call(pageSnapshot.ytcfg, key)) {
      return pageSnapshot.ytcfg[key];
    }
    try {
      if (scope.ytcfg && typeof scope.ytcfg.get === "function") {
        return scope.ytcfg.get(key);
      }
    } catch {
      return null;
    }
    return null;
  }

  function readMatch(text, pattern) {
    const match = String(text || "").match(pattern);
    return match && match[1] ? match[1] : "";
  }

  async function fetchWatchHtml(pageUrl, signal) {
    const response = await fetch(pageUrl, { credentials: "include", signal: signal });
    if (!response.ok) {
      return "";
    }
    return response.text();
  }

  async function resolveInnertubeConfig(pageUrl, signal) {
    const context = getYtcfgValue("INNERTUBE_CONTEXT");
    const apiKey = getYtcfgValue("INNERTUBE_API_KEY");
    const clientNameNumber = getYtcfgValue("INNERTUBE_CONTEXT_CLIENT_NAME");
    const clientVersion = getYtcfgValue("INNERTUBE_CONTEXT_CLIENT_VERSION") || getYtcfgValue("INNERTUBE_CLIENT_VERSION");
    const visitorData = getYtcfgValue("VISITOR_DATA");

    if (context && apiKey) {
      return {
        apiKey: String(apiKey),
        context: context,
        clientNameNumber: clientNameNumber ? String(clientNameNumber) : "1",
        clientVersion: clientVersion ? String(clientVersion) : "",
        visitorData: visitorData ? String(visitorData) : ""
      };
    }

    const html = await fetchWatchHtml(pageUrl, signal);
    if (!html) {
      return null;
    }

    const ytcfgData = parseYtcfgFromHtml(html);
    if (ytcfgData && ytcfgData.INNERTUBE_API_KEY && ytcfgData.INNERTUBE_CONTEXT) {
      return {
        apiKey: String(ytcfgData.INNERTUBE_API_KEY),
        context: ytcfgData.INNERTUBE_CONTEXT,
        clientNameNumber: ytcfgData.INNERTUBE_CONTEXT_CLIENT_NAME
          ? String(ytcfgData.INNERTUBE_CONTEXT_CLIENT_NAME)
          : "1",
        clientVersion: ytcfgData.INNERTUBE_CONTEXT_CLIENT_VERSION
          ? String(ytcfgData.INNERTUBE_CONTEXT_CLIENT_VERSION)
          : ytcfgData.INNERTUBE_CLIENT_VERSION
            ? String(ytcfgData.INNERTUBE_CLIENT_VERSION)
            : "",
        visitorData: ytcfgData.VISITOR_DATA ? String(ytcfgData.VISITOR_DATA) : ""
      };
    }

    const htmlApiKey = readMatch(html, /"INNERTUBE_API_KEY":"([^"]+)"/);
    const htmlClientVersion = readMatch(html, /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
    const htmlVisitorData = readMatch(html, /"VISITOR_DATA":"([^"]+)"/);
    if (!htmlApiKey) {
      return null;
    }

    return {
      apiKey: htmlApiKey,
      context: {
        client: {
          clientName: "WEB",
          clientVersion: htmlClientVersion || "2.20260101.00.00",
          hl: "en",
          visitorData: htmlVisitorData || ""
        }
      },
      clientNameNumber: "1",
      clientVersion: htmlClientVersion || "",
      visitorData: htmlVisitorData || ""
    };
  }

  function mapGetTranscriptResponseToCues(payload) {
    const raw = [];
    const seen = new Set();
    function pushCue(start, end, text) {
      const normalizedText = normalizeCueText(text || "");
      if (!normalizedText || !Number.isFinite(start)) {
        return;
      }
      const key = String(Math.round(start * 1000)) + "|" + normalizedText;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      raw.push({
        start: Math.max(0, start),
        end: Number.isFinite(end) ? end : 0,
        text: normalizedText
      });
    }

    function readSimpleOrRunsText(value) {
      if (!value || typeof value !== "object") {
        return "";
      }
      if (typeof value.simpleText === "string") {
        return value.simpleText;
      }
      if (Array.isArray(value.runs)) {
        return value.runs
          .map(function (run) {
            return run && typeof run.text === "string" ? run.text : "";
          })
          .join("");
      }
      return "";
    }

    walkObjects(payload, function (node) {
      if (!node || typeof node !== "object" || !node.transcriptSegmentRenderer) {
        if (node && typeof node === "object" && node.transcriptCueGroupRenderer) {
          const group = node.transcriptCueGroupRenderer;
          const startLabel = readSimpleOrRunsText(group.formattedStartOffset || {});
          const start = parseTimestampLabel(startLabel);
          if (!Number.isFinite(start)) {
            return;
          }
          const cues = Array.isArray(group.cues) ? group.cues : [];
          const groupText = cues
            .map(function (cueEntry) {
              const cue = cueEntry && cueEntry.transcriptCueRenderer ? cueEntry.transcriptCueRenderer : cueEntry;
              return readSimpleOrRunsText(cue && cue.cue ? cue.cue : cue || {});
            })
            .join(" ");
          pushCue(start, 0, groupText);
        }
        return;
      }
      const renderer = node.transcriptSegmentRenderer;
      const snippet = renderer.snippet || {};
      const runs = Array.isArray(snippet.runs) ? snippet.runs : [];
      const text = normalizeCueText(
        runs.length
          ? runs
              .map(function (run) {
                return run && typeof run.text === "string" ? run.text : "";
              })
              .join("")
          : snippet.simpleText || ""
      );
      if (!text) {
        return;
      }

      const startMs = Number(renderer.startMs || renderer.startTimeMs || 0);
      const durationMs = Number(renderer.durationMs || 0);
      const endMs = Number(renderer.endMs || renderer.endTimeMs || 0);
      if (!Number.isFinite(startMs)) {
        return;
      }
      let end = 0;
      if (Number.isFinite(endMs) && endMs > startMs) {
        end = endMs / 1000;
      } else if (Number.isFinite(durationMs) && durationMs > 0) {
        end = (startMs + durationMs) / 1000;
      }
      pushCue(
        Math.max(0, startMs / 1000),
        end > 0 ? Math.max(startMs / 1000 + 0.25, end) : 0,
        text
      );
    });

    raw.sort(function (a, b) {
      return a.start - b.start;
    });

    for (let index = 0; index < raw.length; index += 1) {
      if (raw[index].end > raw[index].start) {
        continue;
      }
      const next = raw[index + 1];
      if (next && next.start > raw[index].start) {
        raw[index].end = Math.max(raw[index].start + 0.25, next.start);
      } else {
        raw[index].end = raw[index].start + 2;
      }
    }
    return raw;
  }

  async function fetchCuesFromGetTranscript(pageUrl, signal) {
    const initialData = await resolveInitialData(pageUrl, signal);
    const params = findTranscriptParams(initialData);
    if (!params) {
      logDebug("youtubei/get_transcript skipped: missing params (metadata/context)");
      return null;
    }

    const innertube = await resolveInnertubeConfig(pageUrl, signal);
    if (!innertube || !innertube.apiKey || !innertube.context) {
      logDebug("youtubei/get_transcript skipped: missing innertube config (context)");
      return null;
    }

    const endpoint =
      "https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false&key=" +
      encodeURIComponent(innertube.apiKey);
    const headers = {
      "content-type": "application/json",
      "x-youtube-client-name": innertube.clientNameNumber || "1",
      "x-youtube-client-version":
        innertube.clientVersion ||
        (innertube.context.client && innertube.context.client.clientVersion) ||
        "",
      "x-origin": "https://www.youtube.com"
    };
    if (innertube.visitorData) {
      headers["x-goog-visitor-id"] = innertube.visitorData;
    }

    const endpointResult = await fetchTextWithContext("youtubei/get_transcript", endpoint, signal, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        context: innertube.context,
        params: params
      })
    });
    if (!endpointResult || endpointResult.error) {
      logFetchInspection(
        "youtubei/get_transcript",
        endpoint,
        endpointResult,
        endpointResult && endpointResult.body ? endpointResult.body : "",
        "json",
        endpointResult && endpointResult.error ? classifyFetchError(endpointResult.error) : "request_error",
        endpointResult ? detectPayloadKind(endpointResult.contentType, endpointResult.body) : "unknown",
        endpointResult && endpointResult.transport ? endpointResult.transport : ""
      );
      return null;
    }

    const responseKind = detectPayloadKind(endpointResult.contentType, endpointResult.body);
    const responseRejectReason =
      !endpointResult.ok
        ? "http_" + endpointResult.status
        : responseKind !== "json"
          ? "unexpected_" + responseKind
          : "";
    logFetchInspection(
      "youtubei/get_transcript",
      endpoint,
      endpointResult,
      endpointResult.body,
      "json",
      responseRejectReason,
      responseKind,
      endpointResult.transport
    );
    if (!endpointResult.ok) {
      return null;
    }
    if (responseKind !== "json") {
      return null;
    }

    let payload;
    try {
      payload = JSON.parse(endpointResult.body);
    } catch {
      logDebug("youtubei/get_transcript rejected after parse", { reason: "invalid_json" });
      return null;
    }
    const cues = mapGetTranscriptResponseToCues(payload);
    logDebug("youtubei/get_transcript parsed", {
      cues: cues.length,
      rejectionReason: cues.length ? "" : "parser_rejected_no_cues"
    });
    return cues.length ? cues : null;
  }

  async function waitForTextTrackCues(track, signal, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (signal && signal.aborted) {
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        throw abortError;
      }
      const cues = cueListToArray(track && track.cues);
      if (cues.length) {
        return true;
      }
      await new Promise(function (resolve) {
        window.setTimeout(resolve, 120);
      });
    }
    return false;
  }

  async function loadFromTextTracks(videoElement, signal) {
    if (!videoElement || !videoElement.textTracks || !videoElement.textTracks.length) {
      logDebug("textTracks skipped: none available");
      return null;
    }

    const tracks = [];
    for (let index = 0; index < videoElement.textTracks.length; index += 1) {
      tracks.push(videoElement.textTracks[index]);
    }

    for (let index = 0; index < tracks.length; index += 1) {
      const track = tracks[index];
      const previousMode = track.mode;
      try {
        if (track.mode === "disabled") {
          track.mode = "hidden";
        }
      } catch {
        // Ignore mode assignment failures.
      }

      try {
        await waitForTextTrackCues(track, signal, 2200);
      } catch (error) {
        if (error && error.name === "AbortError") {
          throw error;
        }
      }

      const cues = mapTextTrackToCues(track);
      logDebug("textTracks track result", {
        index: index,
        language: track && track.language ? track.language : "",
        kind: track && track.kind ? track.kind : "",
        cues: cues.length
      });
      try {
        if (track.mode !== previousMode) {
          track.mode = previousMode;
        }
      } catch {
        // Ignore mode restore failures.
      }

      if (cues.length) {
        return {
          cues: cues,
          track: {
            languageCode: typeof track.language === "string" ? track.language : "",
            kind: typeof track.kind === "string" ? track.kind : ""
          }
        };
      }
    }

    return null;
  }

  async function loadFromInterceptedTimedtext(videoId, signal, timeoutMs) {
    const startedAt = Date.now();
    const deadline = startedAt + (Number.isFinite(timeoutMs) ? timeoutMs : 3400);
    const delayFn = typeof scope.setTimeout === "function" ? scope.setTimeout.bind(scope) : setTimeout;
    const seenCaptureKeys = new Set();
    let lastRejectReason = "no_captures_observed";
    let observedCount = 0;

    while (Date.now() <= deadline) {
      if (signal && signal.aborted) {
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        throw abortError;
      }

      const captures = getPageTimedtextCaptures(videoId);
      observedCount = captures.length;

      for (let index = captures.length - 1; index >= 0; index -= 1) {
        const capture = captures[index];
        if (!capture || typeof capture.url !== "string") {
          continue;
        }
        const key = String(capture.seenAt || 0) + "|" + capture.url + "|" + (capture.source || "");
        if (seenCaptureKeys.has(key)) {
          continue;
        }
        seenCaptureKeys.add(key);

        const payloadKind = detectPayloadKind(capture.contentType, capture.body);
        const parserSelected =
          payloadKind === "json" ? "json" : payloadKind === "xml" ? "xml" : payloadKind === "vtt" ? "vtt" : "none";
        const rejectionReason =
          !capture.body
            ? "empty_response"
            : payloadKind === "html"
              ? "unexpected_html"
              : parserSelected === "none"
                ? "unexpected_" + payloadKind
                : "";

        logFetchInspection(
          "player-caption-intercept",
          capture.url,
          {
            status: Number(capture.status || 0),
            url: capture.url,
            headers: {
              get() {
                return String(capture.contentType || "");
              }
            }
          },
          capture.body || "",
          parserSelected,
          rejectionReason,
          payloadKind,
          capture.source || "page-context"
        );

        if (!capture.body || parserSelected === "none" || payloadKind === "html") {
          lastRejectReason = rejectionReason || "rejected_payload";
          continue;
        }

        const cues = parseCuesByPayloadKind(payloadKind, capture.body);
        if (!cues.length) {
          lastRejectReason = "parser_rejected_no_cues";
          continue;
        }

        logDebug("player-caption intercept accepted", {
          cues: cues.length,
          payloadKind: payloadKind,
          source: capture.source || "page-context"
        });
        return {
          cues: cues,
          track: {
            languageCode: "",
            kind: "intercepted_player_caption"
          }
        };
      }

      await new Promise(function (resolve) {
        delayFn(resolve, 220);
      });
    }

    logDebug("player-caption intercept unavailable", {
      observedCaptures: observedCount,
      rejectionReason: lastRejectReason
    });
    return null;
  }

  async function fetchCues(track, signal, richTimedtextProbe) {
    if (!track || typeof track.baseUrl !== "string" || !track.baseUrl) {
      logDebug("timedtext skipped: invalid track baseUrl", {
        languageCode: track && track.languageCode ? track.languageCode : ""
      });
      return [];
    }

    const richProbeLanguage = richTimedtextProbe && richTimedtextProbe.languageCode ? String(richTimedtextProbe.languageCode).toLowerCase() : "";
    const trackLanguage = track && track.languageCode ? String(track.languageCode).toLowerCase() : "";
    const richProbeMatchesTrack = !richProbeLanguage || !trackLanguage || richProbeLanguage === trackLanguage;
    if (richTimedtextProbe && richTimedtextProbe.url && richProbeMatchesTrack) {
      const richResult = await fetchTextWithContext("timedtext-rich", richTimedtextProbe.url, signal, {
        method: "GET"
      });
      const richKind = detectPayloadKind(
        richResult ? richResult.contentType : "",
        richResult ? richResult.body : ""
      );
      const richParser = richKind === "json" ? "json" : richKind === "xml" ? "xml" : richKind === "vtt" ? "vtt" : "";
      const richRejectReason =
        !richResult || richResult.error
          ? richResult && richResult.error
            ? classifyFetchError(richResult.error)
            : "request_error"
          : !richResult.ok
            ? "http_" + richResult.status
            : richKind === "empty"
              ? "empty_response"
              : !richParser
                ? "unexpected_" + richKind
                : "";
      logFetchInspection(
        "timedtext-rich",
        richTimedtextProbe.url,
        richResult,
        richResult ? richResult.body : "",
        richParser || "none",
        richRejectReason,
        richKind,
        richResult && richResult.transport ? richResult.transport : ""
      );
      if (richResult && !richResult.error && richResult.ok && richParser) {
        const richCues = parseCuesByPayloadKind(richKind, richResult.body);
        if (richCues.length) {
          logDebug("timedtext rich accepted", {
            languageCode: track.languageCode || "",
            parser: richParser,
            cues: richCues.length
          });
          return richCues;
        }
      }
    }

    const json3Url = withFmt(track.baseUrl, "json3");
    const jsonResult = await fetchTextWithContext("timedtext-json3", json3Url, signal, {
      method: "GET"
    });
    const jsonKind = detectPayloadKind(
      jsonResult ? jsonResult.contentType : "",
      jsonResult ? jsonResult.body : ""
    );
    const jsonWatchLike = looksLikeWatchPagePayload(
      jsonResult ? jsonResult.body : "",
      jsonResult ? jsonResult.url : ""
    );
    const jsonRejectReason =
      !jsonResult || jsonResult.error
        ? jsonResult && jsonResult.error
          ? classifyFetchError(jsonResult.error)
          : "request_error"
        : !jsonResult.ok
          ? "http_" + jsonResult.status
          : jsonKind === "html" && jsonWatchLike
            ? "wrong_payload_watch_page_html"
            : jsonKind === "empty"
              ? "empty_response"
              : jsonKind !== "json"
                ? "unexpected_" + jsonKind
                : "";
    logFetchInspection(
      "timedtext-json3",
      json3Url,
      jsonResult,
      jsonResult ? jsonResult.body : "",
      "json",
      jsonRejectReason,
      jsonKind,
      jsonResult && jsonResult.transport ? jsonResult.transport : ""
    );
    if (jsonResult && !jsonResult.error && jsonResult.ok) {
      const jsonCues = parseCuesByPayloadKind(jsonKind, jsonResult.body);
      if (jsonCues.length) {
        logDebug("timedtext json3 accepted", {
          languageCode: track.languageCode || "",
          cues: jsonCues.length
        });
        return jsonCues;
      }
      logDebug("timedtext json3 rejected after parse", {
        languageCode: track.languageCode || "",
        reason: jsonKind === "json" ? "parser_rejected_no_cues" : jsonRejectReason || "unexpected_payload"
      });
    }

    const baseResult = await fetchTextWithContext("timedtext-base", track.baseUrl, signal, {
      method: "GET"
    });
    const baseKind = detectPayloadKind(
      baseResult ? baseResult.contentType : "",
      baseResult ? baseResult.body : ""
    );
    const baseWatchLike = looksLikeWatchPagePayload(
      baseResult ? baseResult.body : "",
      baseResult ? baseResult.url : ""
    );
    const baseParser = baseKind === "json" ? "json" : baseKind === "xml" ? "xml" : baseKind === "vtt" ? "vtt" : "";
    const baseRejectReason =
      !baseResult || baseResult.error
        ? baseResult && baseResult.error
          ? classifyFetchError(baseResult.error)
          : "request_error"
        : !baseResult.ok
          ? "http_" + baseResult.status
          : baseKind === "html" && baseWatchLike
            ? "wrong_payload_watch_page_html"
            : baseKind === "empty"
              ? "empty_response"
              : !baseParser
                ? "unexpected_" + baseKind
                : "";
    logFetchInspection(
      "timedtext-base",
      track.baseUrl,
      baseResult,
      baseResult ? baseResult.body : "",
      baseParser || "none",
      baseRejectReason,
      baseKind,
      baseResult && baseResult.transport ? baseResult.transport : ""
    );
    if (baseResult && !baseResult.error && baseResult.ok && baseParser) {
      const baseCues = parseCuesByPayloadKind(baseKind, baseResult.body);
      if (baseCues.length) {
        logDebug("timedtext base accepted", {
          languageCode: track.languageCode || "",
          parser: baseParser,
          cues: baseCues.length
        });
        return baseCues;
      }
      logDebug("timedtext base rejected after parse", {
        languageCode: track.languageCode || "",
        parser: baseParser,
        reason: "parser_rejected_no_cues"
      });
    }

    const vttUrl = withFmt(track.baseUrl, "vtt");
    const vttResult = await fetchTextWithContext("timedtext-vtt", vttUrl, signal, {
      method: "GET"
    });
    const vttKind = detectPayloadKind(
      vttResult ? vttResult.contentType : "",
      vttResult ? vttResult.body : ""
    );
    const vttWatchLike = looksLikeWatchPagePayload(
      vttResult ? vttResult.body : "",
      vttResult ? vttResult.url : ""
    );
    const vttRejectReason =
      !vttResult || vttResult.error
        ? vttResult && vttResult.error
          ? classifyFetchError(vttResult.error)
          : "request_error"
        : !vttResult.ok
          ? "http_" + vttResult.status
        : vttKind === "html" && vttWatchLike
          ? "wrong_payload_watch_page_html"
          : vttKind === "empty"
            ? "empty_response"
            : vttKind !== "vtt"
              ? "unexpected_" + vttKind
              : "";
    logFetchInspection(
      "timedtext-vtt",
      vttUrl,
      vttResult,
      vttResult ? vttResult.body : "",
      "vtt",
      vttRejectReason,
      vttKind,
      vttResult && vttResult.transport ? vttResult.transport : ""
    );
    if (!vttResult || vttResult.error || !vttResult.ok || vttKind !== "vtt") {
      return [];
    }
    const vttCues = mapVttToCues(vttResult.body);
    if (vttCues.length) {
      logDebug("timedtext vtt accepted", {
        languageCode: track.languageCode || "",
        cues: vttCues.length
      });
      return vttCues;
    }
    logDebug("timedtext vtt rejected after parse", {
      languageCode: track.languageCode || "",
      reason: "parser_rejected_no_cues"
    });
    return [];
  }

  async function loadTranscript(pageUrl, signal, options) {
    if (!isWatchPage(pageUrl)) {
      return { ok: false, reason: "Not a YouTube watch page." };
    }

    const videoId = getVideoId(pageUrl);
    if (!videoId) {
      return { ok: false, reason: "Missing video id." };
    }

    try {
      const pageSnapshot = getPageContextSnapshot();
      if (pageSnapshot) {
        const captureCount = getPageTimedtextCaptures(videoId).length;
        logDebug("page-context snapshot", {
          hasPlayerResponse: Boolean(pageSnapshot.hasPlayerResponse),
          trackCount: Array.isArray(pageSnapshot.captionTracks) ? pageSnapshot.captionTracks.length : 0,
          hasTranscriptParams: Boolean(pageSnapshot.transcriptParams),
          hasInnertubeContext: Boolean(pageSnapshot.ytcfg && pageSnapshot.ytcfg.INNERTUBE_CONTEXT),
          interceptedTimedtextCaptures: captureCount,
          hasRichTimedtextProbe: Boolean(
            pageSnapshot.timedtextProbe &&
              typeof pageSnapshot.timedtextProbe.lastRichUrl === "string" &&
              pageSnapshot.timedtextProbe.lastRichUrl
          )
        });
      } else {
        logDebug("page-context snapshot unavailable (content-script context only)");
      }

      const runFallbacks = async () => {
        const videoElement = options && options.videoElement;
        const trackFallback = await loadFromTextTracks(videoElement, signal);
        if (trackFallback && trackFallback.cues.length) {
          logDebug("accepted source: textTracks", { cues: trackFallback.cues.length });
          return {
            ok: true,
            videoId: videoId,
            cues: trackFallback.cues,
            track: trackFallback.track
          };
        }

        const transcriptApiCues = await fetchCuesFromGetTranscript(pageUrl, signal);
        if (transcriptApiCues && transcriptApiCues.length) {
          logDebug("accepted source: youtubei/get_transcript", { cues: transcriptApiCues.length });
          return {
            ok: true,
            videoId: videoId,
            cues: transcriptApiCues,
            track: {
              languageCode: "",
              kind: "get_transcript"
            }
          };
        }

        const transcriptDomCues = await loadFromTranscriptDom(signal);
        if (transcriptDomCues && transcriptDomCues.length) {
          logDebug("accepted source: transcript DOM", { cues: transcriptDomCues.length });
          return {
            ok: true,
            videoId: videoId,
            cues: transcriptDomCues,
            track: {
              languageCode: "",
              kind: "dom_transcript"
            }
          };
        }
        return null;
      };

      const interceptedResult = await loadFromInterceptedTimedtext(videoId, signal, 900);
      if (interceptedResult && interceptedResult.cues && interceptedResult.cues.length) {
        return {
          ok: true,
          videoId: videoId,
          cues: interceptedResult.cues,
          track: interceptedResult.track,
          mode: "intercepted player-caption mode"
        };
      }

      const playerResponse = await resolvePlayerResponse(pageUrl, signal);
      if (!playerResponse) {
        const fallbackResult = await runFallbacks();
        if (fallbackResult) {
          fallbackResult.mode = "direct transcript mode";
          return fallbackResult;
        }
        return { ok: false, reason: "Transcript metadata is unavailable." };
      }

      const tracks = getCaptionTracks(playerResponse);
      const candidates = buildTrackCandidates(tracks);
      const richTimedtextProbe = getRichTimedtextProbeForVideo(videoId);
      logDebug("caption track candidates", {
        totalTracks: tracks.length,
        candidateCount: candidates.length
      });
      if (richTimedtextProbe && richTimedtextProbe.url) {
        logDebug("timedtext rich probe available", {
          languageCode: richTimedtextProbe.languageCode || "",
          seenAt: richTimedtextProbe.seenAt || 0
        });
      }
      if (candidates[0] && candidates[0].baseUrl) {
        logDebug("caption track url params", summarizeCaptionUrl(candidates[0].baseUrl));
      }

      let selectedTrack = null;
      let cues = [];
      for (const candidate of candidates) {
        try {
          const candidateCues = await fetchCues(candidate, signal, richTimedtextProbe);
          if (candidateCues.length) {
            selectedTrack = candidate;
            cues = candidateCues;
            logDebug("accepted source: timedtext", {
              languageCode: candidate.languageCode || "",
              cues: candidateCues.length
            });
            break;
          }
        } catch (error) {
          if (error && error.name === "AbortError") {
            throw error;
          }
          logDebug("timedtext candidate rejected", {
            languageCode: candidate.languageCode || "",
            reason: classifyFetchError(error),
            message: String(error && error.message ? error.message : error)
          });
        }
      }

      if (!selectedTrack || !cues.length) {
        const fallbackResult = await runFallbacks();
        if (fallbackResult) {
          fallbackResult.mode = "direct transcript mode";
          return fallbackResult;
        }

        if (!candidates.length) {
          return { ok: false, reason: "No caption tracks were found." };
        }
        return { ok: false, reason: "No subtitle cues were found in available tracks." };
      }

      return {
        ok: true,
        videoId: videoId,
        cues: cues,
        track: {
          languageCode: selectedTrack.languageCode || "",
          kind: selectedTrack.kind || ""
        },
        mode: "direct transcript mode"
      };
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw error;
      }
      return { ok: false, reason: "Transcript loading failed.", detail: String(error && error.message ? error.message : error) };
    }
  }

  app.transcript = {
    getVideoId,
    isWatchPage,
    loadTranscript
  };
})(window);
