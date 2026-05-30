(function initCaptionText(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});

  function normalizeText(input) {
    const raw = String(input || "")
      .replace(/\u200b/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/\s+>>\s+/g, "\n");
    const lines = raw
      .split("\n")
      .map((line) =>
        line
          .replace(/^\s*>>\s*/, "")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter(Boolean);
    return lines.join("\n");
  }

  function sanitizeOverlayText(input) {
    return String(input || "")
      .replace(
        /(^|[\s>])(?:English|[A-Z][A-Za-z -]{1,28})\s*\(\s*(?:auto-generated|automatic captions)\s*\)/g,
        "$1"
      )
      .replace(/\bclick for settings\b/gi, " ")
      .replace(/\bsubtitles\/closed captions\b/gi, " ")
      .replace(/\[\s*[_-]+\s*\]/g, " ");
  }

  function looksAllCapsCaptionSegment(text, minLetters, minWords) {
    const normalized = normalizeText(text);
    if (!normalized) {
      return false;
    }
    const letters = normalized.match(/[A-Za-z]/g) || [];
    if (letters.length < minLetters) {
      return false;
    }
    const words = normalized.match(/[A-Za-z][A-Za-z']*/g) || [];
    if (words.length < minWords) {
      return false;
    }
    const uppercase = normalized.match(/[A-Z]/g) || [];
    const lowercase = normalized.match(/[a-z]/g) || [];
    return uppercase.length / letters.length >= 0.82 && lowercase.length / letters.length <= 0.08;
  }

  function looksAllCapsCaption(text) {
    return looksAllCapsCaptionSegment(text, 16, 4);
  }

  function sentenceCaseAllCapsCaption(text) {
    let softened = normalizeText(text).toLowerCase();
    softened = softened
      .replace(/\bi'm\b/g, "I'm")
      .replace(/\bi'll\b/g, "I'll")
      .replace(/\bi'd\b/g, "I'd")
      .replace(/\bi've\b/g, "I've")
      .replace(/\bi\b/g, "I");
    return softened.replace(/(^|[.!?]\s+)(["'(\[]?)([a-z])/g, (match, prefix, opener, letter) =>
      prefix + opener + letter.toUpperCase()
    );
  }

  function softenSpeakerLabel(label) {
    const value = String(label || "");
    const name = value.replace(/:\s*$/, "");
    const suffix = value.slice(name.length);
    if (!/^[A-Z]{4,}$/.test(name)) {
      return value;
    }
    return name.charAt(0) + name.slice(1).toLowerCase() + suffix;
  }

  function softenSpeakerLabeledAllCaps(text) {
    const normalized = normalizeText(text);
    const labelPattern = /\b[A-Z][A-Za-z'.-]{1,24}:\s*/g;
    let match = labelPattern.exec(normalized);
    if (!match) {
      return normalized;
    }

    let cursor = 0;
    let changed = false;
    let softened = "";
    while (match) {
      const beforeLabel = normalized.slice(cursor, match.index);
      softened += looksAllCapsCaptionSegment(beforeLabel, 4, 1)
        ? sentenceCaseAllCapsCaption(beforeLabel)
        : beforeLabel;
      softened += softenSpeakerLabel(match[0]);
      cursor = labelPattern.lastIndex;
      match = labelPattern.exec(normalized);
      const segmentEnd = match ? match.index : normalized.length;
      const segment = normalized.slice(cursor, segmentEnd);
      if (looksAllCapsCaptionSegment(segment, 4, 1)) {
        softened += sentenceCaseAllCapsCaption(segment) + (/\s$/.test(segment) ? " " : "");
        changed = true;
      } else {
        softened += segment;
      }
      cursor = segmentEnd;
    }

    return changed ? normalizeText(softened) : normalized;
  }

  function softenAllCapsCaption(text) {
    const normalized = normalizeText(text);
    const labelAware = softenSpeakerLabeledAllCaps(normalized);
    if (labelAware !== normalized) {
      return labelAware;
    }
    if (looksAllCapsCaption(normalized)) {
      return sentenceCaseAllCapsCaption(normalized);
    }
    return normalized;
  }

  function toCanonical(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function collapseRepeatedPhrases(text) {
    const input = normalizeText(text);
    if (!input) {
      return "";
    }
    const words = input.split(" ").filter(Boolean);
    if (words.length < 6) {
      return input;
    }

    const compact = words.slice();
    let changed = true;
    while (changed) {
      changed = false;
      const maxWindow = Math.min(14, Math.floor(compact.length / 2));
      for (let windowSize = maxWindow; windowSize >= 3; windowSize -= 1) {
        for (let index = 0; index + windowSize * 2 <= compact.length; index += 1) {
          let same = true;
          for (let offset = 0; offset < windowSize; offset += 1) {
            const left = String(compact[index + offset] || "").toLowerCase();
            const right = String(compact[index + windowSize + offset] || "").toLowerCase();
            if (left !== right) {
              same = false;
              break;
            }
          }
          if (!same) {
            continue;
          }
          compact.splice(index + windowSize, windowSize);
          changed = true;
          index = Math.max(-1, index - windowSize);
        }
      }
    }

    return normalizeText(compact.join(" "));
  }

  function collapseRepeatedSentences(text) {
    const input = normalizeText(text);
    if (!input) {
      return "";
    }
    const parts = input.match(/[^.!?]+[.!?]["')\]]*|[^.!?]+$/g) || [input];
    const seen = new Set();
    const kept = [];
    for (let index = 0; index < parts.length; index += 1) {
      const part = normalizeText(parts[index]);
      const canonical = toCanonical(part);
      if (!part || !canonical) {
        continue;
      }
      if (canonical.length >= 24 && seen.has(canonical)) {
        continue;
      }
      if (canonical.length >= 24) {
        seen.add(canonical);
      }
      kept.push(part);
    }
    return normalizeText(kept.join(" "));
  }

  function collapseOverlaySpam(input) {
    const normalized = normalizeText(input);
    if (!normalized) {
      return "";
    }
    const collapsed = collapseRepeatedPhrases(normalized);
    return collapsed ? collapseRepeatedSentences(collapsed) : "";
  }

  function cleanCandidate(input) {
    const normalized = normalizeText(sanitizeOverlayText(input));
    if (!normalized) {
      return "";
    }
    const lower = normalized.toLowerCase();
    if (
      lower === "cc" ||
      lower === "subtitles" ||
      lower === "closed captions" ||
      lower === "auto-generated"
    ) {
      return "";
    }
    return softenAllCapsCaption(collapseOverlaySpam(normalized));
  }

  function isHighOverlap(leftText, rightText) {
    const left = toCanonical(leftText);
    const right = toCanonical(rightText);
    if (!left || !right) {
      return false;
    }
    if (left === right) {
      return true;
    }
    if (left.length >= 22 && right.length >= 22 && (left.includes(right) || right.includes(left))) {
      return true;
    }

    const leftTokens = left.split(" ").filter(Boolean);
    const rightTokens = right.split(" ").filter(Boolean);
    if (!leftTokens.length || !rightTokens.length) {
      return false;
    }
    const rightSet = new Set(rightTokens);
    let overlap = 0;
    for (let index = 0; index < leftTokens.length; index += 1) {
      if (rightSet.has(leftTokens[index])) {
        overlap += 1;
      }
    }
    return overlap / Math.max(leftTokens.length, rightTokens.length) >= 0.8;
  }

  function dedupeCandidates(candidates) {
    const source = Array.isArray(candidates) ? candidates : [];
    const selected = [];
    for (let index = 0; index < source.length; index += 1) {
      const candidate = cleanCandidate(source[index]);
      if (!candidate) {
        continue;
      }
      let dropped = false;
      for (let selectedIndex = 0; selectedIndex < selected.length; selectedIndex += 1) {
        const existing = selected[selectedIndex];
        if (!isHighOverlap(candidate, existing)) {
          continue;
        }
        if (candidate.length > existing.length + 6) {
          selected[selectedIndex] = candidate;
        }
        dropped = true;
        break;
      }
      if (!dropped) {
        selected.push(candidate);
      }
    }
    return selected.slice(0, 6);
  }

  function mergeText(previousText, nextText) {
    const previous = normalizeText(previousText);
    const next = normalizeText(nextText);
    if (!previous) {
      return next;
    }
    if (!next || previous === next) {
      return previous;
    }

    const previousCanonical = toCanonical(previous);
    const nextCanonical = toCanonical(next);
    if (previousCanonical && nextCanonical) {
      if (previousCanonical.includes(nextCanonical)) {
        return previous;
      }
      if (nextCanonical.includes(previousCanonical)) {
        return next;
      }
    }

    const previousTokens = previous.split(/\s+/).filter(Boolean);
    const nextTokens = next.split(/\s+/).filter(Boolean);
    const maxOverlap = Math.min(18, previousTokens.length, nextTokens.length);
    let overlap = 0;
    for (let size = maxOverlap; size >= 1; size -= 1) {
      let matches = true;
      for (let index = 0; index < size; index += 1) {
        const left = normalizeToken(previousTokens[previousTokens.length - size + index]);
        const right = normalizeToken(nextTokens[index]);
        if (left !== right) {
          matches = false;
          break;
        }
      }
      if (matches) {
        overlap = size;
        break;
      }
    }

    if (overlap > 0) {
      const tail = nextTokens.slice(overlap).join(" ");
      const nextOverlapLast = String(nextTokens[overlap - 1] || "");
      const previousLast = String(previousTokens[previousTokens.length - 1] || "");
      const punctuation = /[,.!?;:]$/.test(nextOverlapLast) && !/[,.!?;:]$/.test(previousLast)
        ? nextOverlapLast.slice(-1)
        : "";
      const prefix = punctuation ? previous + punctuation : previous;
      return tail ? normalizeText(prefix + " " + tail) : prefix;
    }

    return normalizeText(previous + " " + next);
  }

  function normalizeToken(token) {
    return String(token || "")
      .toLowerCase()
      .replace(/[^\w]/g, "");
  }

  function endsNaturally(text) {
    return /[.!?]["')\]]?$/.test(String(text || "").trim());
  }

  function looksLyricLike(text) {
    const normalized = normalizeText(text);
    if (!normalized) {
      return false;
    }
    if (/[\u266a\u266b]/.test(normalized)) {
      return true;
    }
    if (/\[(?:music|lyrics?|singing|chorus|verse|instrumental|guitar|drums|applause)\]/i.test(normalized)) {
      return true;
    }
    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length < 10) {
      return false;
    }
    const sentenceMarks = (normalized.match(/[.!?]/g) || []).length;
    const commaMarks = (normalized.match(/,/g) || []).length;
    const shortLineCount = normalized
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && line.split(/\s+/).length <= 8).length;
    return sentenceMarks === 0 && (shortLineCount >= 2 || commaMarks <= 1);
  }

  function splitLongThought(text, maxChars) {
    const normalized = normalizeText(text);
    const limit = Number.isFinite(maxChars) ? Math.max(120, Number(maxChars)) : 330;
    if (!normalized || normalized.length <= limit) {
      return normalized ? [normalized] : [];
    }
    if (normalized.length < limit * 1.45) {
      return [normalized];
    }

    const pieces = [];
    let remaining = normalized;
    while (remaining.length > limit) {
      const search = remaining.slice(0, limit + 1);
      let cutAt = Math.max(search.lastIndexOf(", "), search.lastIndexOf("; "), search.lastIndexOf(": "));
      if (cutAt < 180) {
        cutAt = -1;
        const softBreaks = /\s+(?:and|but|so|because|which|then|if|when|where|while|uh|um)\s+/gi;
        let match = softBreaks.exec(search);
        while (match) {
          if (match.index >= 180) {
            cutAt = match.index;
          }
          match = softBreaks.exec(search);
        }
      }
      if (cutAt < 180) {
        break;
      }

      const piece = normalizeText(remaining.slice(0, cutAt + 1));
      if (piece) {
        pieces.push(piece);
      }
      remaining = normalizeText(remaining.slice(cutAt + 1));
    }

    if (remaining) {
      pieces.push(remaining);
    }
    return pieces.length ? pieces : [normalized];
  }

  function splitByNaturalBreaks(text, maxChars, allowWordSplit) {
    const normalized = normalizeText(text);
    if (!normalized) {
      return [];
    }
    const limit = Number.isFinite(maxChars) ? Math.max(120, Number(maxChars)) : 330;
    const canSplitWords = allowWordSplit !== false;
    if (normalized.length <= limit) {
      return [normalized];
    }

    const sentences = normalized.match(/[^.!?]+[.!?]["')\]]*|[^.!?]+$/g) || [normalized];
    const pieces = [];
    let buffer = "";

    const flush = () => {
      const value = normalizeText(buffer);
      if (value) {
        pieces.push(value);
      }
      buffer = "";
    };

    for (let index = 0; index < sentences.length; index += 1) {
      const sentence = normalizeText(sentences[index]);
      if (!sentence) {
        continue;
      }
      const candidate = buffer ? buffer + " " + sentence : sentence;
      if (buffer && candidate.length > limit) {
        flush();
      }
      if (sentence.length <= limit) {
        buffer = buffer ? buffer + " " + sentence : sentence;
        continue;
      }

      if (!canSplitWords) {
        const softParts = splitLongThought(sentence, limit);
        for (let softIndex = 0; softIndex < softParts.length; softIndex += 1) {
          const softPart = softParts[softIndex];
          const softCandidate = buffer ? buffer + " " + softPart : softPart;
          if (buffer && softCandidate.length > limit) {
            flush();
          }
          buffer = buffer ? buffer + " " + softPart : softPart;
        }
        continue;
      }

      const words = sentence.split(/\s+/).filter(Boolean);
      for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
        const word = words[wordIndex];
        const next = buffer ? buffer + " " + word : word;
        if (buffer && next.length > limit) {
          flush();
        }
        buffer = buffer ? buffer + " " + word : word;
      }
    }
    flush();
    return pieces;
  }

  app.captionText = {
    cleanCandidate,
    collapseOverlaySpam,
    collapseRepeatedPhrases,
    collapseRepeatedSentences,
    dedupeCandidates,
    endsNaturally,
    isHighOverlap,
    looksLyricLike,
    looksAllCapsCaption,
    mergeText,
    normalizeText,
    normalizeToken,
    sanitizeOverlayText,
    softenAllCapsCaption,
    splitByNaturalBreaks,
    splitLongThought,
    toCanonical
  };
})(window);
