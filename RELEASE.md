# YTMMOCC Release Automation

This project uses GitHub Actions to build, validate, package, attach release
artifacts, and optionally publish YTMMOCC to browser stores.

Normal pushes and pull requests run test/package sanity checks only. Releases
use three numbered manual workflows:

```text
1) Prepare Release
2) Release Firefox
3) Release Chrome
```

`1) Prepare Release` runs from `main`, bumps the patch version, validates and
packages the release, commits the version/source-package changes back to `main`,
creates a matching `vX.Y.Z` tag, and creates the GitHub Release artifacts.
Store publishing lives in separate manual-only workflows, one for Chrome and one
for Firefox, and is gated by the protected GitHub Environment named
`store-publish`.

If store credentials are not configured yet, the release workflow still builds,
validates, packages, and attaches GitHub Release artifacts. The publish workflows
print which required secret names are configured or missing without printing
secret values.

## Release Flow

1. Merge the release-ready work to `main`.
2. Run the `1) Prepare Release` workflow from `main`.
3. Confirm the workflow-created GitHub Release and artifacts.
4. Run `2) Release Firefox` with the new tag.
5. Run `3) Release Chrome` with the new tag.

## Prepare Release

Use this workflow to turn current `main` into the next patch release.

1. Open GitHub Actions.
2. Select `1) Prepare Release`.
3. Choose `Run workflow`.
4. Keep `Branch: main`.
5. Run the workflow.

The workflow:

1. bumps all release version files:
   - `package.json`
   - `package-lock.json`
   - `manifest.json`
   - `manifest.chrome.json`
   - `manifest.firefox.json`;
2. runs `npm run release:sanity`;
3. commits the bumped version and source package to `main`;
4. creates and pushes the matching `vX.Y.Z` tag;
5. packages:
   - Chrome ZIP;
   - Firefox XPI;
   - source ZIP for AMO/source review;
6. uploads the artifacts to the GitHub Release.

The workflow auto-increments the patch version only. For minor or major releases,
make the version change intentionally in a normal PR instead of using the
auto-bump path.

## Release To Stores

Use the manual publish workflows only after the release tag workflow succeeds and
the release checklist/manual QA is complete.

### Firefox

1. Open GitHub Actions.
2. Select `2) Release Firefox`.
3. Choose `Run workflow`.
4. Enter the release tag, for example:

   ```text
   v1.1.4
   ```

5. Approve the `store-publish` environment when GitHub asks.

Firefox AMO does not have a separate safe upload-only path through `web-ext`.
Firefox release runs `web-ext sign --channel=listed` and submits the version to
AMO. The workflow uploads the source ZIP along with the AMO submission.

### Chrome

1. Open GitHub Actions.
2. Select `3) Release Chrome`.
3. Choose `Run workflow`.
4. Enter the release tag, for example:

   ```text
   v1.1.4
   ```

5. Approve the `store-publish` environment when GitHub asks.

Chrome release uploads the package, waits for Chrome's upload processing to
finish, then submits the item for review. Chrome may still take time to approve
and publish after the workflow succeeds.

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

Store publish mode is intentionally not a repository-wide variable. Firefox and
Chrome are separate manual workflows so either store can be retried independently
without retagging.

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
  identifier. It is shown under `Publisher > Settings`; the current YTMMOCC
  publisher ID is `ad6905b1-f715-47f7-8140-25592b8fbca4`.
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
