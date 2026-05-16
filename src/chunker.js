(function initChunker(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});

  const CHUNK_LIMITS = Object.freeze({
    short: 120,
    medium: 220,
    long: 360
  });

  const CONVERSATIONAL_CHUNKING = Object.freeze({
    short: Object.freeze({
      targetChars: 150,
      softMaxChars: 210,
      hardMaxChars: 300,
      preferredDuration: 9,
      hardMaxDuration: 16,
      softPauseSeconds: 1.25,
      hardPauseSeconds: 2.4,
      tinyFragmentChars: 54
    }),
    medium: Object.freeze({
      targetChars: 240,
      softMaxChars: 330,
      hardMaxChars: 460,
      preferredDuration: 13,
      hardMaxDuration: 24,
      softPauseSeconds: 1.35,
      hardPauseSeconds: 2.7,
      tinyFragmentChars: 68
    }),
    long: Object.freeze({
      targetChars: 340,
      softMaxChars: 470,
      hardMaxChars: 620,
      preferredDuration: 18,
      hardMaxDuration: 32,
      softPauseSeconds: 1.5,
      hardPauseSeconds: 3.0,
      tinyFragmentChars: 84
    }),
    live: Object.freeze({
      tinyFragmentChars: 90,
      comfortableChars: 300,
      hardChars: 430,
      lyricChars: 240,
      hardPauseSeconds: 2.3,
      maxBucketsWithoutSentence: 3,
      maxBucketsWithSentence: 3
    })
  });

  function cueEndsSentence(text) {
    return /[.!?]["')\]]?$/.test(String(text || "").trim());
  }

  function getProfile(chunkSize) {
    return CONVERSATIONAL_CHUNKING[chunkSize] || CONVERSATIONAL_CHUNKING.medium;
  }

  function normalizeCue(cue) {
    const start = Number(cue && cue.start);
    const end = Number(cue && cue.end);
    const text = String(cue && cue.text ? cue.text : "").replace(/\s+/g, " ").trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || !text) {
      return null;
    }
    const normalizedStart = Math.max(0, start);
    const normalizedEnd = Math.max(normalizedStart, end);
    return {
      ...cue,
      start: normalizedStart,
      end: normalizedEnd,
      text
    };
  }

  function getMetrics(text, start, end) {
    const normalized = String(text || "").trim();
    const words = normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
    return {
      chars: normalized.length,
      duration: Math.max(0, Number(end || 0) - Number(start || 0)),
      words,
      endsSentence: cueEndsSentence(normalized)
    };
  }

  function shouldRespectPause(bufferText, chunkStart, chunkEnd, pause, profile) {
    const metrics = getMetrics(bufferText, chunkStart, chunkEnd);
    if (pause >= profile.hardPauseSeconds) {
      return true;
    }
    if (pause < profile.softPauseSeconds) {
      return false;
    }
    if (metrics.chars <= profile.tinyFragmentChars && metrics.duration < profile.preferredDuration) {
      return false;
    }
    return metrics.endsSentence || metrics.chars >= profile.targetChars || metrics.duration >= profile.preferredDuration;
  }

  function chunkCues(cues, chunkSize) {
    if (!Array.isArray(cues) || !cues.length) {
      return [];
    }

    const profile = getProfile(chunkSize);
    const source = cues
      .map(normalizeCue)
      .filter(Boolean)
      .sort((left, right) => left.start - right.start);
    if (!source.length) {
      return [];
    }

    const chunks = [];
    let bufferText = "";
    let chunkStart = source[0].start;
    let chunkEnd = source[0].end;
    let cueCount = 0;

    function flush(reason) {
      const normalized = bufferText.trim();
      if (!normalized) {
        return;
      }
      const metrics = getMetrics(normalized, chunkStart, chunkEnd);
      chunks.push({
        id: chunks.length,
        start: chunkStart,
        end: chunkEnd,
        text: normalized,
        reason: reason || "natural",
        metrics: {
          chars: metrics.chars,
          duration: metrics.duration,
          cueCount
        }
      });
      bufferText = "";
      cueCount = 0;
    }

    function appendCue(cue) {
      bufferText = bufferText ? bufferText + " " + cue.text : cue.text;
      chunkEnd = cue.end;
      cueCount += 1;
    }

    for (let index = 0; index < source.length; index += 1) {
      const cue = source[index];
      const previousCue = source[index - 1];
      const pause = previousCue ? cue.start - previousCue.end : 0;

      if (!bufferText) {
        chunkStart = cue.start;
      }

      if (bufferText.length > 0 && shouldRespectPause(bufferText, chunkStart, chunkEnd, pause, profile)) {
        flush(pause >= profile.hardPauseSeconds ? "hard-pause" : "soft-pause");
        chunkStart = cue.start;
      }

      const candidate = bufferText ? bufferText + " " + cue.text : cue.text;
      if (bufferText && candidate.length >= profile.hardMaxChars) {
        flush("pre-hard-max-chars");
        chunkStart = cue.start;
      }

      appendCue(cue);

      const nextCue = source[index + 1];
      const nextPause = nextCue ? nextCue.start - cue.end : 0;
      const metrics = getMetrics(bufferText, chunkStart, chunkEnd);
      const isLastCue = index === source.length - 1;

      if (isLastCue) {
        flush("end");
      } else if (metrics.chars >= profile.hardMaxChars) {
        flush("hard-max-chars");
      } else if (metrics.duration >= profile.hardMaxDuration && (metrics.endsSentence || metrics.chars >= profile.softMaxChars)) {
        flush("hard-max-duration");
      } else if (nextPause >= profile.hardPauseSeconds) {
        flush("upcoming-hard-pause");
      } else if (
        nextPause >= profile.softPauseSeconds &&
        (metrics.endsSentence || metrics.chars >= profile.targetChars || metrics.duration >= profile.preferredDuration)
      ) {
        flush("upcoming-soft-pause");
      } else if (
        metrics.endsSentence &&
        metrics.chars >= profile.targetChars &&
        metrics.duration >= Math.max(1, profile.preferredDuration * 0.65)
      ) {
        flush("sentence-target");
      } else if (metrics.endsSentence && metrics.chars >= profile.softMaxChars) {
        flush("sentence-soft-max");
      }
    }

    return chunks;
  }

  function findChunkIndexAtTime(chunks, time) {
    if (!Array.isArray(chunks) || !chunks.length) {
      return -1;
    }
    if (Number(time) < Number(chunks[0].start || 0)) {
      return -1;
    }

    let low = 0;
    let high = chunks.length - 1;
    let result = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (time < chunks[mid].start) {
        high = mid - 1;
      } else {
        result = mid;
        low = mid + 1;
      }
    }

    return result;
  }

  function findActiveChunkIndexAtTime(chunks, time, toleranceSeconds) {
    const now = Number(time);
    if (!Number.isFinite(now)) {
      return -1;
    }
    const tolerance = Math.max(0, Number.isFinite(Number(toleranceSeconds)) ? Number(toleranceSeconds) : 0.75);

    function isActiveAt(index) {
      if (index < 0 || index >= chunks.length) {
        return false;
      }
      const chunk = chunks[index];
      const start = Math.max(0, Number(chunk && chunk.start ? chunk.start : 0));
      const end = Math.max(start + 0.25, Number(chunk && chunk.end ? chunk.end : start + 0.25));
      return now >= start - tolerance && now <= end + tolerance;
    }

    const index = findChunkIndexAtTime(chunks, time);
    if (isActiveAt(index)) {
      return index;
    }
    const nextIndex = index < 0 ? 0 : index + 1;
    if (isActiveAt(nextIndex)) {
      return nextIndex;
    }
    return -1;
  }

  function moveIndex(currentIndex, offset, totalCount) {
    if (!Number.isInteger(totalCount) || totalCount <= 0) {
      return -1;
    }
    const base = Number.isFinite(currentIndex) ? Math.floor(currentIndex) : 0;
    const next = base + (Number.isFinite(offset) ? Math.floor(offset) : 0);
    return Math.max(0, Math.min(totalCount - 1, next));
  }

  function formatTimestamp(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) {
      return hours + ":" + String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
    }
    return minutes + ":" + String(secs).padStart(2, "0");
  }

  app.chunker = {
    CHUNK_LIMITS,
    CONVERSATIONAL_CHUNKING,
    chunkCues,
    findActiveChunkIndexAtTime,
    findChunkIndexAtTime,
    moveIndex,
    formatTimestamp
  };
})(window);
