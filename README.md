# Dialogue Captions

Dialogue Captions is a Chrome/Firefox extension that turns YouTube subtitles into an MMO-style dialogue panel.

## Downloads

Latest packaged builds are checked into `downloads/`:
- `downloads/ytmmocaptions-chrome-v<version>.zip`
- `downloads/ytmmocaptions-firefox-v<version>.xpi`
- `downloads/dialogue-captions-friend-v0.25.61.zip` is an older convenience bundle with helper `.bat` files for friend testing. Prefer the latest browser-specific files above for normal testing.

## Core UX

- Bottom-left floating chat panel with scroll history.
- Subtitle cues grouped into readable chunks.
- `Space` goes to next chunk.
- `Shift+Space` goes to previous chunk.
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
    feature-flags.js
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
2. Use Firefox version 140 or newer.
3. Open `about:debugging#/runtime/this-firefox`.
4. Click Load Temporary Add-on.
5. Select `build/firefox/manifest.json`.

In `about:debugging`, the temporary extension location should end with `build/firefox/`. If it points at the project root, remove it and load `build/firefox/manifest.json` again.

For AMO signing/upload, use:
- `build/firefox/ytmmocaptions-firefox-v<version>.xpi`

## Store Compliance Notes

- Host permissions are kept to YouTube only. Browser host-permission paths may be ignored by Chrome/Firefox, so runtime activation is also route-gated to `/watch?v=...`.
- Content scripts are loaded on `https://www.youtube.com/*` only for YouTube SPA route detection; page-bridge caption hooks are injected only after the user opens the panel/caption work starts on a valid watch page.
- No personal data collection.
- Only local settings are stored via extension storage.
- Keyboard shortcuts are not global in the release UI; they activate when the pointer is over the panel and are ignored while typing.
- If transcript/subtitles are unavailable, the extension shows a clear in-panel message and exits safely.
- Privacy details are in `PRIVACY.md`.
- License terms are in `LICENSE`.
- Firefox manifest includes `browser_specific_settings.gecko.data_collection_permissions.required=["none"]`.
- Firefox minimum version is 140+ because that manifest declaration is only supported in newer Firefox releases.
