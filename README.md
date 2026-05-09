# Dialogue Captions

Dialogue Captions is a Chrome/Firefox extension that turns YouTube subtitles into an MMO-style dialogue panel.

## Downloads

Latest packaged builds are checked into `downloads/`:
- `downloads/ytmmocaptions-chrome-v<version>.zip`
- `downloads/ytmmocaptions-firefox-v<version>.xpi`

Older local test packages are intentionally pruned so the repo points people at
the current release candidate instead of stale builds.

## Core UX

- Bottom-left floating chat panel with scroll history.
- Subtitle cues grouped into readable chunks.
- Music/lyric-like captions split a little sooner so song lines do not become paragraph blobs.
- Hover the panel and press `Space` to go to the next chunk.
- Hover the panel and press `Shift+Space` to go to the previous chunk.
- Clicking a chunk seeks the video.
- Keyboard controls are safe by default and only run when the pointer is over the panel.
- Panel preferences persist across YouTube videos: open/closed state, panel size/position, pill position, opacity, and text size.
- Transcript/chat contents, active bubble, and playback position are intentionally not saved.

## Project Structure

```text
ytmmocaptions/
  src/
    platform.js
    page-context.js
    settings-store.js
    caption-text.js
    chunker.js
    bubble-state.js
    transcript.js
    ui-panel.js
    content-script.js
    page-bridge.js
  styles/
    panel.css
  scripts/
    build.mjs
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

## Optional Diagnostics

The one-shot browser diagnostic is intentionally not part of `release:check`.
It is useful while debugging YouTube behavior, but it requires Playwright to be
installed locally and may be affected by network/player changes.

```powershell
npm install --save-dev playwright
npx playwright install
npm run diagnostic:e2e
```

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
- Content scripts are loaded on `https://www.youtube.com/*` only for YouTube SPA route detection; page-bridge caption hooks are injected only after the user opens the panel/caption work starts on a valid watch page.
- Page-bridge work is additionally guarded inside the injected page script so snapshots, caption probes, timedtext captures, and bridge fetches stop after YouTube SPA navigation leaves a valid `/watch?v=...` route.
- No personal data collection.
- Only local settings are stored via extension storage.
- Keyboard shortcuts are not global in the release UI; they activate when the pointer is over the panel and are ignored while typing.
- If transcript/subtitles are unavailable, the extension shows a clear in-panel message and exits safely.
- Subtitle/caption data is processed locally for the current video only. The extension is a local accessibility/navigation aid and does not bulk download, export, or transmit captions to the developer or third parties.
- Privacy details are in `PRIVACY.md`.
- License terms are in `LICENSE`.
- Firefox manifest includes `browser_specific_settings.gecko.data_collection_permissions.required=["none"]`.
- Firefox minimum version is 142+ because the manifest data-collection declaration needs newer Firefox validation support.
- v1 targets desktop Chrome and desktop Firefox only. Do not select Firefox for Android in AMO unless it is tested separately.

## License

Dialogue Captions is source-available proprietary software. The public repo may
be cloned, reviewed, built, and loaded locally for personal non-commercial
testing only. Reuse, redistribution, sublicensing, commercial cloning, and
publishing modified builds are not allowed. See `LICENSE`.
