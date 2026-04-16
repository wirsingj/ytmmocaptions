# Dialogue Captions

Dialogue Captions is a Chrome/Firefox extension that turns YouTube subtitles into an MMO-style dialogue panel.

## Core UX

- Bottom-left floating chat panel with scroll history.
- Subtitle cues grouped into readable chunks.
- `Space` goes to next chunk.
- `Shift+Space` goes to previous chunk.
- Clicking a chunk seeks the video.
- Keyboard controls are safe by default:
  - Focus mode: active when panel is focused.
  - Global mode: user must explicitly enable it with the `Keys Global` button.

## Project Structure

```text
ytmmocaptions/
  src/
    platform.js
    settings-store.js
    feature-flags.js
    chunker.js
    transcript.js
    ui-panel.js
    content-script.js
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
2. Use Firefox version 121 or newer.
3. Open `about:debugging#/runtime/this-firefox`.
4. Click Load Temporary Add-on.
5. Select `build/firefox/manifest.json`.

For AMO signing/upload, use:
- `build/firefox/ytmmocaptions-firefox-v<version>.xpi`

## Store Compliance Notes

- Host permission scope is restricted to `https://www.youtube.com/watch*`.
- Content scripts are loaded on `https://www.youtube.com/*` only for YouTube SPA route detection, then feature logic is gated to watch pages.
- No personal data collection.
- Only local settings are stored via extension storage.
- Keyboard safety default is `Keys Focus` (not global). Users must explicitly opt in to `Keys Global`.
- If transcript/subtitles are unavailable, the extension shows a clear in-panel message and exits safely.
- Privacy details are in `PRIVACY.md`.
- License terms are in `LICENSE`.
- Firefox manifest includes `browser_specific_settings.gecko.data_collection_permissions.required=["none"]`.
