(function initChunker(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});

  const CHUNK_LIMITS = Object.freeze({
    short: 120,
    medium: 220,
    long: 360
  });
  const PAUSE_THRESHOLD_SECONDS = 1.2;

  function cueEndsSentence(text) {
    return /[.!?]["')\]]?$/.test(text.trim());
  }

  function chunkCues(cues, chunkSize) {
    if (!Array.isArray(cues) || !cues.length) {
      return [];
    }

    const maxChars = CHUNK_LIMITS[chunkSize] || CHUNK_LIMITS.medium;
    const chunks = [];
    let bufferText = "";
    let chunkStart = cues[0].start;
    let chunkEnd = cues[0].end;

    function flush() {
      const normalized = bufferText.trim();
      if (!normalized) {
        return;
      }
      chunks.push({
        id: chunks.length,
        start: chunkStart,
        end: chunkEnd,
        text: normalized
      });
      bufferText = "";
    }

    for (let index = 0; index < cues.length; index += 1) {
      const cue = cues[index];
      const previousCue = cues[index - 1];
      const pause = previousCue ? cue.start - previousCue.end : 0;

      if (!bufferText) {
        chunkStart = cue.start;
      }

      const reachedPauseBoundary = bufferText.length > 0 && pause >= PAUSE_THRESHOLD_SECONDS;

      if (reachedPauseBoundary) {
        flush();
        chunkStart = cue.start;
      }

      const candidate = bufferText ? bufferText + " " + cue.text : cue.text;
      const reachedHardLimit = candidate.length >= maxChars;
      const reachedSentenceBoundary = cueEndsSentence(cue.text) && candidate.length >= Math.round(maxChars * 0.55);
      bufferText = candidate;
      chunkEnd = cue.end;

      const isLastCue = index === cues.length - 1;
      if (isLastCue || reachedHardLimit || reachedSentenceBoundary) {
        flush();
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
    chunkCues,
    findChunkIndexAtTime,
    moveIndex,
    formatTimestamp
  };
})(window);
