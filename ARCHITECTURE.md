# YTMMOCC Architecture Notes

YTMMOCC is an MMO-style dialogue layer for YouTube captions and transcripts. The 1.1.3 release is intentionally YouTube-only; generic HTML5 caption support is source-only experimental work and is not included in Chrome or Firefox runtime packages. The product should feel like a calm chat log over the video, not a dashboard, transcript exporter, analytics product, AI transcription tool, or replacement video player.

## Product North Star

- The associated YouTube player's caption timeline is the source of truth.
- YouTube uses the dedicated known-good acquisition path.
- Words belong to timestamped caption tokens.
- Chat bubbles are stable grouped views over those tokens.
- A locked bubble is immutable: its text and timing should not be rewritten later.
- Click-to-seek should land at the selected bubble or word start, with a small early lead when useful so playback feels crisp instead of late.
- Reading glow should follow the same token timeline used to build bubbles.
- Future captions, when available, are previews from the parsed caption timeline, not a second source of truth.

## Quarantined Adapter Model

Generic-player work should stay adapter-based when it resumes, but it is not part of the released extension yet:

1. Discover eligible video players.
2. Attach one controller/panel per eligible player.
3. Let each caption adapter acquire the best available timed-text source.
4. Normalize all sources into the same cue shape before chunking/rendering.

Initial adapters:

- YouTube adapter path: existing `caption-timeline.js` + `transcript.js` flow.
- Generic HTML5 adapter: `universal-captions.js` reads `HTMLMediaElement.textTracks` and `<track kind="captions|subtitles">`.

Future Twitch, Vimeo, JWPlayer, Brightcove, or CDN player adapters should plug in by returning normalized timed cues. They should not scrape unrelated page content, capture audio, call transcription services, or require broad new permissions unless there is a clear product/review justification.

Generic non-YouTube panels use the same UI component but stay anchored to their owning `<video>` element. They do not persist per-page positions by default, because multiple videos may exist on a single page.

## Timing Model

The preferred data flow is:

1. `caption-timeline.js` asks available acquisition strategies for the best full caption timeline.
2. `transcript.js` performs the lower-level timedtext/TextTrack/intercept parsing work.
3. Cue-level tokens with timestamps are normalized into one shared timeline shape.
4. Conversational chunking groups that timeline into bubble records.
5. Renderer consumes bubble records and token timing.

Overlay DOM text is a fallback only. It can help when full transcript data is unavailable, but it is inherently later and less precise than YouTube's caption timing.

All playback interactions should agree on one canonical current time from the associated video element. Avoid duplicated seek math in separate modules; route time decisions through shared helpers where practical.

## Bubble Rules

- One active bubble may grow while the current thought is still being captured.
- Once a bubble is locked, treat it as immutable data.
- Bubble records should be plain data objects with stable `id`, `start`, `end`, `text`, token timing, and lock state.
- Re-seeking should not mutate locked bubbles or replay old words into new bubbles.
- Future captions are compact previews from parsed transcript/chunk data when available.
- Future preview chrome should stay visually secondary and must not rewrite active bubble text.

## UI Rules

- Keep the overlay lightweight, readable, and game-like.
- Prefer subtle glass blending over heavy panels that fight the video.
- Controls should stay compact and obvious without turning the panel into settings UI.
- Any new UI affordance should answer: does this make caption reading or navigation better?

## Workspace / Preferences Model

The panel treats layout as a local workspace, not as video data. Transcript text, playback position, active bubble, and revealed history are runtime state only and should not be stored.

Current model:

- Layout Lock off: each video starts from the default panel workspace. Global readability preferences such as theme, custom color, opacity, Fade, and open/closed state still persist because they are not tied to a particular workspace geometry.
- Layout Lock on: the same workspace follows the user across YouTube videos. This includes panel position, panel size, text size, Future / Next Up state, Case Fix state, future preview height, launcher position, and open/closed state.
- Workspace presets: three seeded local snapshot slots act as temporary loadouts layered over the current Lock model. Slot 1 starts as the shipped default workspace, slot 2 starts as a music/demo mode, and slot 3 starts as a podcast mode. A preset stores panel position, panel size, text size, opacity, Fade, theme/custom color, Future / Next Up, and Case Fix. It does not store video identity, transcript content, current timestamp, active bubble, Lock state, pinned defaults, dynamic rainbow state, or viewing history. Applying a preset does not mutate the saved preset; disabling it restores the pre-preset baseline where practical.
- Reset: returns the panel workspace shape to defaults for the current session: text size, panel position, panel size, future preview height, center fade geometry, Timeline mode, launcher position, and open panel state. It intentionally preserves theme, custom color, opacity, Fade enabled/disabled, Future / Next Up enabled/disabled, and Case Fix enabled/disabled.

Pinned defaults are deferred. They would create a second persistence layer between "default workspace" and "locked workspace," and the current product model does not yet justify that added complexity. Revisit only if usage shows users want a personal baseline that is different from both the shipped default and the locked cross-video workspace.

## Branching Rules

- Use `feature/*` branches for experiments and implementation work.
- Use release branches only for explicit release-prep moments.
- Do not create release tags unless explicitly requested.
- Keep risky/new interactions in separate commits so they can be reverted cleanly.
- Build outputs are generated artifacts; commit source changes intentionally and keep release packages clearly named.

## Store Safety

- No remote analytics or tracking.
- No broad permissions.
- Release content scripts run on YouTube only. Do not add generic HTTP/HTTPS matches unless a future release explicitly brings generic-player support back into scope.
- No raw transcript storage by default.
- Diagnostics stay local and opt-in.
- Shared source must stay Chrome/Firefox safe. Browser-specific differences should live in manifests/build packaging unless there is a strong reason.

## Deferred Ideas

- Word-click seeking should be implemented on its own feature branch and commit, because it touches interaction timing and should be easy to revert.
- Theme/color customization is allowed if it stays local-only, simple, and store-safe.
