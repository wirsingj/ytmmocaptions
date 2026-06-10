# State of the Union

Current branch reviewed: `1.1.5-work`.

Current package version in manifests and `package.json`: `1.1.4`.

This document describes the current codebase state as observed in source, tests, and project metadata. It is intended for architecture review, risk assessment, audit planning, feature planning, and bug hunting.

## Executive Summary

YTMMOCC is a Chrome/Firefox WebExtension that runs on YouTube watch pages and presents captions/transcripts as an MMO-style dialogue panel over the video. It groups caption cues into readable chat bubbles, supports click-to-seek and hover-scoped keyboard navigation, and provides local UI customization such as themes, opacity, layout lock, workspace presets, future previews, and a closed launcher pill.

The released runtime is YouTube-only. Generic HTML5 video support exists in source (`src/universal-captions.js`) and tests, but it is not included in the release manifests. The extension has no background worker; all runtime behavior lives in content scripts and an injected page-world bridge.

Maturity level: late pre-release / early production for the YouTube path. The codebase has substantial unit and source-structure coverage, release packaging scripts, Chrome/Firefox manifests, privacy/release docs, and recent defensive work around YouTube route and caption state. It is still mostly a single-page-content-script architecture with many interacting runtime states inside `src/content-script.js` and `src/ui-panel.js`.

Major implemented features:

- YouTube-only caption/transcript overlay, loaded by content scripts from `manifest*.json`.
- Full transcript acquisition through `src/caption-timeline.js` and `src/transcript.js`.
- Timedtext, YouTube transcript APIs, DOM transcript, text-track, and intercepted timedtext fallbacks.
- Live caption fallback when a full timeline is unavailable.
- Chat bubble grouping, locked bubble immutability, reading glow, future preview, and click-to-seek.
- Compact panel UI with theme selection, custom color, rainbow preview, opacity, text scale, center fade, Case Fix, Next/Future toggle, Lock, Reset, help, close launcher, drag/resize, and workspace preset slots.
- YouTube route handling and panel teardown/recreate on video id changes.
- Read-only page-world bridge for YouTube internals, selected caption track snapshots, timedtext capture, and constrained fetches.
- Settings stored through extension storage only.
- Chrome/Firefox packaging and release checks.

Major features in progress or deferred:

- Generic non-YouTube caption support is source-only and adapter-based (`src/universal-captions.js`), not shipped in release manifests.
- Timeline Scrub exists in `src/ui-panel.js` and `src/timeline-scrub.js`, but README says it remains experimental and hidden from normal release UI.
- Dynamic/richer color animation beyond the current temporary rainbow preview is not implemented as first-class persisted user slots.
- Pinned defaults are explicitly deferred in `ARCHITECTURE.md`.
- Mobile support is not targeted; manifests and docs target desktop Chrome/Firefox.

Known limitations and tradeoffs:

- Runtime is tightly coupled to YouTube DOM/player behavior and page globals.
- No background/service-worker coordination; each tab owns its own runtime app, while settings are global through extension storage.
- Most tests are VM/unit/source-inspection tests. Optional Playwright diagnostics exist, but they are not part of the normal release gate.
- Live fallback uses overlay/text-track state and is inherently less precise than full timedtext timelines.
- Some tests assert source substrings, which catches architectural invariants but can be brittle during refactors.
- Version metadata still says `1.1.4` while current branch work is for `1.1.5`.

## Architecture Overview

### Runtime Entry and Platform Layer

Purpose: provide browser-safe entry, platform APIs, diagnostics, storage abstraction, and load order.

Key files:

- `manifest.json`
- `manifest.chrome.json`
- `manifest.firefox.json`
- `src/platform.js`
- `src/diagnostics.js`
- `scripts/build.mjs`

Owned state:

- Manifest content script order.
- Browser API adapter state in `platform.js`.
- Optional local diagnostics buffer in `diagnostics.js`.

Inbound dependencies:

- Browser extension runtime.
- `chrome.storage` or `browser.storage`.
- YouTube page match `https://www.youtube.com/*`.

Outbound dependencies:

- All other modules depend on `window.DialogueCaptions`.
- Build outputs copy `src/*` to `build/chrome/scripts` and `build/firefox/scripts`.

Notes:

- Content scripts run at `document_idle`.
- Runtime permissions are `storage` plus YouTube host permissions.
- Firefox manifest declares a stable Gecko id and no data collection.
- There is no extension background script in the current manifests.

### Page Context Bridge

Purpose: bridge from isolated content-script world into YouTube page world for access to page globals, selected caption state, timedtext fetch captures, and constrained page-context fetches.

Key files:

- `src/page-context.js`
- `src/page-bridge.js`
- `tests/page-context.test.js`
- `tests/page-bridge.test.js`

Owned state:

- `page-context.js`: `snapshot`, `currentCaptureVideoId`, `pendingRequests`, `pendingSnapshotRequests`, `timedtextCaptures`, bridge token, injection attempt counters.
- `page-bridge.js`: bridge token list, installed flag, timedtext probe, monkey-patched `fetch`/`XMLHttpRequest` wrappers.

