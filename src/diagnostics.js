(function initDiagnostics(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});
  if (app.diagnostics && app.diagnostics.__initialized) {
    return;
  }

  const MAX_EVENTS = 90;
  const startedAt = Date.now();
  const events = [];
  const counters = {};

  function isDebugEnabled() {
    try {
      return new URL(scope.location.href).searchParams.get("dcdebug") === "1";
    } catch {
      return false;
    }
  }

  function safeString(value) {
    const text = String(value || "");
    return text.length > 160 ? text.slice(0, 157) + "..." : text;
  }

  function sanitizeDetail(input) {
    if (!input || typeof input !== "object") {
      return {};
    }
    const output = {};
    const keys = Object.keys(input);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const value = input[key];
      if (/text|caption|transcript|body|token|cookie|title|url/i.test(key)) {
        output[key] = "[redacted]";
      } else if (typeof value === "number" || typeof value === "boolean") {
        output[key] = value;
      } else if (typeof value === "string") {
        output[key] = safeString(value);
      }
    }
    return output;
  }

  function record(eventName, detail) {
    if (!isDebugEnabled()) {
      return;
    }
    const event = safeString(eventName || "event");
    const entry = {
      t: Date.now() - startedAt,
      event,
      detail: sanitizeDetail(detail)
    };
    events.push(entry);
    while (events.length > MAX_EVENTS) {
      events.shift();
    }
    counters[event] = (counters[event] || 0) + 1;
    console.info("[Dialogue Captions][Diagnostics]", event, entry.detail);
  }

  function getReport() {
    let route = "";
    try {
      route = scope.location.hostname === "www.youtube.com" ? scope.location.pathname : "";
    } catch {
      route = "";
    }
    return {
      uptimeMs: Date.now() - startedAt,
      route,
      counters: { ...counters },
      events: events.slice()
    };
  }

  function clear() {
    events.length = 0;
    const keys = Object.keys(counters);
    for (let index = 0; index < keys.length; index += 1) {
      delete counters[keys[index]];
    }
  }

  app.diagnostics = {
    __initialized: true,
    clear,
    getReport,
    record
  };
})(window);
