# MMOCC Manual QA Checklist

Use this checklist before marketplace uploads or public demos. The extension is intentionally local-only: no accounts, analytics, remote telemetry, or transcript uploads.

## Browser Loading

- Chrome: load `build/chrome` with Developer Mode > Load unpacked.
- Firefox: load `build/firefox/manifest.json` from `about:debugging#/runtime/this-firefox`.
- Confirm the extension appears only on YouTube pages.
- Confirm there are no noisy console logs in normal mode. Optional diagnostics require `dcdebug=1`.

## YouTube Watch Page

- Open a captioned YouTube video.
- Confirm the MMOCC pill appears while the player is in view.
- Open the panel and confirm caption bubbles appear after playback starts.
- If the panel opens with no bubbles on a captioned video, wait several seconds and confirm caption capture recovers without closing/reopening the panel.
- Confirm YouTube native captions are hidden while the panel is open, then restored if MMOCC enabled them.
- Confirm the panel stays anchored to the video area and hides instead of floating over comments when the player scrolls away.
- Confirm resizing/dragging the panel keeps it within the video frame and remains responsive.

## Caption State

- Confirm current/recent bubbles render consistently.
- Confirm future bubbles appear when full transcript/timeline data is available.
- Toggle Future / Next Up off and confirm the divider and preview rows disappear.
- Toggle Future / Next Up back on and confirm previews return when transcript/timeline data is available.
- Confirm future bubbles are absent, not stale, when captions are unavailable or live-only.
- Confirm the future-preview separator is just a subtle line and is not clickable as a caption row.
- Confirm long captions wrap inside rows and the scroll container owns overflow.
- Navigate to another video using YouTube recommendations, playlist next, browser back/forward, and page reload.
- Confirm old captions, future previews, hover state, and timeline data do not leak into the new video.

## Timeline Scrub Mode

- Toggle Timeline mode from the MMOCC toolbar.
- Confirm the full scrollable panel body collapses and the timeline lens appears near the YouTube timeline.
- Hover across the scrub layer and confirm the lens shows the matching transcript chunk.
- Click the scrub lens/track and confirm the video seeks near the caption start.
- Confirm the lens clamps inside the video area and does not flicker.
- Toggle back to Panel mode and confirm normal bubbles return cleanly.
- Resize the browser/player and confirm scrub positioning updates.

## Interaction

- Hover the panel and press `Space`; playback should move forward about 8 seconds.
- Hover the panel and press `Shift+Space`; playback should move backward about 8 seconds.
- Confirm shortcuts do nothing while typing in inputs, textareas, selects, or editable content.
- Click old and new caption bubbles repeatedly; the selected timestamp should be repeatable and no words should teleport between locked bubbles.
- Scroll upward in the panel while playback continues and confirm the panel does not jump back down until Current, Latest, or the live edge is selected.
- Click Current and confirm the active caption returns into view.
- Click Latest and confirm playback seeks to the newest reached bubble.
- Open the quick guide and confirm it concisely covers click-to-seek, Current, Latest, Next, Case Fix, color, opacity, Lock, Reset, drag, and resize.
- Scrub the YouTube timeline manually and confirm active/future state catches up without stale highlights.

## Workspace Preferences

- With Layout Lock off, move/resize the panel, navigate to another video, and confirm the next video starts from the default workspace shape.
- With Layout Lock on, move/resize the panel, adjust text size/Future/Case Fix/preview height, navigate to another video, and confirm the workspace follows.
- Click Reset and confirm panel position, size, text size, preview height, Timeline mode, and launcher position return to defaults while theme, custom color, opacity, Fade, Future / Next Up, and Case Fix choices are preserved.
- Confirm no pinned-default UI or second persistence layer is present.

## No-Captions / Edge Cases

- Test a video with captions disabled/unavailable.
- Confirm MMOCC shows a clean unavailable/live-fallback state without stale old captions.
- Test ads or skip-ahead moments when possible.
- Confirm ad skip, rapid pause/play, fullscreen, theater mode, and layout changes do not break anchoring.
