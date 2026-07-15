# Risk Review

Current branch reviewed: `1.1.6-work`.

Scope: architecture risk review only. No code changes are proposed here as implemented changes.

2026-06-29 audit update: the earlier recommendation to add explicit caption session identity has largely been implemented through `src/caption-session.js`, `CaptionSessionManager`, session ids on transcript load/upgrade/heartbeat/ensure paths, and focused stale-session tests. The remaining risk has shifted from "missing session id" to "large coordinator modules and duplicated ownership boundaries."

## Ranked Failure Classes

### 1. Lifecycle/session complexity in the YouTube content script

Risk class: ownership confusion and late-arriving lifecycle work across route, panel, transcript, live fallback, heartbeat, native CC, and UI sync.

Files involved:

- `src/content-script.js`
- `src/caption-timeline.js`
- `src/transcript.js`
- `src/ui-panel.js`
- `src/settings-store.js`
- Tests: `tests/live-bubbles.test.js`, `tests/transcript.test.js`, `tests/ui-panel.test.js`, `tests/settings-store.test.js`

Why risky:

- `DialogueCaptionsApp` owns many independent-but-interacting sessions: route identity, video binding, transcript loading, live capture, transcript upgrade, heartbeat recovery, native CC enable/restore, panel state, seek focus, timeline sync, and settings persistence.
- Most protections are local guard checks rather than a single explicit lifecycle/session model.
- Several methods can start overlapping async work: `startCaptionWork()`, `loadTranscript()`, `recoverTranscriptActivity()`, `nudgeCaptionWork()`, and `tryUpgradeLiveCaptureToTranscript()`.
- Close/open does not destroy the app, route change does. That is intentional, but it means app state can be dormant and later reused.

Existing protections:

- `DialogueCaptionsController.loadNonce` ignores stale route initialization.
- `DialogueCaptionsApp.destroyed` guards most async callbacks.
- `isCurrentVideoPage()` prevents stale app instances from applying route-old data.
- `transcriptLoadNonce` and `AbortController` exist for full transcript loads.
- `transcriptUpgradeInFlight`, upgrade attempt limits, and 7-second throttling limit full-timeline upgrades from live mode.
- `hasOpenCaptionPreferenceChanged()` freezes live capture and transcript upgrade to the caption preference active when the panel opened.
- Heartbeat recovery has max attempts and readiness deferrals.
- Tests assert important invariants in `tests/live-bubbles.test.js`.

Scenarios that could still fail:

- `startCaptionWork()` can be entered from panel reopen, same-video route nudges, and heartbeat recovery. A future change could add another entry point that does not update all related flags.
- `loadTranscript()` recursively retries on likely reload races. It aborts previous loads when called, but retry recursion and heartbeat-triggered loads can interact in subtle ways.
- `tryUpgradeLiveCaptureToTranscript()` uses its own `AbortController`, separate from `loadAbortController`; app destroy does not centrally own all outstanding session controllers.
- Native CC restore state is coupled to panel close/destroy and caption ensure probes. A new probe path could toggle CC without participating in restore state.
- Live fallback can own partial bubbles while full transcript acquisition is pending. Future changes to merge/reuse behavior could duplicate, erase, or mix state.
- Reopen fast path reuses transcript state if preference matches. A future state variable not included in that preference key could make reuse unsafe.

Likelihood: High.

Impact: High. Failures can manifest as wrong-language subtitles, stale subtitles after video transition, missing captions, native YouTube CC left on/off incorrectly, duplicate bubbles, or panel state that cannot recover without reload.

Mitigation difficulty: Medium-high. The risk is not one bad function; it is the lack of a single session ownership boundary.

### 2. YouTube/page API dependency and bridge behavior

Risk class: external API/DOM dependency risk and page-world bridge compatibility.

Files involved:

- `src/page-context.js`
- `src/page-bridge.js`
- `src/transcript.js`
- `src/content-script.js`
- Tests: `tests/page-context.test.js`, `tests/page-bridge.test.js`, `tests/transcript.test.js`

Why risky:

- The extension relies on YouTube page globals (`ytInitialPlayerResponse`, `ytInitialData`, `ytcfg`), `movie_player` caption APIs, timedtext endpoints, youtubei endpoints, DOM transcript controls, and visible caption overlay DOM.
- `page-bridge.js` wraps page `fetch` and `XMLHttpRequest` to observe timedtext responses.
- YouTube can change endpoint formats, player API behavior, transcript panel structure, caption menu state, timing of route events, or service-worker/cache behavior.

Existing protections:

- Fetch allowlists in `src/page-bridge.js` and `src/transcript.js`.
- Bridge token validation and same-origin checks.
- Snapshot, selected track, caption track, timedtext capture, and bridged fetch responses are video-scoped.
- Multiple acquisition fallbacks exist: timedtext, `get_panel`, `get_transcript`, text tracks, intercepted timedtext, transcript DOM.
- Tests cover many stale metadata and blocked URL cases.

Scenarios that could still fail:

- YouTube changes caption track metadata fields so selected-language preference degrades.
- `movie_player.getOption("captions", "track")` or `isSubtitlesOn()` behavior differs across browser/player versions.
- Transcript panel DOM fallback opens or reads the wrong UI if YouTube changes menu structure.
- Page fetch/XHR wrappers conflict with YouTube internals or another injected script.
- Timedtext or youtubei responses remain valid HTTP responses but change payload schema in a way not covered by unit fixtures.

Likelihood: Medium-high.

Impact: High. A YouTube change can break acquisition broadly across all users.

Mitigation difficulty: Medium. More diagnostics/e2e coverage helps, but external dependency risk cannot be eliminated.

### 3. Global settings and UI state drift across tabs, fullscreen, and layout modes

