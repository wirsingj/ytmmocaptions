# YTMMOCC

YTMMOCC is a lightweight Chrome/Firefox extension that turns YouTube captions and transcripts into an MMO-style dialogue panel. This release is YouTube-only and runs locally in the browser.

## Build Outputs

Fresh local browser packages are always generated in the same active build
folders:
- `build/chrome/ytmmocaptions-chrome-v<version>.zip`
- `build/firefox/ytmmocaptions-firefox-v<version>.xpi`

Packaging also copies the browser artifacts into a versioned folder:
- `build/releases/v<version>/ytmmocaptions-chrome-v<version>.zip`
- `build/releases/v<version>/ytmmocaptions-firefox-v<version>.xpi`

AMO source-code packages are generated separately in `downloads/`:
- `downloads/ytmmocaptions-source-v<version>.zip`

## Store Listing Assets

Marketplace helper files live in `store-assets/`:
- `store-assets/amo-listing-draft.md`
- `store-assets/screenshot-panel-over-video.png`

The packaged extension includes only runtime files, icons, README, privacy
policy, and license. Store listing assets are not included in release packages.

## Firefox Marketplace Submission

Use the Firefox XPI from `build/firefox/` for AMO upload. For each release:
- upload `build/firefox/ytmmocaptions-firefox-v<version>.xpi`;
- if AMO asks for source code, upload `downloads/ytmmocaptions-source-v<version>.zip`;
- target desktop Firefox only;
- select no data collection;
- paste `PRIVACY.md` if AMO asks for a privacy policy;
- use `store-assets/amo-listing-draft.md` for listing copy and reviewer notes;
- upload `store-assets/screenshot-panel-over-video.png` as a listing screenshot.

## Core UX

- Bottom-left floating chat panel with scroll history.
- Subtitle cues grouped into readable chunks.
- Music/lyric-like captions split a little sooner so song lines do not become paragraph blobs.
- Hover the panel and press `Space` to go to the next chunk.
- Hover the panel and press `Shift+Space` to go to the previous chunk.
- Clicking a chunk seeks the video.
- Keyboard controls are safe by default and only run when the pointer is over the panel.
- Future / Next Up previews can be turned on or off.
- Color, opacity, and center fade persist across YouTube videos using extension storage.
- Layout Lock can also persist panel open/closed state, panel size/position, text size, Future / Next Up setting, and preview height.
- With Layout Lock off, panel layout resets for each video/session.
- Transcript/chat contents, active bubble, and playback position are intentionally not saved.

Timeline Scrub mode remains experimental and is hidden from the normal release UI.

## Project Structure

```text
ytmmocaptions/
  src/
    platform.js
    diagnostics.js
    page-context.js
    settings-store.js
    caption-text.js
    chunker.js
    bubble-state.js
    transcript.js
    caption-timeline.js
    ui-panel.js
    content-script.js
    page-bridge.js
  styles/
    panel.css
  assets/
    icons/
  scripts/
    build.mjs
  store-assets/
    amo-listing-draft.md
    screenshot-panel-over-video.png
  manifest.chrome.json
  manifest.firefox.json
  manifest.json
  LICENSE
  PRIVACY.md
  package.json
  build/
    chrome/      (generated)
    firefox/     (generated)
```

## Build

```powershell
npm run build
```

The build script generates clean artifacts:
- `build/chrome`
- `build/firefox`

`npm run build` does not change version numbers. To intentionally bump the patch version before a release, run:

```powershell
npm run version:bump
```

To generate a Firefox upload/install package (`.xpi`) with AMO-safe archive paths:

```powershell
npm run build:firefox:xpi
```

Output:
- `build/firefox/ytmmocaptions-firefox-v<version>.xpi`

To generate a Chrome upload package (`.zip`):

```powershell
npm run build:chrome:zip
```

Output:
- `build/chrome/ytmmocaptions-chrome-v<version>.zip`

To run full pre-submission scan + package for both stores:

```powershell
npm run release:check
```

To run the local release sanity gate, including package-content checks:

```powershell
npm run release:sanity
```

