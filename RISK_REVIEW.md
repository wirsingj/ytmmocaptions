# Risk Review

Current branch reviewed: `1.1.5-work`.

Scope: architecture risk review only. No code changes are proposed here as implemented changes.

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

## Highest-Value Target

Selected target: lifecycle/session complexity in `src/content-script.js`.

Reason for selection:

- It has the largest blast radius.
- It intersects both other risks: YouTube bridge/transcript async and UI/settings state.
- The recent hardening work added many guards in this area, which reduced known bugs but also shows that future bugs are likely to appear where session boundaries remain implicit.
- Mitigation can be incremental and testable without adding features.

## Focused Investigation: Lifecycle/Session Complexity

### Findings

#### Finding 1: `DialogueCaptionsApp` is the implicit owner of several independent sessions

Evidence:

- `src/content-script.js` constructor initializes state for video identity, panel, transcript load, live capture, native caption restore, heartbeat, seek focus, timeline sync, and live bubble caches.
- `startCaptionWork()` controls first-open, reopen, preference reload, live fallback start, transcript load, heartbeat scheduling, and status updates.
- `loadTranscript()` controls transcript session creation, aborting previous loads, retry policy, live fallback enablement, and final application of full transcript state.
- `tryUpgradeLiveCaptureToTranscript()` is a second full-transcript acquisition path with its own abort controller and application logic.
- `recoverTranscriptActivity()` can start/continue live capture and call `loadTranscript()`.

Consequence:

- The code relies on each method remembering every relevant guard and reset. There is no one object representing "the active caption acquisition session" or "the active live capture session."

#### Finding 2: There are multiple transcript acquisition entry points with overlapping responsibilities

Evidence:

- `startCaptionWork()` calls `loadTranscript()`.
- `recoverTranscriptActivity()` calls `loadTranscript()` if `!this.transcriptLoadInFlight`.
- `tryUpgradeLiveCaptureToTranscript()` calls `captionTimeline.acquireFullTimeline()` directly instead of going through `loadTranscript()`.
- `loadTranscript()` itself can recursively call `this.loadTranscript()` after a reload-race delay.

Existing protection:

- `loadTranscript()` aborts the previous `loadAbortController`.
- `transcriptLoadInFlight` prevents heartbeat from starting another `loadTranscript()`.
- `tryUpgradeLiveCaptureToTranscript()` uses `transcriptUpgradeInFlight`.

Remaining concern:

- The full transcript "apply success" logic exists in both `loadTranscript()` and `tryUpgradeLiveCaptureToTranscript()`, with similar but not identical guard structure.
- The upgrade path is not governed by `transcriptLoadNonce`.

#### Finding 3: Close/open is a lifecycle boundary, but not an ownership boundary

Evidence:

- Closing the panel stops polling and restores native CC, but does not destroy `DialogueCaptionsApp`.
- Reopening calls `startCaptionWork()` with `captionWorkStarted === true`.
- Reopen can reuse existing transcript state or clear/reload based on `lastCaptionPreferenceKey`, `openCaptionPreferenceKey`, and `hasTranscriptActivity()`.

Existing protection:

- Reopen refreshes page snapshot with `pageContext.requestSnapshot(650)`.
- Preference changes clear stale state and reload.
- If unchanged, full transcript state can be reused for speed.

Remaining concern:

- Reuse safety depends on the current preference key being the complete set of conditions that make old transcript state valid.
- Future settings such as dynamic transcript source preference, translation mode, or per-video display filters could require inclusion in the reuse key.

#### Finding 4: Heartbeat recovery can revive several systems at once

Evidence:

- `recoverTranscriptActivity()` calls `ensurePageBridgeForWatchPage()`, `startCaptionEnsureLoop()`, `ensureCaptionsEnabledOnce()`, `probeCaptionsNow()`, `enableLiveCaptureMode()` or `startLiveCapturePolling()`, `captureLiveCaptionLine()`, and possibly `loadTranscript()`.
- Heartbeat is intentionally one-shot/rebounded rather than unbounded polling.