Inbound dependencies:

- `platform.runtimeGetURL`.
- `window.postMessage`.
- YouTube page globals: `ytInitialPlayerResponse`, `ytInitialData`, `ytcfg`, `movie_player`.
- Page fetch/XHR activity.

Outbound dependencies:

- `src/transcript.js` reads `pageContext.getSnapshot()`, `getTimedtextCaptures()`, and `pageFetch()`.
- `src/content-script.js` calls `ensureBridgeInjected()`, `requestSnapshot()`, and `triggerCaptionProbe()`.

Important implementation details:

- `page-context.js` generates a bridge token and requires it on all messages.
- `requestSnapshot(timeoutMs)` posts `DIALOGUE_CAPTIONS_PAGE_SNAPSHOT_REQUEST` and resolves on the next valid snapshot or timeout.
- `pageFetch(url, init, timeoutMs)` sends `DIALOGUE_CAPTIONS_PAGE_FETCH_REQUEST` and drops responses if the current video id has changed.
- `page-bridge.js` allows only scoped YouTube endpoints through its request handler.
- Recent hardening filters stale caption tracks and selected tracks by current `v=` before exporting bridge payloads.

### Transcript and Caption Timeline Acquisition

Purpose: acquire a normalized caption timeline from the best available YouTube source.

Key files:

- `src/caption-timeline.js`
- `src/transcript.js`
- `src/caption-text.js`
- `tests/caption-timeline.test.js`
- `tests/transcript.test.js`
- `tests/caption-text.test.js`

Owned state:

- Mostly stateless functions.
- Uses page-context cached snapshots and timedtext captures indirectly.
- Per-call abort/timing state is passed through `AbortSignal`.

Inbound dependencies:

- YouTube watch URL.
- Optional `videoElement`.
- `pageContext` snapshot/fetch/captures.
- Browser `fetch`.
- DOM transcript panel fallback.
- Video `textTracks`.

Outbound dependencies:

- `content-script.js` calls `captionTimeline.acquireFullTimeline()`.
- Returned cues feed chunking and panel rendering.

Acquisition order in `src/transcript.js`:

1. Validate YouTube watch URL and video id.
2. Read page-context snapshot for logs and metadata.
3. Prefer timedtext candidates derived from player response / page snapshot.
4. Use `youtubei/v1/get_panel`.
5. Use `youtubei/v1/get_transcript`.
6. Use `HTMLMediaElement.textTracks`.
7. Use intercepted timedtext captures.
8. Use transcript DOM.

Important implementation details:

- `caption-timeline.js` wraps `transcript.loadTranscript()`, normalizes cues, counts future cues, records attempts, and returns `timeline` metadata.
- Track candidate ordering prefers selected YouTube caption language, then browser languages, then manual/non-translated tracks.
- `transcript.js` blocks non-YouTube and malformed caption URLs.
- Stale `ytInitialPlayerResponse`, page snapshot tracks, timedtext captures, and selected caption tracks are filtered by video id.
- `ytInitialData` is now required to reference the current video id before its panel params are trusted.

### Caption Processing

Purpose: clean captions, normalize text, split or group cues into readable bubble chunks, and maintain immutable bubble records.

Key files:

- `src/caption-text.js`
- `src/chunker.js`
- `src/bubble-state.js`
- `src/navigation.js` is not present; navigation behavior is tested through `tests/navigation.test.js` against exposed logic/fixtures.
- `tests/chunker.test.js`
- `tests/chunker-regression.test.js`
- `tests/bubble-state.test.js`
- `tests/live-bubbles.test.js`

Owned state:

- `bubble-state.js` owns bubble record construction and helper semantics.
- `chunker.js` owns cue-to-chunk grouping functions.
- Runtime bubble arrays live in `DialogueCaptionsApp` in `content-script.js`.

Inbound dependencies:

- Normalized cue arrays from `captionTimeline`.
- Raw overlay/text-track/live text from content script.
- User Case Fix setting.

Outbound dependencies:

- `content-script.js` uses chunk and bubble records for active panel state.
- `ui-panel.js` renders chunks and active/highlight state.

Important implementation details:

- Caption text removes YouTube overlay chrome and standalone language labels such as "Chinese".
- Locked live bubbles are treated as immutable.
- Reading glow derives from token timing where available.

### Main YouTube App Controller

Purpose: own the YouTube tab runtime, route lifecycle, video identity, transcript/live state, panel instance, and integration between acquisition, processing, and UI.

Key file:

- `src/content-script.js`

Owned state:

- `DialogueCaptionsController`: active video id, current app, controller cleanup, load nonce.
- `DialogueCaptionsApp`: video element, panel, cue/chunk arrays, live bubble maps, transcript load flags, caption language keys, caption-enable/restore state, heartbeat timers, sync RAF, pending seek focus, cleanup functions.

Inbound dependencies:

- All prior modules on `window.DialogueCaptions`.
- YouTube SPA route events.
- YouTube video element and native caption controls.
- Panel callbacks.

Outbound dependencies:

- Calls settings store, transcript/timeline acquisition, chunker, bubble state, panel render API, page context bridge.

