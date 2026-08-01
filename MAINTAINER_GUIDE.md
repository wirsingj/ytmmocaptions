---
yaiml: 0.2
role: maintainer
title: YTMMOCC Maintainer Guide
purpose: Current setup, commands, diagnostics, release flow, and recovery procedure for maintaining the extension.
belongs-here: verified commands, local setup, tests, packaging, release operations, important files, danger zones, debugging paths.
not-here: product intent, durable architecture, complete history, marketplace copy.
durability: current-only; remove dead commands and obsolete procedures quickly.
read-with: State of the Union; YTMMOCC Architecture Notes; YAIML Usage.
update-when: commands, setup, diagnostics, release flow, CI, packaging, or recovery procedures change.
agent-guidance: Verify command claims when practical. Mark environment-dependent steps. Surface conflicts between docs, scripts, and observed behavior.
---

# YTMMOCC Maintainer Guide

## Quick Start

This is a Node/PowerShell WebExtension project for desktop Chrome and Firefox. Runtime code lives in content scripts; there is no background worker or local dev server for normal extension work.

From a fresh checkout:

```powershell
npm install
npm test
```

## Verified Commands

Run the full local test suite:

```powershell
npm test
```

Build Chrome and Firefox extension directories:

```powershell
npm run build
```

Build and package Firefox:

```powershell
npm run build:firefox:xpi
```

Build and package Chrome:

```powershell
npm run build:chrome:zip
```

Run the release sanity path used by CI:

```powershell
npm run release:sanity
```

Intentionally bump patch version files:

```powershell
npm run version:bump
```

## Focused Checks

Useful narrow checks while editing:

```powershell
node tests/run-tests.js
node scripts/verify-release-version.mjs v1.1.6
powershell -ExecutionPolicy Bypass -File scripts/verify-release-artifacts.ps1
```

Optional browser diagnostics:

```powershell
npm run diagnostic:e2e
npm run diagnostic:e2e -- --browser=chrome --headed --url=https://www.youtube.com/watch?v=VIDEO_ID --expect-latin-captions
```

The diagnostic flow is explicit/local and is not the normal release gate. It is best at catching activation, anchoring, launcher placement, keyboard ownership, console, and obvious caption-source regressions. Headless/shared-source runs can fail to prove caption bubbles when YouTube serves HTML/empty timedtext responses or blocks playback; use headed Chrome unpacked-extension smoke when real caption acquisition is the question.

Ignored local browser artifacts live under `tests/artifacts/`. They can become large during diagnostics and are intentionally not tracked. When doing broad source audits on a machine with diagnostic output, prefer:

```powershell
rg --glob '!tests/artifacts/**' "search text"
```

## Important Files

- `manifest.json`, `manifest.chrome.json`, `manifest.firefox.json`: release runtime surface and permissions.
- `src/content-script.js`: YouTube app controller, route/session state, live fallback, panel/video coordination.
- `src/caption-acquisition.js`, `src/native-captions.js`: transcript load/upgrade mechanics and native YouTube CC ensure/restore ownership.
- `src/ui-panel.js`: panel UI, workspace controls, future previews, timeline scrub UI, animated themes.
- `src/bubble-state.js`: bubble records, trimming, reading glow, token-to-word timing behavior.
- `src/transcript.js`, `src/caption-timeline.js`, `src/page-bridge.js`, `src/page-context.js`: transcript source acquisition, source metadata, normalization, and constrained page-world bridge.
- `src/settings-store.js`: local extension-storage preferences and workspace presets.
- `scripts/build.mjs`, `scripts/package-*.ps1`, `scripts/publish-*.mjs`: packaging and release mechanics.
- `.github/workflows/`: CI, release preparation, and store publishing.
- `STATE_OF_THE_UNION.md`, `ARCHITECTURE.md`, `MAINTAINER_GUIDE.md`, `docs/YAIML.md`: YAIML project memory.

## Danger Zones

- Release manifests: broad host permissions or extra runtime files can break marketplace posture.
- Page bridge and transcript fetching: preserve YouTube host/path constraints and token checks.
- `content-script.js`: many runtime states meet here; route changes, live capture, transcript upgrade, and seek focus can interact.
- `ui-panel.js`: compact UI controls, persistence, and panel geometry share state.
- Packaging scripts: archive paths must stay store-safe and deterministic.
- `downloads/` and `build/`: generated release artifacts can be large; avoid unrelated churn.

## Release Flow

Current intended flow:

1. Merge release-ready work to protected `main`.
2. Run `1) Prepare Release` from GitHub Actions.
3. The workflow bumps the patch version, runs `npm run release:sanity`, pushes `release/vX.Y.Z`, and opens a PR.
4. Review and merge the generated release prep PR.
5. Create and publish the GitHub Release tag from the merged `main` commit.
6. The Firefox and Chrome release workflows derive the tag from the published release event and wait on the `store-publish` environment.

Manual workflow dispatch with a release tag remains available for retrying one store.

Before publishing the tag, do at least a minimal browser smoke: load the built extension, open one captioned YouTube URL, confirm the panel/bubbles appear, navigate to a second captioned URL, and confirm stale text does not carry over. Full Playwright diagnostics can remain optional until flake characteristics are better understood.

## Recovery Notes

If Firefox succeeds and Chrome fails, do not retag unless code or package contents changed. Fix the Chrome credential/API/store issue and rerun the Chrome workflow for the existing tag.

If Chrome succeeds and Firefox fails, do not retag unless code or package contents changed. Fix the AMO credential/source-package issue and rerun the Firefox workflow for the existing tag.

If a code/package change is needed after one store already received a version, prepare a new patch release.

## YAIML Maintenance

When it will help the next substantial session:

- Update `STATE_OF_THE_UNION.md` when current state, active risks, recent lessons, or priorities change.
- Update `ARCHITECTURE.md` when module boundaries, data flow, invariants, or intended design changes.
- Update this guide when commands, release steps, diagnostics, or recovery procedures change.
- Update specialized supporting docs only when their domain changes.

Prefer pruning stale statements over appending a new paragraph that leaves old claims intact.

Phrases such as "update YAIML", "updated YAIML", "check new YAIML", or "run a YAIML update" mean a YAIML convention refresh, not a project-memory rewrite. Compare this repository's local YAIML scaffolding against a human-provided, workspace-provided, or team-approved YAIML reference, refresh only compatible prompts, templates, guidance, discovery hints, or agent-instruction pointers, and preserve project-specific SoT, Architecture, Maintainer Guide, risks, commands, and supporting memory.

If no YAIML reference path or URL is provided by the human, workspace, or team-approved process, ask for one instead of guessing.
