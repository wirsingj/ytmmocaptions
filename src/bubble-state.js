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
    const rawText = cleanWith(cleanText, source.rawText || source.text);
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
      rawText: rawText,
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

  function trimTokensForLeadingOverlap(tokens, removedTokens) {
    const source = Array.isArray(tokens) ? tokens : [];
    const count = Math.max(0, Number.isFinite(Number(removedTokens)) ? Math.floor(Number(removedTokens)) : 0);
    return count > 0 ? source.slice(count) : source.slice();
  }

  function getFirstTokenStart(tokens) {
    const source = Array.isArray(tokens) ? tokens : [];
    for (let index = 0; index < source.length; index += 1) {
      const start = asNumber(source[index] && source[index].start, NaN);
      if (Number.isFinite(start) && start >= 0) {
        return start;
      }
    }
    return NaN;
  }

  function trimChunkAgainstPrevious(previousText, chunk, options) {
    const source = chunk && typeof chunk === "object" ? chunk : {};
    const info = trimLeadingOverlap(previousText, source.text, options);
    const result = {
      ...source,
      text: info.text,
      seekStart: adjustSeekStartForTrim(source, info, options && options.fallbackDurationSeconds)
    };
    if (Array.isArray(source.tokens)) {
      result.tokens = trimTokensForLeadingOverlap(source.tokens, info.removedTokens);
      if (info.removedTokens > 0) {
        const firstTokenStart = getFirstTokenStart(result.tokens);
        if (Number.isFinite(firstTokenStart)) {
          result.seekStart = Math.max(0, firstTokenStart);
        }
      }
    }
    return result;
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
    if (!hasUsableTokenWordShape(tokens, words)) {
      return null;
    }
    const leadSeconds =
      Number.isFinite(opts.leadSeconds) && opts.leadSeconds >= 0
        ? Number(opts.leadSeconds)
        : 0;
    const targetTime = now + leadSeconds;
    let activeTokenIndex = -1;
    let previousEndedTokenIndex = -1;
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
        previousEndedTokenIndex = index;
      }
    }
    if (activeTokenIndex < 0) {
      return null;
    }
    if (activeTokenIndex === previousEndedTokenIndex && isInTokenTimingGap(tokens, activeTokenIndex, targetTime)) {
      return null;
    }
    const firstWord = getWordIndexForTokenSequence(words, tokens, activeTokenIndex);
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

  function hasUsableTokenWordShape(tokens, words) {
    const normalizedTokenCount = tokens.reduce((count, token) => {
      return normalizeWordText(token && token.text) ? count + 1 : count;
    }, 0);
    const wordCount = Array.isArray(words) ? words.length : 0;
    if (!normalizedTokenCount || !wordCount) {
      return false;
    }
    const ratio = normalizedTokenCount / wordCount;
    return ratio >= 0.65 && ratio <= 1.8;
  }

  function isInTokenTimingGap(tokens, tokenIndex, targetTime) {
    const previous = tokens[tokenIndex];
    const next = tokens[tokenIndex + 1];
    if (!previous || !next) {
      return false;
    }
    const previousEnd = asNumber(previous.end, NaN);
    const nextStart = asNumber(next.start, NaN);
    if (!Number.isFinite(previousEnd) || !Number.isFinite(nextStart) || nextStart <= previousEnd) {
      return false;
    }
    return targetTime > previousEnd + 0.08 && targetTime < nextStart;
  }

  function getWordIndexForTokenSequence(words, tokens, activeTokenIndex) {
    const wordCount = Array.isArray(words) ? words.length : 0;
    const tokenCount = Array.isArray(tokens) ? tokens.length : 0;
    if (!wordCount || !tokenCount) {
      return 0;
    }

    const targetIndex = Math.max(0, Math.min(tokenCount - 1, Math.floor(Number(activeTokenIndex) || 0)));
    const normalizedWords = words.map((word) => normalizeWordText(word && word.text));
    let cursor = 0;
    let lastMatchedWord = -1;

    for (let tokenIndex = 0; tokenIndex <= targetIndex; tokenIndex += 1) {
      const token = tokens[tokenIndex];
      const normalizedToken = normalizeWordText(token && token.text);
      if (!normalizedToken) {
        continue;
      }

      const expected = getProportionalWordFallback(wordCount, tokenCount, tokenIndex);
      const found = findNextWordIndexNear(normalizedWords, normalizedToken, cursor, expected);
      if (found >= 0) {
        lastMatchedWord = found;
        cursor = Math.min(wordCount, found + 1);
        if (tokenIndex === targetIndex) {
          return found;
        }
      }
    }

    const fallback = getProportionalWordFallback(wordCount, tokenCount, targetIndex);
    if (lastMatchedWord >= 0) {
      return Math.max(0, Math.min(wordCount - 1, Math.max(fallback, lastMatchedWord)));
    }
    return getWordIndexForToken(words, tokens[targetIndex], fallback);
  }

  function findNextWordIndexNear(normalizedWords, normalizedToken, startIndex, expectedIndex) {
    const start = Math.max(0, Number(startIndex) || 0);
    if (start >= normalizedWords.length) {
      return -1;
    }
    const expected = Math.max(0, Math.min(normalizedWords.length - 1, Number.isFinite(expectedIndex) ? Math.floor(expectedIndex) : start));
    const searchStart = Math.max(start, expected - 3);
    const searchEnd = Math.min(normalizedWords.length - 1, Math.max(searchStart, expected + 3));
    for (let index = searchStart; index <= searchEnd; index += 1) {
      if (normalizedWords[index] === normalizedToken) {
        return index;
      }
    }
    return -1;
  }

  function getProportionalWordFallback(wordCount, tokenCount, tokenIndex) {
    const words = Math.max(1, Number(wordCount) || 1);
    const tokens = Math.max(1, Number(tokenCount) || 1);
    const index = Math.max(0, Number(tokenIndex) || 0);
    return Math.max(0, Math.min(words - 1, Math.round((index / Math.max(1, tokens - 1)) * (words - 1))));
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