Important implementation details:

- A singleton `__dialogueCaptionsController` is stored on `window`; existing controllers are destroyed before new startup.
- `DialogueCaptionsController.reconcileRoute()` derives video id from `window.location.href`; video id change destroys old app and creates a new one.
- `DialogueCaptionsApp.isCurrentVideoPage()` prevents stale app instances from mutating state after navigation.
- `startCaptionWork()` supports both first open and reopen-from-pill behavior.
- `loadTranscript()` aborts previous loads and uses a per-load nonce plus `AbortController`.
- Live fallback runs only while panel is open and current video/language state remains valid.

### Panel UI

Purpose: render and manage the overlay panel, controls, launcher pill, timeline layer, layout, themes, and user interactions.

Key files:

- `src/ui-panel.js`
- `styles/panel.css`
- `src/timeline-scrub.js`
- `tests/ui-panel.test.js`
- `tests/timeline-scrub.test.js`

Owned state:

- DOM references for root/header/body/history/future/footer/buttons.
- Mounted chunk/future/timeline data.
- Playback/active index.
- Layout/drag/resize state.
- Launcher drag state.
- Color picker and rainbow preview state.
- Timeline layer visibility and hover state.

Inbound dependencies:

- Settings object from `settings-store`.
- Chunk arrays and playback time from `content-script.js`.
- Seek/settings callbacks.
- Anchor element or YouTube player frame geometry.

Outbound dependencies:

- Emits `onSettingsChange(settings, patch)` to `content-script.js`.
- Emits `onSeek(target, options)` to `content-script.js`.

Important implementation details:

- `mount()` builds the UI directly with DOM APIs.
- `destroy()` removes DOM nodes, cancels animation frames, and unregisters listeners.
- Panel and launcher are anchored to player-local coordinates where possible.
- Fullscreen/resize handling calls layout refresh routines instead of treating passive resize as user layout intent.
- `persistLayout` and `layoutLocked` control whether geometry is saved.
- Rainbow theme is currently a temporary animation/preview driven by RAF; it is not a persisted dynamic color program.

### Settings Store

Purpose: normalize, persist, and migrate local extension settings.

Key files:

- `src/settings-store.js`
- `src/platform.js`
- `tests/settings-store.test.js`

Owned state:

- `DEFAULTS`.
- Storage key `dialogueCaptions.settings.v1`.
- `saveQueue` Promise for serialized writes.

Inbound dependencies:

- `platform.storageGet`.
- `platform.storageSet`.
- Settings patches from UI/content script.

Outbound dependencies:

- Returns normalized settings to app/panel.
- Persists only selected settings to extension storage.

Important implementation details:

- With `layoutLocked` off, layout geometry is session-local and not stored.
- With `layoutLocked` on, panel position/size, text scale, future preview height, launcher position, timeline mode, and panel closed state can persist.
- Readability preferences such as theme/color/opacity/fade and workspace presets persist globally.
- Transcript text, active bubble, playback position, and video identity are intentionally not stored.

### Generic Caption Adapter

Purpose: source-only experiment for non-YouTube HTML5 video caption support.

Key files:

- `src/universal-captions.js`
- `tests/universal-captions.test.js`

Owned state:

- Generic registry of attached video apps.
- Per-video `GenericVideoCaptionApp` with adapter, panel, chunks, RAF, last cue key.

Inbound dependencies:

- Visible non-YouTube `HTMLVideoElement`.
- `textTracks` or `<track kind="captions|subtitles">`.
- Shared `DialoguePanel`, `chunker`, and `settingsStore`.

Outbound dependencies:

- Non-YouTube panel instances.

Important implementation details:

- Explicitly returns early on YouTube pages.
- Not present in release manifests.
- Uses `persistLayout: false` for multiple-player safety.

## Startup and Lifecycle

### Extension Startup Flow

Sequence:

1. Browser loads content scripts from the manifest at `document_idle`.
2. Modules initialize in manifest order and attach themselves to `window.DialogueCaptions`.
3. `src/content-script.js` validates required modules.
4. Existing `window.__dialogueCaptionsController` is destroyed if present.
5. New `DialogueCaptionsController` is constructed and started.
6. Controller registers route/visibility/pagehide listeners and a 3-second route polling interval.
7. Controller immediately calls `reconcileRoute()`.

Key files:

- `manifest*.json`
- `src/content-script.js`

### Content Script Startup

Sequence:

1. `DialogueCaptionsController.reconcileRoute()` checks `transcript.isWatchPage(window.location.href)`.
2. If not a watch page or no `v=`, it tears down any app.
3. If current video id matches active app, it calls `app.nudgeCaptionWork("route-still-active")`.
4. If video id changed, it increments `loadNonce`, tears down old app, flushes settings writes, creates `DialogueCaptionsApp(videoId)`, and awaits `init()`.
5. `DialogueCaptionsApp.init()` loads settings, creates/mounts `DialoguePanel`, waits up to 12 seconds for the video element, binds keyboard/video sync, and starts caption work if panel is open.

### YouTube Route Change Handling

Event sources:

