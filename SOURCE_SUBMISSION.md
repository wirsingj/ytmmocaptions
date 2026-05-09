# Dialogue Captions v1.0.1 Source Submission

This source package reproduces the Firefox extension package submitted to AMO.

## Build Environment

- Windows 10/11
- PowerShell 5+ or PowerShell 7+
- Node.js 18+ recommended
- npm included with Node.js

No runtime npm dependencies are required. The release lint command uses `npx --yes web-ext` to download Mozilla's `web-ext` tool on demand.

## Reproduce the Firefox XPI

From the source package root:

```powershell
npm run build
npm run package:firefox
```

The generated package will be:

```text
build/firefox/ytmmocaptions-firefox-v1.0.1.xpi
```

## Full Release Verification

```powershell
npm run release:check
```

This runs:

```text
npm run build
npm run test
npm run package:firefox
npm run package:chrome
npm run lint:firefox
```

## Build Notes

- Source JavaScript lives in `src/`.
- The build script copies source files into `build/firefox/scripts/` without minifying, bundling, transpiling, obfuscating, or concatenating code.
- CSS is copied from `styles/` without preprocessing.
- Icons are committed source assets in `assets/icons/` and copied into the build.
- `manifest.firefox.json` is copied to `build/firefox/manifest.json`.
- Store listing helper files in `store-assets/` are not included in the extension package.

## Privacy / Network Behavior

Dialogue Captions is local-only. It has no server, account system, analytics, ad network, or tracking. Caption data is processed locally for the active YouTube watch page and is not transmitted to the developer.