Existing protection:

- Max recovery attempts and readiness deferrals.
- Does not reinitialize live mode if live capture already exists.
- Stops when transcript activity exists.

Remaining concern:

- It is an emergency recovery path with broad side effects. Future edits may use it to paper over unrelated readiness bugs and increase state coupling.

#### Finding 5: Native YouTube CC state is coupled to caption acquisition lifecycle

Evidence:

- `ensureCaptionsEnabledOnce()` captures initial subtitle state and may call page bridge probe, player toggle, or button fallback.
- `restoreSubtitlesIfExtensionEnabled()` runs on panel close and destroy.
- `startCaptionEnsureLoop()` schedules multiple delayed ensure attempts.

Existing protection:

- Extension records whether captions were off before it enabled them.
- Restore resets ensure flags on close.
- Recent tests check that probing does not change selected caption language.

Remaining concern:

- This state is not isolated from transcript/live session state. Future caption-probe paths must update restore bookkeeping correctly.

### Likely Failure Scenarios

1. Route changes during transcript retry.

- A transcript load fails with "No caption tracks", schedules the 950 ms retry, then YouTube route changes.
- Current guard checks `signal.aborted`, `destroyed`, and later `isCurrentVideoPage()`, but future changes to retry handling could accidentally call back into `loadTranscript()` on a stale app.
- Failure symptom: old app restarts live fallback or clears panel state during/after new video app startup.

2. Live upgrade and normal load overlap.

- Live fallback is active. Heartbeat or reopen starts `loadTranscript()` while `tryUpgradeLiveCaptureToTranscript()` is also in flight.
- Both can acquire full timelines and both have logic to disable live mode and apply cues.
- Existing guards reduce this, but the upgrade path has separate session identity from normal load.
- Failure symptom: duplicate status transitions, live state cleared at unexpected time, or newer transcript state overwritten by older upgrade response.

3. Close/reopen while caption ensure timers are active.

- User closes panel after initial open while delayed `startCaptionEnsureLoop()` timers still exist.
- Timers check `destroyed` and `captionsEnsured`, while `ensureCaptionsEnabledOnce()` checks `panelClosed`.
- Future edits to the timer callback or ensure path could bypass closed-panel semantics.
- Failure symptom: native YouTube CC toggles after panel is closed.

4. Future feature adds a new setting that affects transcript contents but not reuse key.

- Example classes: translation mode, transcript source priority, dynamic language selection, custom filtering.
- Reopen path reuses transcript state because selected YouTube caption language did not change.
- Failure symptom: panel shows transcript built under old settings until route reload/full reload.

5. Same-video route nudges become too aggressive.

- YouTube emits frequent same-video events.
- `nudgeCaptionWork()` currently only acts when the open panel is empty and no heartbeat is pending.
- A future change could start caption work repeatedly or reset recovery counters incorrectly.
- Failure symptom: redundant probes, native CC toggles, or repeated transcript loads.

### Recommended Mitigations

#### Mitigation 1: Introduce an explicit caption work session id

Goal:

- Centralize ownership of work started by `startCaptionWork()`, `loadTranscript()`, heartbeat recovery, and live upgrade.

Shape:

- Add a monotonic `captionSessionId`.
- Increment on route app creation, panel open after close, preference reload, and explicit clear/reload.
- Pass the id into transcript load, live upgrade, heartbeat callbacks, and caption ensure loop.
- Before applying any result, check the id.

Why this is highest leverage:

- It turns many local stale checks into one shared invariant.
- It does not require a broad refactor.
- It can coexist with existing `destroyed`, `isCurrentVideoPage()`, and `transcriptLoadNonce` guards.

#### Mitigation 2: Extract transcript result application into one method

Goal:

- Avoid drift between `loadTranscript()` success path and `tryUpgradeLiveCaptureToTranscript()` success path.

Shape:

- Introduce a method like `applyFullTranscriptResponse(response, source, sessionId)`.
- It verifies current video, session id, panel state, preference key, cue array, and destroyed state.
- It owns `disableLiveCaptureMode()`, cue assignment, chunk rebuild, preview assignment, activity note, sync, and status.