- `yt-navigate-finish`
- `yt-page-data-updated`
- `popstate`
- `hashchange`
- `pageshow`
- 3-second interval fallback

Sequence:

1. Route event calls `reconcileRoute()`.
2. Watch/non-watch and video id are derived from current URL.
3. Same video id nudges heartbeat/caption work without recreating app.
4. New video id destroys old app and creates a fresh `DialogueCaptionsApp`.
5. Pending app initialization is guarded by `loadNonce`.
6. App methods additionally guard with `isCurrentVideoPage()`.

### Panel Open/Close Lifecycle

Open from launcher:

1. `ui-panel.js` launcher click calls `updateSettings({ panelClosed: false })`.
2. `content-script.js.onSettingsChanged()` sees `panelClosed` change to open.
3. It calls `startCaptionWork()`.
4. On reopen, `startCaptionWork()` refreshes the page-context caption snapshot.
5. If caption preference changed or no transcript activity exists, it clears stale caption state and reloads.
6. If transcript state is still valid, it reuses it and resumes live polling only if already in live mode.

Close:

1. Panel Close button calls `updateSettings({ panelClosed: true })`.
2. `content-script.js.onSettingsChanged()` stops live polling and calls `restoreSubtitlesIfExtensionEnabled()`.
3. Panel UI hides root and shows launcher.
4. Live/transcript state is not wiped solely by closing; it may be reused on reopen if preference/video state is unchanged.

### Transcript Loading Lifecycle

Sequence:

1. `startCaptionWork()` calls `ensurePageBridgeForWatchPage()`.
2. It starts a caption-enable retry loop and live fallback mode.
3. It calls `loadTranscript()`.
4. `loadTranscript()` aborts previous load, increments `transcriptLoadNonce`, creates `AbortController`, stores current URL, and waits for caption context readiness.
5. It races `captionTimeline.acquireFullTimeline()` against a 10-second timeout.
6. If transcript fails with likely reload-race reason on first attempt, it waits briefly and retries.
7. On failure, it enables live fallback for likely caption-source failures.
8. On success, it verifies `response.videoId` and current URL video id, disables live fallback, stores cues, rebuilds chunks, stores transcript preview chunks, notes activity, and updates panel status.

### Live Caption Fallback Lifecycle

Sequence:

1. `enableLiveCaptureMode()` initializes live arrays/maps, timestamps, bucket counters, future preview state, and starts polling.
2. `startLiveCapturePolling()` uses timers/RAF-driven captures while panel is open.
3. `captureLiveCaptionLine()` reads text-track windows, active cues, or visible overlay text.
4. Overlay-only capture is ignored unless caption context exists.
5. Captured text is cleaned, bucketed, upserted into live bubbles/cues, chunked, and rendered.
6. Live fallback periodically attempts upgrade to full transcript through `tryUpgradeLiveCaptureToTranscript()`.
7. Live fallback is disabled on successful transcript load, destroy, or close/restore paths.

Current protection:

- Live capture returns early if panel is closed, app is stale for current URL, or the open-session caption preference changed.

### Fullscreen Lifecycle

Sequence:

1. `ui-panel.js` registers `fullscreenchange` and layout refresh listeners.
2. Panel geometry is based on player/anchor local coordinates.
3. Passive fullscreen/resize refreshes recompute local positions without treating them as user-authored persisted layout changes.
4. Launcher default position is calculated near the player bottom-left above YouTube controls.
5. Saved player-local ratios preserve bottom-left intent across fullscreen and resolution changes.

Key implementation areas:

- `ui-panel.js` layout restoration and launcher positioning near `panelPositionToLocal`, `refreshAnchorLayout`, `positionLauncher`, and `refreshPersistedLayoutPosition`.
- `tests/ui-panel.test.js` covers default launcher positioning, fullscreen-style resize preservation, and passive layout refresh behavior.

### Settings Load/Save Lifecycle

Sequence:

1. `settingsStore.load()` reads `dialogueCaptions.settings.v1` from extension storage.
2. Missing or invalid data normalizes to `DEFAULTS`.
3. UI changes call `DialoguePanel.updateSettings(patch)`.
4. Panel invokes `onSettingsChange(settings, patch)`.
5. `content-script.js.onSettingsChanged()` normalizes and persists via `settingsStore.savePatch()` or equivalent.
6. `settings-store.js` serializes writes through `saveQueue`.
7. Route teardown and pagehide call `persistPanelSnapshot()` and `settingsStore.flush()` where needed.

## State Ownership Map

