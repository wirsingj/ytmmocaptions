(function initBubbleState(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});

  function asNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function cleanWith(cleanText, value) {
    return typeof cleanText === "function" ? cleanText(value) : String(value || "").trim();
  }

  function tokenCount(text) {
    return String(text || "").split(/\s+/).filter(Boolean).length;
  }

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return min;
    }
    return Math.max(min, Math.min(max, number));
  }

  function createBubbleRecord(data, cleanText) {
    const source = data && typeof data === "object" ? data : {};
    const start = Math.max(0, asNumber(source.start, 0));
    const end = Math.max(start + 0.25, asNumber(source.end, start + 0.25));
    const seekStart = Math.max(0, asNumber(source.seekStart, start));
    const locked = Boolean(source.locked);
    const text = cleanWith(cleanText, source.text);
    return {
      id: "",
      sourceId: source.sourceId ? String(source.sourceId) : "",
      partIndex: Number.isInteger(source.partIndex) ? source.partIndex : 0,
      start: start,
      end: end,
      seekStart: seekStart,
      ts_start: start,
      ts_stop: end,
      text: text,
      tokens: normalizeBubbleTokens(source.tokens, text, start, end),
      locked: locked,
      immutable: locked
    };
  }

  function normalizeBubbleTokens(tokens, bubbleText, bubbleStart, bubbleEnd) {
    const source = Array.isArray(tokens) ? tokens : [];
    const normalized = [];
    for (let index = 0; index < source.length; index += 1) {
      const token = source[index];
      const text = String(token && token.text ? token.text : "").trim();
      const start = asNumber(token && token.start, NaN);
      const end = asNumber(token && token.end, NaN);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        continue;
      }
      normalized.push({
        text,
        start: Math.max(bubbleStart, start),
        end: Math.min(Math.max(start + 0.05, end), bubbleEnd)
      });
    }
    if (normalized.length) {
      return normalized.sort((left, right) => left.start - right.start);
    }
    return estimateBubbleTokens(bubbleText, bubbleStart, bubbleEnd);
  }

  function estimateBubbleTokens(text, start, end) {
    const words = getWordRanges(text);
    if (!words.length) {
      return [];
    }
    const duration = Math.max(0.25, end - start);
    const each = duration / words.length;
    return words.map((word, index) => ({
      text: word.text,
      start: start + each * index,
      end: index === words.length - 1 ? end : start + each * (index + 1)
    }));
  }

  function withDisplayIds(records) {
    const source = Array.isArray(records) ? records : [];
    const output = [];
    for (let index = 0; index < source.length; index += 1) {
      const record = source[index];
      if (!record || !record.text) {
        continue;
      }
      output.push({
        ...record,
        id: output.length
      });
    }
    return output;
  }

  function trimLeadingOverlap(previousText, nextText, options) {
    const opts = options && typeof options === "object" ? options : {};
    const normalizeText = typeof opts.normalizeText === "function" ? opts.normalizeText : (value) => String(value || "").trim();
    const normalizeToken =
      typeof opts.normalizeToken === "function"
        ? opts.normalizeToken
        : (value) => String(value || "").toLowerCase().replace(/[^\w]/g, "");

    const previous = normalizeText(previousText);
    const next = normalizeText(nextText);
    if (!previous || !next) {
      return { text: next, removedTokens: 0, originalTokens: tokenCount(next) };
    }

    const previousTokens = previous.split(/\s+/).filter(Boolean);
    const nextTokens = next.split(/\s+/).filter(Boolean);
    const originalTokens = nextTokens.length;
    const maxOverlap = Math.min(18, previousTokens.length, nextTokens.length);
    for (let size = maxOverlap; size >= 3; size -= 1) {
      let matches = true;
      for (let index = 0; index < size; index += 1) {
        const left = normalizeToken(previousTokens[previousTokens.length - size + index]);
        const right = normalizeToken(nextTokens[index]);
        if (!left || left !== right) {
          matches = false;
          break;
        }
      }
      if (!matches) {
        continue;
      }
      const trimmed = normalizeText(nextTokens.slice(size).join(" "));
      return {
        text: trimmed || next,
        removedTokens: trimmed ? size : 0,
        originalTokens: originalTokens
      };
    }

    return { text: next, removedTokens: 0, originalTokens: originalTokens };
  }

  function adjustSeekStartForTrim(chunk, trimInfo, fallbackDurationSeconds) {
    const source = chunk && typeof chunk === "object" ? chunk : {};
    const info = trimInfo && typeof trimInfo === "object" ? trimInfo : {};
    const start = asNumber(source.seekStart, asNumber(source.start, 0));
    if (!info.removedTokens || !info.originalTokens) {
      return Math.max(0, start);
    }

    const fallbackDuration = Math.max(0.25, asNumber(fallbackDurationSeconds, 8));
    const end = Math.max(start + 0.25, asNumber(source.end, start + fallbackDuration));
    const ratio = Math.max(0, Math.min(0.85, Number(info.removedTokens) / Math.max(1, Number(info.originalTokens))));
    return Math.max(0, start + (end - start) * ratio);
  }

  function trimChunkAgainstPrevious(previousText, chunk, options) {
    const source = chunk && typeof chunk === "object" ? chunk : {};
    const info = trimLeadingOverlap(previousText, source.text, options);
    return {
      ...source,
      text: info.text,
      seekStart: adjustSeekStartForTrim(source, info, options && options.fallbackDurationSeconds)
    };
  }

  function markFlashOnStart(chunk, seekStart, source) {
    if (!chunk || typeof chunk !== "object") {
      return false;
    }
    const flashAt = Number(seekStart);
    if (!Number.isFinite(flashAt)) {
      return false;
    }
    chunk.flashOnStart = {
      at: flashAt,
      source: source || "seek",
      done: false
    };
    return true;
  }

  function consumeFlashOnStart(chunk, currentTime) {
    if (!chunk || !chunk.flashOnStart || chunk.flashOnStart.done) {
      return false;
    }
    const flashAt = Number(chunk.flashOnStart.at);
    const now = Number(currentTime);
    if (!Number.isFinite(flashAt) || !Number.isFinite(now) || now < flashAt) {
      return false;
    }
    chunk.flashOnStart.done = true;
    return true;
  }

  function getWordRanges(text) {
    const source = String(text || "");
    const ranges = [];
    const pattern = /\S+/g;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      ranges.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0]
      });
    }
    return ranges;
  }

  function getWordWeight(word) {
    const source = String(word || "");
    const coreLength = source.replace(/[^\w]/g, "").length;
    const lengthWeight = Math.min(0.7, Math.max(0, coreLength - 4) * 0.08);
    const pauseWeight = /[.!?]["')\]]*$/.test(source)
      ? 0.75
      : /[,;:]["')\]]*$/.test(source)
        ? 0.34
        : 0;
    return 1 + lengthWeight + pauseWeight;
  }

  function getWeightedWordIndex(words, progress) {
    if (!Array.isArray(words) || !words.length) {
      return 0;
    }
    const weights = words.map((word) => getWordWeight(word.text));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const target = clamp(progress, 0, 0.999) * totalWeight;
    let running = 0;
    for (let index = 0; index < weights.length; index += 1) {
      running += weights[index];
      if (target < running) {
        return index;
      }
    }
    return words.length - 1;
  }

  function getReadingGlowRange(chunk, currentTime, options) {
    const source = chunk && typeof chunk === "object" ? chunk : {};
    const text = String(source.text || "");
    const words = getWordRanges(text);
    if (!text || !words.length) {
      return null;
    }

    const start = asNumber(source.seekStart, asNumber(source.start, 0));
    const end = Math.max(start + 0.25, asNumber(source.end, start + 0.25));
    const now = Number(currentTime);
    if (!Number.isFinite(now)) {
      return null;
    }

    const opts = options && typeof options === "object" ? options : {};
    const tokenRange = getTokenReadingGlowRange(source, words, now, opts);
    if (tokenRange) {
      return tokenRange;
    }

    const rawDuration = Math.max(0.25, end - start);
    const wordCount = words.length;
    const maxStableWordsPerSecond =
      Number.isFinite(opts.maxWordsPerSecond) && opts.maxWordsPerSecond > 0
        ? Number(opts.maxWordsPerSecond)
        : 5.15;
    const estimatedMinimumDuration = wordCount / maxStableWordsPerSecond;
    const duration = Math.max(rawDuration, estimatedMinimumDuration);
    const wordsPerSecond = wordCount / duration;
    const leadSeconds =
      Number.isFinite(opts.leadSeconds) && opts.leadSeconds >= 0
        ? Number(opts.leadSeconds)
        : 0;
    const progress = clamp((now + leadSeconds - start) / duration, 0, 0.999);
    const baseWindow =
      Number.isFinite(opts.windowWords) && opts.windowWords > 0
        ? Math.round(opts.windowWords)
        : wordsPerSecond >= 4.8
          ? 5
          : wordsPerSecond >= 3.2
            ? 4
            : 4;
    const windowWords = Math.max(3, Math.min(6, baseWindow));
    const center = getWeightedWordIndex(words, progress);
    const halfWindow = Math.floor((windowWords - 1) / 2);
    const maxFirstWord = Math.max(0, wordCount - windowWords);
    const firstWord = Math.max(0, Math.min(maxFirstWord, center - halfWindow));
    const lastWord = Math.min(wordCount - 1, firstWord + windowWords - 1);

    return {
      start: words[firstWord].start,
      end: words[lastWord].end,
      firstWord,
      lastWord,
      progress
    };
  }

  function getTokenReadingGlowRange(chunk, words, now, opts) {
    const tokens = Array.isArray(chunk.tokens) ? chunk.tokens : [];
    if (!tokens.length || !Array.isArray(words) || !words.length) {
      return null;
    }
    const leadSeconds =
      Number.isFinite(opts.leadSeconds) && opts.leadSeconds >= 0
        ? Number(opts.leadSeconds)
        : 0;
    const targetTime = now + leadSeconds;
    let activeTokenIndex = -1;
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      const start = asNumber(token && token.start, NaN);
      const end = asNumber(token && token.end, NaN);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        continue;
      }
      if (targetTime >= start && targetTime <= end + 0.08) {
        activeTokenIndex = index;
        break;
      }
      if (targetTime > end) {
        activeTokenIndex = index;
      }
    }
    if (activeTokenIndex < 0) {
      return null;
    }
    const firstWord = getWordIndexForToken(words, tokens[activeTokenIndex], activeTokenIndex);
    const windowWords =
      Number.isFinite(opts.windowWords) && opts.windowWords > 0
        ? Math.max(3, Math.min(6, Math.round(opts.windowWords)))
        : 3;
    const halfWindow = Math.floor((windowWords - 1) / 2);
    const maxFirstWord = Math.max(0, words.length - windowWords);
    const centeredFirstWord = Math.max(0, Math.min(maxFirstWord, firstWord - halfWindow));
    const lastWord = Math.min(words.length - 1, centeredFirstWord + windowWords - 1);
    return {
      start: words[centeredFirstWord].start,
      end: words[lastWord].end,
      firstWord: centeredFirstWord,
      lastWord,
      progress: clamp(activeTokenIndex / Math.max(1, tokens.length - 1), 0, 0.999)
    };
  }

  function getWordIndexForToken(words, token, fallbackIndex) {
    const normalizedToken = normalizeWordText(token && token.text);
    const fallback = Math.max(0, Math.min(words.length - 1, Number.isFinite(fallbackIndex) ? Math.floor(fallbackIndex) : 0));
    if (!normalizedToken) {
      return fallback;
    }
    const searchStart = Math.max(0, fallback - 4);
    const searchEnd = Math.min(words.length - 1, fallback + 6);
    for (let index = searchStart; index <= searchEnd; index += 1) {
      if (normalizeWordText(words[index] && words[index].text) === normalizedToken) {
        return index;
      }
    }
    for (let index = 0; index < words.length; index += 1) {
      if (normalizeWordText(words[index] && words[index].text) === normalizedToken) {
        return index;
      }
    }
    return fallback;
  }

  function normalizeWordText(word) {
    return String(word || "").toLowerCase().replace(/[^\w]/g, "");
  }

  function splitTextByRange(text, range) {
    const source = String(text || "");
    if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) {
      return [{ text: source, active: false }];
    }
    const start = Math.max(0, Math.min(source.length, Math.floor(range.start)));
    const end = Math.max(start, Math.min(source.length, Math.ceil(range.end)));
    return [
      { text: source.slice(0, start), active: false },
      { text: source.slice(start, end), active: true },
      { text: source.slice(end), active: false }
    ].filter((part) => part.text);
  }

  app.bubbleState = {
    adjustSeekStartForTrim,
    consumeFlashOnStart,
    createBubbleRecord,
    getReadingGlowRange,
    markFlashOnStart,
    splitTextByRange,
    tokenCount,
    trimChunkAgainstPrevious,
    trimLeadingOverlap,
    withDisplayIds
  };
})(window);