Risk class: persistent UI state drift and cross-tab preference conflicts.

Files involved:

- `src/settings-store.js`
- `src/ui-panel.js`
- `src/content-script.js`
- `src/platform.js`
- Tests: `tests/settings-store.test.js`, `tests/ui-panel.test.js`, `tests/compliance.test.js`

Why risky:

- Settings are global extension storage while app instances are per tab.
- `panelClosed` persists globally even when `layoutLocked` is off.
- Layout persistence depends on `layoutLocked`, `persistLayout`, passive layout refreshes, and panel snapshot timing.
- UI state updates originate from many panel controls, drag/resize handlers, launcher drag, reset, workspace preset apply/capture, and pagehide/visibility persistence.

Existing protections:

- `settings-store.js` normalizes all settings and serializes writes through `saveQueue`.
- `settingsStore.flush()` is awaited before route-created app startup.
- With Lock off, panel/launcher geometry is not persisted.
- Tests cover unlocked vs locked layout persistence, settings flush, migration, fullscreen-style geometry, and passive resize not rewriting saved ratios.

Scenarios that could still fail:

- Two tabs change settings near-simultaneously; last writer wins with no tab/session conflict awareness.
- `panelClosed` from one tab affects new tabs unexpectedly.
- Fullscreen/theater/regular transitions plus pagehide snapshot could persist a position from a transient layout if future changes bypass existing passive-refresh protections.
- Workspace presets store layout snapshots even when Lock is off; future dynamic UI settings could blur workspace-vs-global boundaries.

Likelihood: Medium.

Impact: Medium. Usually recoverable via Reset/reload, but can look like broken UI placement or confusing open/closed behavior.

Mitigation difficulty: Medium. Requires clearer product policy for global vs tab-local settings and possibly storage schema changes.

## Current Highest-Value Targets

### 1. Reduce coordinator load in `src/content-script.js`

The original lifecycle/session risk has improved. `CaptionSessionManager` exists, content-script paths pass session ids through transcript load, live upgrade, heartbeat, and caption ensure paths, and tests cover session invalidation and abort behavior.

Remaining concern:

- `DialogueCaptionsApp` is still the central owner of route state, video binding, transcript acquisition, live fallback, heartbeat, native CC state, panel sync, timeline actions, and settings persistence.
- The next useful move is not "add sessions"; it is to extract clearer boundaries around caption acquisition, native CC ownership, and timeline/seek focus while preserving behavior.

Useful first slice:

- Extract a small caption acquisition boundary or helper methods around `loadTranscript()`, `tryUpgradeLiveCaptureToTranscript()`, `canApplyFullTranscriptResponse()`, and `applyFullTranscriptResponse()`.
- Keep product behavior unchanged.
- Add or preserve stale-session tests.

### 2. Add a settings ownership table

Current docs explain Layout Lock and workspace presets, but `settings-store.js` still has many fields whose ownership is easy to blur.

Concrete target:

- Document fields as global readability, layout-locked workspace, workspace preset snapshot, runtime-only, or never stored.
- Use that table before adding any new UI preference.

### 3. Replace highest-value source-inspection tests with behavior tests

Source-inspection tests are useful and have caught architectural regressions, but they are brittle during refactors.

Concrete target:

- For route/session, settings ownership, and bridge security invariants, keep the source checks until behavior harnesses exist.
- When touching a brittle source check, ask whether a VM-level behavior test can replace it.

### 4. Add a minimal real-browser smoke before releases

Optional Playwright diagnostics exist, but they are not release-gated.

Concrete target:

- Keep full e2e optional.
- Add or document a minimal manual/pre-release smoke: build extension, open one captioned URL, confirm panel/bubbles, navigate to a second URL, confirm stale text does not carry over.
- Decide later whether this belongs in CI, a nightly job, or manual release checklist.

### 5. Review local diagnostic artifact hygiene

Ignored local artifacts under `tests/artifacts/` can become large and pollute broad searches. Current audit found local ignored artifacts around 122 MB.

Concrete target:

- Keep `tests/artifacts/` ignored.
- Prefer `rg --glob '!tests/artifacts/**'` for broad text audits when local diagnostics exist.
- Consider adding a cleanup note to the diagnostic script or maintainer guide.

## Current Short-Term Backlog

1. Clarify settings ownership and persistence buckets in `ARCHITECTURE.md` or `settings-store.js`.
2. Extract one caption acquisition boundary from `src/content-script.js`.
3. Add behavior coverage for a stale async race that is currently source-asserted.
4. Add a minimal release smoke checklist or command.
5. Review page bridge comments/invariants before any bridge feature work.

## What Not To Do

- Do not rewrite `content-script.js` wholesale.
- Do not promote generic video support by only adding manifest permissions.
- Do not persist transcript text, active bubble, playback position, or viewing history.
- Do not make optional e2e a mandatory PR gate until flake characteristics are understood.
- Do not set YouTube selected caption track from the extension unless product/review requirements change.
- Do not make YAIML a build contract; it is loose project memory for humans and agents.

## Audit Confidence

High confidence in source/test/document structure findings.

Medium confidence in runtime YouTube behavior findings, because no live browser/manual QA was performed in this review.

Low confidence in store API behavior, because workflows/scripts were inspected but not exercised against Chrome Web Store or AMO.

## Summary

The project has stronger stale-session defenses than the earlier risk review implied. The main remaining risks are now scale and coupling: `content-script.js` and `ui-panel.js` remain large stateful modules, YouTube remains an external moving target, release/store behavior is not exercised against real services in tests, and real browser smoke remains optional. The best next work is incremental boundary extraction plus higher-value behavior tests, not a broad rewrite.