| State | Owner | Creation Point | Mutation Points | Reset/Destruction | Persistence |
| --- | --- | --- | --- | --- | --- |
| Active video id | `DialogueCaptionsController.activeVideoId` | `reconcileRoute()` | Route changes | non-watch route, destroy | none |
| App video id | `DialogueCaptionsApp.videoId` | constructor | immutable | app destroy | none |
| Video element | `DialogueCaptionsApp.video` | `waitForVideoElement()` in `init()` | video sync rebinding | app destroy | none |
| Panel instance | `DialogueCaptionsApp.panel` | `init()` | settings/chunk/status updates | app destroy | none directly |
| Transcript cues | `DialogueCaptionsApp.cues` | constructor empty | full transcript load, live fallback, clear unavailable | app destroy, clear stale/unavailable, disable/reset paths | none |
| Full chunks | `allChunks`, `chunks` | constructor empty | `rebuildChunks()`, live updates, full transcript load | clear unavailable, destroy | none |
| Active chunk index | `activeIndex` | constructor `-1` | `syncActiveChunk()`, seek/focus, panel interactions | clear unavailable, destroy | none |
| Transcript preview chunks | `transcriptPreviewChunks` | constructor empty | full transcript load | clear unavailable, destroy | none |
| Live future chunks | `liveFuturePreviewChunks` | constructor empty | live text-track future reads | live disable, clear unavailable | none |
| Live bubble records | `liveBubbles`, `liveBucketToBubble`, `liveDisplayBubbleCache` | constructor | live capture | disable live, clear unavailable, destroy | none |
| Caption language preference | `lastCaptionPreferenceKey`, `openCaptionPreferenceKey` | constructor empty | snapshot refresh, transcript load, reopen | app destroy, video route recreate | none |
| Native CC restore state | `captionsWereOnBeforeExtension`, `captionsEnabledByExtension`, `captionsEnsured`, `captionEnsureStarted` | constructor | caption ensure/probe/restore | close, destroy, restore | none |
| Transcript loading state | `loadAbortController`, `transcriptLoadNonce`, `transcriptLoadInFlight`, attempts | constructor | `loadTranscript()` | abort, finally, destroy | none |
| Transcript heartbeat state | timer id, recovery counters | constructor | heartbeat scheduling/recovery | stop heartbeat, destroy | none |
| Page bridge snapshot | `page-context.js` `snapshot` | bridge message | `setSnapshot()` | video mismatch returns null; overwritten by next snapshot | page memory only |
| Timedtext captures | `page-context.js` `timedtextCaptures` | intercepted page fetch/XHR | push/trim to 20 | current video id change clears mismatched captures | page memory only |
| Bridge tokens | page context and page bridge | script injection | extension reload/bridge reinjection | page unload | page memory only |
| Settings | `settings-store.js` | `load()` | `save()`, `savePatch()` | storage cleared/migration/defaults | extension storage |
| Panel DOM state | `DialoguePanel` instance | `mount()` | render/update/listeners | `destroy()` | partly via settings |
| Panel geometry | `DialoguePanel.settings.panelPosition/panelSize`, DOM style | mount/default layout | drag/resize/layout lock/passive refresh | reset/destroy | only when layout locked |
| Launcher geometry | `launcherPosition`, DOM style | mount/default position | launcher drag, layout refresh | reset/destroy | only when layout locked |
| Fullscreen/layout state | UI-panel local measurements | event/listener callbacks | fullscreenchange/resize/scroll/observer | destroy | ratios if layout locked |
| Rainbow preview | `DialoguePanel` RAF/color fields | rainbow button | RAF tick/stop/settings | stop rainbow/destroy | final static color only if committed |
| Workspace presets | settings store and panel | defaults/load | capture/apply/toggle-off | reset active baseline, storage clear | extension storage |
| Generic video registry | `universal-captions.js` registry | source-only scan/attach | DOM mutation/video eligibility | app destroy/removed video | source-only, not release runtime |

## Async and Race Condition Analysis

### Content Script and Route Events

Async boundaries:

- YouTube route events.
- 3-second route polling interval.
- `settingsStore.flush()` before creating a new app.
- `DialogueCaptionsApp.init()` waiting for video element.

What can arrive late:

- Old route event after a newer route event.
- Old app initialization after a new route was selected.
- Video element replacement by YouTube.

Protections:

- `DialogueCaptionsController.loadNonce`.
- `teardownApp()` before new app creation.
- `DialogueCaptionsApp.destroyed`.
- `DialogueCaptionsApp.isCurrentVideoPage()` guards on bridge, live capture, transcript loading, and upgrade paths.
- Video sync listeners are cleaned/rebound.

Missing/weak areas:

- Same-tab YouTube DOM transitions remain dependent on events/polling; there is no centralized finite-state machine.
- Some protections are source-inspection tested rather than integration tested against real YouTube SPA timing.

### Page Bridge Message Passing

Async boundaries:

- `window.postMessage` between content world and page world.
- Snapshot requests.
- Bridged fetch requests.
- Timedtext capture posts from fetch/XHR wrappers.

What can arrive late:

- Snapshot from previous video.
- Fetch response after route change.
- Timedtext capture from previous video.
- Message from old extension token after reload.

Protections:

- Bridge token validation.
- Origin/source checks.
- Snapshot video-id checks in `page-context.js`.
- Fetch response dropped if current video id changed.
- Timedtext captures scoped/cleared by current video id.
- Bridge payload filters stale caption tracks and selected tracks.

Missing/weak areas:

- Page bridge monkey-patches page `fetch` and `XMLHttpRequest`; compatibility risk depends on YouTube implementation and other extensions/scripts.
- Snapshot timeout returns current validated snapshot or null, but upstream behavior still has to handle null correctly.

