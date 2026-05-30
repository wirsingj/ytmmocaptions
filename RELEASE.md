# YTMMOCC Release Automation

This project uses GitHub Actions to build, validate, package, attach release
artifacts, and optionally publish YTMMOCC to browser stores.

Normal pushes and pull requests run test/package sanity checks only. Store
publishing runs only from tags that match `v*` and is gated by the protected
GitHub Environment named `store-publish`.

If store credentials are not configured yet, the release workflow still builds,
validates, packages, and attaches GitHub Release artifacts. The store job reports
which Chrome or Firefox secrets are missing and skips that store instead of
failing before the other store can be tested.

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
4. uploads the artifacts to the GitHub Release;
5. waits for approval on the `store-publish` environment before store work;
6. uploads or publishes to Chrome Web Store and Firefox AMO depending on
   `STORE_PUBLISH_MODE`.

## GitHub Environment

Create a GitHub Environment named:

```text
store-publish
```

Recommended protection:

- require manual approval;
- restrict approval to you;
- keep all store credentials in repository or environment secrets.

## Store Publish Mode

Set a GitHub Actions repository or environment variable:

```text
STORE_PUBLISH_MODE
```

Supported values:

- `upload` - safer default. Chrome uploads the ZIP but does not call publish.
  Firefox does not submit to AMO; it runs AMO-safe lint only because AMO's
  `web-ext sign` path is effectively a real listed submission.
- `publish` - after the `store-publish` environment approval, Chrome uploads
  and publishes, and Firefox submits through `web-ext sign --channel=listed`.

Start with `upload`. Switch to `publish` only after you are comfortable with the
store credentials and manual approval flow.

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

Firefox AMO:

```text
AMO_JWT_ISSUER
AMO_JWT_SECRET
```

Optional Firefox secret:

```text
FIREFOX_EXTENSION_ID
```

`FIREFOX_EXTENSION_ID` is only needed if AMO/web-ext cannot infer the extension
ID from `manifest.firefox.json`.

Where to get them:

- `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`: AMO Developer Hub API credentials.
- `FIREFOX_EXTENSION_ID`: the stable ID in `manifest.firefox.json`, currently
  `dialogue-captions@wirsingj.github.io`.

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
