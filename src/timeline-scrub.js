(function initTimelineScrub(scope) {
  const app = (scope.DialogueCaptions = scope.DialogueCaptions || {});

  function getChunkStart(chunk) {
    const value = chunk && chunk.seekStart !== undefined ? chunk.seekStart : chunk && chunk.start;
    const number = Number(value);
    return Number.isFinite(number) ? number : Number.NaN;
  }

  function getChunkEnd(chunk) {
    const value = chunk && chunk.end !== undefined ? chunk.end : chunk && chunk.stop;
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
    const start = getChunkStart(chunk);
    return Number.isFinite(start) ? start + 0.25 : Number.NaN;
  }

  function getChunkText(chunk) {
    return String(chunk && chunk.text ? chunk.text : "").replace(/\s+/g, " ").trim();
  }

  function sortChunks(chunks) {
    if (!Array.isArray(chunks)) {
      return [];
    }
    return chunks
      .map((chunk) => ({ ...chunk }))
      .filter((chunk) => Number.isFinite(getChunkStart(chunk)) && getChunkText(chunk))
      .sort((left, right) => getChunkStart(left) - getChunkStart(right))
      .map((chunk, index) => ({ ...chunk, timelineIndex: index }));
  }

  function chunkToPercent(chunk, durationSeconds) {
    const duration = Number(durationSeconds);
    const start = getChunkStart(chunk);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(start)) {
      return Number.NaN;
    }
    return Math.max(0, Math.min(100, (start / duration) * 100));
  }

  function hoverXToTime(localX, width, durationSeconds) {
    const x = Number(localX);
    const safeWidth = Number(width);
    const duration = Number(durationSeconds);
    if (!Number.isFinite(x) || !Number.isFinite(safeWidth) || safeWidth <= 0 || !Number.isFinite(duration) || duration <= 0) {
      return Number.NaN;
    }
    const percent = Math.max(0, Math.min(1, x / safeWidth));
    return percent * duration;
  }

  function findChunkIndexAtTime(chunks, timeSeconds, toleranceSeconds) {
    const time = Number(timeSeconds);
    const tolerance = Number.isFinite(Number(toleranceSeconds)) ? Math.max(0, Number(toleranceSeconds)) : 0.35;
    if (!Array.isArray(chunks) || !chunks.length || !Number.isFinite(time)) {
      return -1;
    }

    let previousIndex = -1;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < chunks.length; index += 1) {
      const start = getChunkStart(chunks[index]);
      const end = Math.max(start, getChunkEnd(chunks[index]));
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        continue;
      }
      const distance = Math.abs(start - time);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
      if (time >= start - tolerance && time < end + tolerance) {
        return index;
      }
      if (start <= time + tolerance) {
        previousIndex = index;
      } else {
        break;
      }
    }

    return previousIndex >= 0 ? previousIndex : nearestIndex;
  }

  function getContextIndices(chunks, currentIndex) {
    if (!Array.isArray(chunks) || !chunks.length || currentIndex < 0) {
      return [];
    }
    const indices = [];
    if (currentIndex > 0) {
      indices.push({ index: currentIndex - 1, role: "previous" });
    }
    indices.push({ index: currentIndex, role: "current" });
    if (currentIndex + 1 < chunks.length) {
      indices.push({ index: currentIndex + 1, role: "next" });
    }
    return indices;
  }

  function clampBubbleLeft(centerX, bubbleWidth, layerWidth, margin) {
    const center = Number(centerX);
    const width = Number(bubbleWidth);
    const layer = Number(layerWidth);
    const safeMargin = Number.isFinite(Number(margin)) ? Math.max(0, Number(margin)) : 8;
    if (!Number.isFinite(center) || !Number.isFinite(width) || !Number.isFinite(layer) || width <= 0 || layer <= 0) {
      return safeMargin;
    }
    return Math.max(safeMargin, Math.min(layer - width - safeMargin, center - width / 2));
  }

  function sampleMarkerChunks(chunks, maxMarkers) {
    const safeChunks = Array.isArray(chunks) ? chunks : [];
    const max = Math.max(1, Number(maxMarkers) || 140);
    const step = Math.max(1, Math.ceil(safeChunks.length / max));
    const sampled = [];
    for (let index = 0; index < safeChunks.length; index += step) {
      sampled.push({ chunk: safeChunks[index], index, clustered: step > 1 });
    }
    return sampled;
  }

  app.timelineScrub = {
    getChunkStart,
    getChunkEnd,
    getChunkText,
    sortChunks,
    chunkToPercent,
    hoverXToTime,
    findChunkIndexAtTime,
    getContextIndices,
    clampBubbleLeft,
    sampleMarkerChunks
  };
})(window);