### Transcript Fetches

Async boundaries:

- Direct fetches to timedtext/watch/youtubei.
- Bridged page fetches.
- DOM transcript opening/waiting.
- Abort timers and transcript timeout race.

What can arrive late:

- Timedtext response after route change.
- YouTube metadata globals from previous video.
- DOM transcript entries from previous UI state.
- Fetch timeout after a valid response.

Protections:

- `AbortController` per transcript load.
- Per-load nonce in `content-script.js`.
- Response video id check before applying full transcript.
- Current URL/video check before and after acquisition.
- `transcript.js` filters player responses, page snapshots, tracks, selected track, rich timedtext probe, and intercepted captures by video id.
- `ytInitialData` must reference current video id before panel params are trusted.

Missing/weak areas:

- DOM transcript fallback is inherently tied to YouTube UI behavior and is hard to verify without live e2e tests.
- `getInitialDataFromScripts()` still parses page scripts and does not have the same explicit video-reference check as `getInitialDataFromWindow()`; scripts on the current DOM are assumed to be current enough.

### Live Caption Fallback

Async boundaries:

- Polling/timers/RAF.
- `timeupdate`, seek, and playback events.
- Caption probe retry timers.
- Periodic upgrade attempts.

What can arrive late:

- Overlay text from old captions.
- Text-track cue changes after a seek.
- Native CC enabling after delayed YouTube player readiness.
- Language selection changes while panel remains open.

Protections:

- Seek suppression and discontinuous-time handling.
- Overlay-only capture requires caption context.
- Caption preference is frozen for the open panel session.
- Close/reopen refreshes selected caption snapshot and reloads when changed.
- Native CC restore tracks whether extension enabled captions.

Missing/weak areas:

- Live fallback cannot be as deterministic as full timedtext.
- Real-world YouTube caption overlay text may vary by player mode, language, and experimental UI.

### UI Timers, Observers, and Layout Events

Async boundaries:

- `requestAnimationFrame` for sync/render/rainbow.
- `fullscreenchange`.
- scroll/resize.
- ResizeObserver/MutationObserver-style layout reactions.
- Drag/resize pointer events.

What can arrive late:

- Passive fullscreen resize after user drag.
- Anchor/player rect changes while panel is hidden.
- RAF after destroy.

Protections:

- Cleanup function arrays.
- RAF cancellation on destroy.
- Tests around passive layout refresh not rewriting saved ratios.
- Panel positions are clamped and restorable layouts are validated.

Missing/weak areas:

- Fullscreen behavior is mostly unit/source tested; no required cross-browser visual e2e gate.
- Complex layout interactions depend on YouTube's changing controls/progress bar geometry.

### Settings Writes

Async boundaries:

- Browser storage callbacks/promises.
- Save queue.
- Route teardown/pagehide persistence.

What can arrive late:

- Settings write finishing after route change.
- Pending layout patch race with app teardown.

Protections:

- `settings-store.js` serializes writes through `saveQueue`.
- Route changes wait for `settingsStore.flush()` before new app creation.
- Tests cover load, save, patch, flush, and migration behavior.

Missing/weak areas:

- Settings are global across tabs. Concurrent tabs changing layout/theme can race at product level even if each write is serialized locally.

## Testing Coverage

Test runner: `tests/run-tests.js`.

Current full suite count from latest run: `210/210` passing.

Major suites:

- `tests/compliance.test.js`: manifests, permissions, release hygiene, diagnostics/privacy constraints, content script order.
- `tests/caption-text.test.js`: overlay chrome cleanup, dedupe, case fix, natural split behavior, lyric-like detection.
- `tests/caption-timeline.test.js`: timeline normalization and acquisition failure reporting.
- `tests/chunker.test.js` and `tests/chunker-regression.test.js`: cue grouping, pause boundaries, active index lookup.
- `tests/bubble-state.test.js`: immutable bubble records, seek trimming, reading glow, token timing.
- `tests/platform.test.js`: browser/chrome storage adapters.
- `tests/page-context.test.js`: bridge token behavior, video-scoped snapshots/captures/fetch responses.
- `tests/page-bridge.test.js`: bridge request allowlist, token reload, stale track filtering, selected-track read-only behavior.
- `tests/transcript.test.js`: timedtext parsing, selected/browser language preference, stale metadata filtering, panel/transcript API fallbacks, token timing.
- `tests/live-bubbles.test.js`: live bubble behavior, route/state guards, native CC restore, preference freeze, fallback upgrades.
- `tests/settings-store.test.js`: normalization, persistence model, layout lock semantics, migration.
- `tests/ui-panel.test.js`: workspace presets, rainbow preview, layout/fullscreen-style geometry, virtualized history.
- `tests/timeline-scrub.test.js`: timeline scrub math.
- `tests/universal-captions.test.js`: source-only generic adapter behavior.

Weakly tested areas:

- Real YouTube DOM behavior, especially current-player controls, native CC menu state, and transcript panel behavior.
- Cross-tab settings collisions.
- Actual Chrome/Firefox extension install/runtime parity outside optional diagnostics.
- Visual layout details under arbitrary YouTube player sizes, theater mode, fullscreen variants, and browser zoom.
- Long-duration memory behavior of live capture.

