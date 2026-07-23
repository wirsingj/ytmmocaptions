# 1.1.6 Release-Version Checklist

Use this when 1.1.6 work is ready to become a release candidate. Do not run the version bump just because this checklist exists.

## Scope

- Branch: `1.1.6-work`.
- Current source version before release prep: `1.1.5`.
- Release target: `v1.1.6`.
- Runtime scope remains YouTube-only.
- Generic captions stay source-only and are not promoted into release manifests for 1.1.6.

## Before Version Bump

- Confirm all intended 1.1.6 source changes are merged into `1.1.6-work`.
- Run `npm test`.
- Run or manually complete the Minimal Release Smoke in `QA_CHECKLIST.md`.
- Confirm `manifest*.json` content scripts remain YouTube-only.
- Confirm `src/universal-captions.js` remains absent from release manifests.
- Confirm no raw transcript text, video ids, or diagnostics are newly persisted.

## Prepare Release PR

- Merge the release-ready branch to protected `main`.
- Run GitHub Actions workflow `1) Prepare Release` from `main`.
- Confirm the generated release branch is `release/v1.1.6`.
- Confirm the generated PR updates:
  - `package.json`
  - `package-lock.json`
  - `manifest.json`
  - `manifest.chrome.json`
  - `manifest.firefox.json`
- Confirm the workflow runs `npm run release:sanity`.

## Verify Artifacts

- Chrome ZIP name should include `v1.1.6`.
- Firefox XPI name should include `v1.1.6`.
- Source ZIP name should include `v1.1.6`.
- Run or inspect:

```powershell
node scripts/verify-release-version.mjs v1.1.6
powershell -ExecutionPolicy Bypass -File scripts/verify-release-artifacts.ps1
```

## Tag And Store Release

- Merge the generated release PR.
- Create and publish GitHub Release `v1.1.6` from the merged `main` commit.
- Let `2) Release Firefox` and `3) Release Chrome` derive the tag from the published release event.
- Approve the `store-publish` environment for each store when ready.
- If one store fails after the other succeeds, retry the failed store workflow for the same tag unless package contents changed.
