# YTMMOCC Release Automation

This project uses GitHub Actions to build, validate, package, attach release
artifacts, and optionally publish YTMMOCC to browser stores.

Normal pushes and pull requests run test/package sanity checks only. Pushing a
tag that matches `v*` builds release artifacts and creates or updates the GitHub
Release. Store publishing is a separate manual workflow dispatch against an
existing release tag and is gated by the protected GitHub Environment named
`store-publish`.

If store credentials are not configured yet, the release workflow still builds,
validates, packages, and attaches GitHub Release artifacts. A manually selected
store publish reports which Chrome or Firefox secrets are missing and skips that
store instead of failing before the other store can be tested.

## Version Bump

Version changes are explicit. Builds must not mutate version files.

1. Edit all of these files to the same version:
   - `package.json`
   - `manifest.json`
   - `manifest.chrome.json`
   - `manifest.firefox.json`
2. Run:

   ```powershell
   npm run release:sanity
   ```

3. Commit and push the version bump.

The release workflow refuses to run if the tag version does not match all four
version files.

## Create a Release Tag

Use a `vX.Y.Z` tag that matches the committed version exactly.

```powershell
git tag v1.1.0
git push origin v1.1.0
```

You can also create the tag from the GitHub website. The tag must point at the
commit with matching version files.

## What the Tag Workflow Does

The tag workflow:

1. verifies the tag version matches `package.json` and all browser manifests;
2. runs `npm run release:sanity`;
3. packages:
   - Chrome ZIP;
   - Firefox XPI;
   - source ZIP for AMO/source review;
4. uploads the artifacts to the GitHub Release.

## Publish To Stores

Use the GitHub Actions `Release` workflow manually after a release tag exists.

1. Open GitHub Actions.
2. Select the `Release` workflow.
3. Choose `Run workflow`.
4. Enter the release tag, for example:

   ```text
   v1.1.4
   ```

5. Choose the per-store actions:

   ```text
   chrome_action: skip | upload | publish
   firefox_action: skip | publish
   ```

6. Approve the `store-publish` environment when GitHub asks.

Chrome supports `upload` as a safe first step: it uploads the package to the
Chrome Web Store item without submitting it for review. Chrome `publish` uploads
the package, waits for Chrome's upload processing to finish, then submits the
item for review.

Firefox AMO does not have the same safe upload-only path through `web-ext`.
Firefox `publish` runs `web-ext sign --channel=listed` and submits the version to
AMO. The workflow uploads the source ZIP along with the AMO submission.

## GitHub Environment

Create a GitHub Environment named:

```text
store-publish
```

Recommended protection:

- require manual approval;
- restrict approval to you;
- keep all store credentials in repository or environment secrets.

Useful GitHub setup links:

- Repository secrets: `https://github.com/wirsingj/ytmmocaptions/settings/secrets/actions`
- Repository environments: `https://github.com/wirsingj/ytmmocaptions/settings/environments`

## Store Publish Mode

Store publish mode is selected through manual workflow inputs rather than a
repository-wide variable. Start with Chrome `upload` and Firefox `skip` while you
confirm credentials. Switch Chrome to `publish` and Firefox to `publish` only
after you are comfortable with the manual approval flow.

## Required Secrets

Chrome Web Store:

```text
CHROME_PUBLISHER_ID
CHROME_EXTENSION_ID
CHROME_CLIENT_ID
CHROME_CLIENT_SECRET
CHROME_REFRESH_TOKEN
```

Where to get them:

- `CHROME_EXTENSION_ID`: Chrome Web Store Developer Dashboard item ID. For the
  current YTMMOCC listing this is `cocgdaogbkknnhdpmojlmodalmblndgf`.
- `CHROME_PUBLISHER_ID`: Chrome Web Store Developer Dashboard publisher/account
  identifier.
- `CHROME_CLIENT_ID` and `CHROME_CLIENT_SECRET`: Google Cloud Console OAuth
  desktop client for a project with the Chrome Web Store API enabled.
- `CHROME_REFRESH_TOKEN`: OAuth 2.0 Playground token created with your OAuth
  client and the `https://www.googleapis.com/auth/chromewebstore` scope.

Useful Chrome setup links:

- Chrome Web Store Developer Dashboard: `https://chrome.google.com/webstore/devconsole`
- Google Cloud APIs: `https://console.cloud.google.com/apis/library`
- Google Cloud OAuth credentials: `https://console.cloud.google.com/apis/credentials`
- OAuth 2.0 Playground: `https://developers.google.com/oauthplayground`
- Chrome Web Store API docs: `https://developer.chrome.com/docs/webstore/api/reference/rest`

Firefox AMO:

```text
AMO_JWT_ISSUER
AMO_JWT_SECRET
```

No optional Firefox secret is normally needed. The stable Firefox extension ID is
stored in `manifest.firefox.json`, which is the path required by current
`web-ext` for listed updates.

Where to get them:

- `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`: AMO Developer Hub API credentials.
- Firefox extension ID: the stable ID in `manifest.firefox.json`, currently
  `dialogue-captions@wirsingj.github.io`.

Useful Firefox setup links:

- AMO Developer Hub: `https://addons.mozilla.org/en-US/developers/`
- AMO API keys: `https://addons.mozilla.org/en-US/developers/addon/api/key/`
- `web-ext sign` docs: `https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign`

## Local Release Sanity Check

Run this before tagging:

```powershell
npm run release:sanity
```

It runs the full test/release check, packages Chrome and Firefox, packages the
source ZIP, and verifies generated archives contain only store-safe files.

## Recovery If One Store Succeeds And The Other Fails

If Chrome succeeds and Firefox fails:

1. do not retag unless code or version files changed;
2. fix the Firefox-specific problem or credential issue;
3. rerun the failed GitHub Actions job after approval;
4. if the package was already published to Chrome and a code change is needed,
   bump to a new patch version before submitting again.

If Firefox succeeds and Chrome fails:

1. fix the Chrome credential/API/store issue;
2. rerun the failed GitHub Actions job after approval;
3. if a code/package change is required, bump to a new patch version before
   submitting again.

If a bad version reaches a store:

1. prepare a patch release immediately;
2. bump all version files;
3. tag the new version;
4. publish the patch through the same workflow.

## References

- Chrome Web Store API: `https://developer.chrome.com/docs/webstore/using-api`
- Mozilla web-ext signing: `https://extensionworkshop.com/documentation/develop/web-ext-command-reference/`
- AMO source submission: `https://extensionworkshop.com/documentation/publish/source-code-submission/`