Areas with little/no meaningful release-gate coverage:

- Store upload automation against real Chrome/AMO services.
- Dynamic YouTube A/B UI variants.
- Mobile browsers.
- Generic non-YouTube runtime, because it is not shipped.
- Accessibility beyond basic labels and reduced-motion CSS checks.

Optional e2e:

- `tests/e2e-extension-debug.js` uses Playwright and screenshots/reports.
- README states it is intentionally not part of `release:check`.

## Recent Hardening Work

Recent defensive work is concentrated in `src/content-script.js`, `src/page-context.js`, `src/page-bridge.js`, and `src/transcript.js`.

Stale state:

- App methods check `isCurrentVideoPage()` before mutating live/transcript state.
- Transcript responses are checked against `this.videoId` and current URL.
- Unavailable/no-caption responses clear stale cue/chunk/future/timeline state through `clearCaptionStateForUnavailableVideo()`.

Route changes:

- Controller uses `loadNonce` to ignore old initialization.
- Route change tears down old app, flushes settings, and creates a new app.
- Page-context fetch responses are dropped after video id changes.

Language switching:

- Extension no longer calls `setOption("captions", "track")` or `setOption("captions", "reload")`.
- It snapshots YouTube's selected caption track read-only.
- Reopen from pill refreshes snapshot and reloads if preference changed.
- Open live capture freezes to the caption preference from panel open, avoiding mixed-language live bubbles.

Video transitions:

- Page snapshot cache returns null if snapshot video id differs from current `v=`.
- Timedtext captures are scoped/trimmed by video id.
- `ytInitialPlayerResponse` and page snapshot caption tracks are filtered by current video id.
- `ytInitialData` panel params are trusted only when initial data references the current video id.

Bridge snapshots:

- Snapshot request type is read-only.
- Stale bridge snapshots for previous videos are ignored.
- Bridge payload filters stale caption tracks and selected tracks by current video id.

Transcript loading:

- Per-load abort controller and nonce.
- Timeout race.
- One retry for likely reload races.
- Full timeline upgrade from live fallback is guarded by video id and caption preference.

## Technical Debt

### HIGH

1. `src/content-script.js` is a large stateful coordinator.

- Why it exists: it integrates routing, video binding, transcript loading, live fallback, native CC control, chunking, seeking, panel sync, and settings.
- Risk: changes in one lifecycle can accidentally affect another; hard to reason about all invariants.
- Difficulty: medium-high. Extracting state machines/services is possible but must be done incrementally with tests.

2. YouTube internals and page DOM coupling.

- Why it exists: caption access requires YouTube globals, player API, timedtext endpoints, and sometimes DOM transcript fallback.
- Risk: YouTube UI/API changes can break acquisition or native CC behavior.
- Difficulty: ongoing. Needs e2e diagnostics and defensive adapters, not a one-time fix.

3. Live fallback is inherently heuristic.

- Why it exists: some videos lack accessible full timelines or load metadata late.
- Risk: overlay text can be stale, late, duplicated, language-switched, or UI-contaminated.
- Difficulty: medium. Many guards exist, but precision limits remain.

### MEDIUM

4. Source-inspection tests are useful but brittle.

- Why it exists: many invariants are architectural/lifecycle patterns not easily executable in unit tests.
- Risk: refactors can break tests without breaking behavior, or preserve strings while behavior changes.
- Difficulty: medium. Replace highest-value source checks with behavior tests over time.

5. Global settings across tabs.

- Why it exists: extension storage is simple and product model treats preferences as global.
- Risk: two tabs changing panel/layout settings can overwrite each other in surprising ways.
- Difficulty: medium. Would require tab/session-scoped state or conflict-aware storage.

6. Optional e2e is not release-gated.

- Why it exists: YouTube/player/network behavior is unstable and Playwright setup is heavier.
- Risk: regressions in real browser/YouTube interactions may pass unit tests.
- Difficulty: low-medium. Add a small stable smoke gate or nightly diagnostic rather than making full e2e mandatory.

7. Versioning branch/package mismatch.

- Why it exists: current work is on `1.1.5-work` while manifests/package remain `1.1.4`.
- Risk: stale artifact names during manual testing and release prep confusion.
- Difficulty: low. Use existing `version:bump`/release verification process at release time.

### LOW

8. Generic adapter is present but not shipped.

- Why it exists: future support was prototyped but release scope is YouTube-only.
- Risk: source can drift from shared panel/settings changes.
- Difficulty: low-medium if kept quarantined; higher if promoted to runtime.

9. Timeline Scrub hidden experimental path.

- Why it exists: feature is implemented enough to test but not normal release UI.
- Risk: latent complexity in panel code.
- Difficulty: low if left hidden; medium if promoted.

10. Rainbow color is preview-only dynamic behavior.

- Why it exists: current implementation is a temporary RAF preview.
- Risk: future dynamic color presets will need a real persistence/model layer.
- Difficulty: low-medium.