See `RELEASE.md` for tag-based GitHub Release and store publishing automation.

For manual pre-upload smoke testing, use `QA_CHECKLIST.md`.

## Optional Diagnostics

The one-shot browser diagnostic is intentionally not part of `release:check`.
It is useful while debugging YouTube behavior, but it requires Playwright to be
installed locally and may be affected by network/player changes.

```powershell
npm install
npx playwright install chromium firefox
npm run diagnostic:e2e -- --browser=both --url=https://www.youtube.com/watch?v=VIDEO_ID
npm run diagnostic:e2e -- --browser=both --url=https://www.youtube.com/watch?v=VIDEO_ID --headed
```

Useful flags:
- `--browser=firefox`, `--browser=chrome`, or `--browser=both`
- `--headed`
- `--leave-open`
- `--artifacts-dir=tests/artifacts/my-run`

For local debugging, add `dcdebug=1` to a YouTube watch URL to enable concise
console diagnostics. The in-memory report is available from DevTools as
`window.DialogueCaptions.diagnostics.getReport()`. It stores no raw captions,
video titles, account data, cookies, tokens, or remote telemetry.
The optional Playwright diagnostic writes `tests/artifacts/e2e-report.json`
plus screenshots with per-check health results. By default, both browsers run
headless in a clearly labeled shared-source injected diagnostic mode so the
checks stay quiet and comparable. Use `--headed` when you specifically want
Chrome to run as a real unpacked extension for closer manual smoke testing.
Firefox remains shared-source diagnostic mode because Playwright does not
provide equivalent Firefox WebExtension install control. It still provides
useful Firefox engine, layout, caption-source, console, and interaction health
signal without becoming a release blocker.

## Load Unpacked

### Chrome

1. Run `npm run build:chrome:zip`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select `build/chrome`.

For Chrome Web Store upload, use:
- `build/chrome/ytmmocaptions-chrome-v<version>.zip`

### Firefox

1. Run `npm run build:firefox:xpi`.
2. Use Firefox version 142 or newer.
3. Open `about:debugging#/runtime/this-firefox`.
4. Click Load Temporary Add-on.
5. Select `build/firefox/manifest.json`.

In `about:debugging`, the temporary extension location should end with `build/firefox/`. If it points at the project root, remove it and load `build/firefox/manifest.json` again.

For AMO signing/upload, use:
- `build/firefox/ytmmocaptions-firefox-v<version>.xpi`

## Store Compliance Notes

- Host permissions are kept to YouTube only. Browser host-permission paths may be ignored by Chrome/Firefox, so runtime activation is also route-gated to `/watch?v=...`.
- Content scripts are loaded only on `https://www.youtube.com/*` so YouTube SPA navigation can be detected reliably.
- YouTube page-bridge caption hooks are still gated to valid `/watch?v=...` pages only.
- Page-bridge work is additionally guarded inside the injected page script so snapshots, caption probes, timedtext captures, and bridge fetches stop after YouTube SPA navigation leaves a valid `/watch?v=...` route.
- No personal data collection.
- Only local UI preferences are stored via extension storage.
- Keyboard shortcuts are not global in the release UI; they activate when the pointer is over the panel and are ignored while typing.
- If transcript/subtitles are unavailable, the extension shows a clear in-panel message and exits safely.
- Subtitle/caption data is processed locally for the current video only. The extension is a local accessibility/navigation aid and does not bulk download, export, or transmit captions to the developer or third parties.
- Privacy details are in `PRIVACY.md`.
- License terms are in `LICENSE`.
- Firefox manifest includes `browser_specific_settings.gecko.data_collection_permissions.required=["none"]`.
- Firefox minimum version is 142+ because the manifest data-collection declaration needs newer Firefox validation support.
- v1 targets desktop Chrome and desktop Firefox only. Do not select Firefox for Android in AMO unless it is tested separately.

## License

YTMMOCC is source-available proprietary software. The public repo may
be cloned, reviewed, built, and loaded locally for personal non-commercial
testing only. Reuse, redistribution, sublicensing, commercial cloning, and
publishing modified builds are not allowed. See `LICENSE`.