Why:

- Full transcript application is a critical state transition and should not be duplicated.

#### Mitigation 3: Separate native CC ensure/restore into a small session object

Goal:

- Make it harder for future probes to mutate native CC state without restore bookkeeping.

Shape:

- Keep API small: `beginPanelOpen()`, `ensureOnce()`, `startRetryLoop(sessionId)`, `restoreIfNeeded()`, `reset()`.
- Internally own `captionsWereOnBeforeExtension`, `captionsEnabledByExtension`, `captionsEnsured`, `captionEnsureStarted`.

Why:

- Native CC side effects are user-visible and "dangerous" because they alter YouTube state outside the panel.

#### Mitigation 4: Define a transcript reuse key function

Goal:

- Prevent future feature state from being forgotten in reopen reuse decisions.

Shape:

- Replace ad hoc preference key use with a named method such as `getTranscriptValidityKey()`.
- Include selected caption preference now.
- Document that any future setting affecting transcript contents must be included.

Why:

- The current key is correct for today's language-centered behavior but not necessarily for future transcript-affecting options.

### Rough Implementation Plan

This is intentionally incremental and should not be done as a broad rewrite.

1. Add session id plumbing.

- Add `captionSessionId = 0` to `DialogueCaptionsApp`.
- Add `beginCaptionSession(reason)` and `isActiveCaptionSession(sessionId)`.
- Increment on first `startCaptionWork()`, preference reload, close/open reload, and route-created app startup.
- Do not increment for same-session fast reuse.

2. Guard async callbacks with session id.

- Pass session id into `loadTranscript(sessionId)`.
- Pass session id into retry delay and timeout result application.
- Pass session id into `tryUpgradeLiveCaptureToTranscript(sessionId)`.
- Pass session id into heartbeat scheduling/recovery.
- Pass session id into caption ensure loop timers if practical.

3. Extract full transcript application.

- Move shared success-state transition out of `loadTranscript()` and `tryUpgradeLiveCaptureToTranscript()`.
- Preserve current status messages by passing source/context options.

4. Introduce `getTranscriptValidityKey()`.

- Initially return current caption preference key.
- Use it for `lastCaptionPreferenceKey` / `openCaptionPreferenceKey` comparisons or rename those fields to validity-key names.

5. Optionally extract native CC session.

- Do this only after tests are in place for session id and transcript application.
- Keep behavior identical.

### Rough Test Plan

Add behavior-oriented tests before implementation where possible.

1. Stale retry cannot restart old work.

- Simulate `loadTranscript()` failure with likely reload-race reason.
- Before retry fires, invalidate session or route.
- Assert no second effective transcript application, no live reinitialization, and no panel mutation.

2. Live upgrade result loses to newer transcript load.

- Start live upgrade acquisition.
- Start a newer caption session/load before upgrade resolves.
- Resolve old upgrade.
- Assert old response is ignored.

3. Normal transcript result loses to newer preference reload.

- Start transcript load under preference A.
- Change/open session to preference B.
- Resolve A.
- Assert A is ignored and state remains empty/loading/B.

4. Close cancels caption ensure side effects.

- Start caption ensure retry loop.
- Close panel before delayed ensure fires.
- Run timers.
- Assert native CC toggle path is not called.

5. Shared full transcript application path.

- Test that normal load success and live upgrade success both pass through the same validity checks.
- Avoid source-string-only assertion if possible; use instrumentation/mocks.

6. Transcript reuse key contract.

- Unit test that reopen reuse depends on `getTranscriptValidityKey()`.
- Add a comment/test fixture that future transcript-affecting settings must alter this key.

## Summary

The current architecture has meaningful stale-state protections, and recent work reduced known route/language/video transition risks. The remaining highest-risk class is not a single missing guard; it is implicit session ownership inside `src/content-script.js`. The next architecture-hardening pass should make caption work session identity explicit and centralize full transcript application. That would reduce future bugs without changing product behavior or requiring a broad refactor.