## Future Feature Readiness

Additional video sites:

- Readiness: low-medium.
- Evidence: `src/universal-captions.js` provides an adapter-shaped prototype, but release manifests are YouTube-only and core content-script assumptions are YouTube-specific.
- Needed: per-site adapters, permissions review, runtime registry, and stronger multi-player isolation.

Multiple simultaneous players:

- Readiness: medium in source-only generic path, low in YouTube path.
- Evidence: `DialoguePanel` supports `instanceId`, `anchorElement`, and `persistLayout: false`; `universal-captions.js` attaches one app per eligible video. YouTube path assumes one active `DialogueCaptionsApp`.
- Needed: controller abstraction that can own multiple apps and avoid global launcher ids/settings collisions.

More transcript sources:

- Readiness: medium-high.
- Evidence: `transcript.js` already has multiple acquisition strategies and URL allowlists. `caption-timeline.js` normalizes results.
- Needed: explicit source interface and priority model to reduce monolithic fallback complexity.

More complex UI modes:

- Readiness: medium.
- Evidence: Panel already has workspace presets, timeline layer, future previews, theme controls, and launcher.
- Risk: `ui-panel.js` is large and stateful. New modes should avoid adding more hidden state without tests.

Mobile support:

- Readiness: low.
- Evidence: docs target desktop, Firefox manifest strict minimum targets desktop Firefox, UI assumes pointer/hover/keyboard and YouTube desktop selectors.
- Needed: touch UX, mobile YouTube DOM research, different manifest/store targeting, layout simplification.

## Top 10 Things A New Maintainer Should Know

1. The YouTube caption timeline is the intended source of truth. Overlay DOM text is fallback only.

2. Do not set YouTube's selected caption language from the extension. Current code intentionally reads selected track but avoids `setOption("captions", "track")`.

3. Video id is the main stale-state boundary. Any async result that lacks or mismatches the current `v=` should be treated as suspect.

4. Closing the panel is not the same as destroying the app. State may be reused on reopen if video/language state is unchanged.

5. Route changes destroy/recreate the app; same-video route events only nudge existing caption work.

6. Settings are global extension storage, not per-tab. Transcript text, playback position, active bubble, and video id must not be persisted.

7. Layout Lock controls whether geometry persists. Do not casually persist panel/launcher position when Lock is off.

8. Fullscreen/resize should refresh layout without rewriting saved user geometry unless the user actually drags/resizes.

9. Page-world bridge changes need security review: token validation, YouTube-only allowlist, and video-id scoping are core invariants.

10. Many tests encode lifecycle invariants by reading source. Refactors should update tests to preserve the invariant, not just the string.

## Audit Targets

If another engineer had 8 hours, focus here:

1. Build a lifecycle state diagram for `DialogueCaptionsApp` and split responsibilities.

- Why: `src/content-script.js` owns too many states.
- Concrete target: separate transcript acquisition session, live capture session, native CC session, and route/app lifecycle into smaller objects or explicit state machine.

2. Add behavior-level tests for route and stale async races.

- Why: current protections are partly source-inspection tests.
- Concrete target: VM or browser tests that simulate old snapshot/fetch/transcript responses arriving after URL changes and verify panel state is unchanged.

3. Add a minimal release-gate browser smoke test.

- Why: YouTube/player behavior is the largest external risk.
- Concrete target: one Chrome and one Firefox diagnostic against controlled URLs, checking panel mount, no stale caption carryover, fullscreen launcher position, and language non-mutation.

4. Audit `src/ui-panel.js` layout persistence boundaries.

- Why: fullscreen and Lock behavior are user-visible and easy to regress.
- Concrete target: all calls to `updateSettings()` involving `panelPosition`, `panelSize`, `launcherPosition`, `panelClosed`, and `timelineModeEnabled`.

5. Audit cross-tab settings behavior.

- Why: settings are global, while apps are per-tab.
- Concrete target: simulate two stores/tabs saving panelClosed/layout/theme changes and define intended conflict behavior.

6. Review page bridge security and compatibility.

- Why: bridge injects page script and wraps fetch/XHR.
- Concrete target: `src/page-bridge.js` allowlist, token retention, reload behavior, wrapper idempotency, and interaction with other page scripts.

7. Strengthen DOM transcript fallback validation.

- Why: DOM transcript is YouTube UI-dependent.
- Concrete target: ensure transcript DOM entries are current-video scoped where possible and cannot reuse stale opened transcript panels.

8. Review live fallback memory/performance.

- Why: long videos and live capture can accumulate bubbles/caches.
- Concrete target: `liveBubbles`, `liveDisplayBubbleCache`, future preview chunks, render windows, and cleanup under long playback.

9. Decide whether generic captions should remain quarantined.

- Why: `src/universal-captions.js` is tested but not shipped.
- Concrete target: either keep it intentionally source-only with docs/tests, or create a branch for promoting adapter architecture.

10. Create a release-version checklist for 1.1.5.

- Why: current artifacts still name `v1.1.4`.
- Concrete target: run version bump, release verification, and ensure generated archives and docs match the intended release version.
