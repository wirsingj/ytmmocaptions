# YTMMOCC Privacy Policy

Effective date: April 16, 2026

YTMMOCC is a browser extension for turning YouTube captions and transcripts into an MMO-style dialogue panel. This release is YouTube-only and runs locally in the browser.

## Data Collection

YTMMOCC does not collect, store, sell, or transmit personal data to the developer or third parties.

The extension does not:
- create user accounts;
- collect names, emails, phone numbers, addresses, payment data, or identifiers;
- send analytics, telemetry, or ad-tracking events;
- load advertisements or connect to an ad network.

## Local Data Stored

The extension stores only local preference settings in extension storage:
- preference schema version for safe future migrations;
- panel theme preset and custom theme color;
- panel opacity/transparency;
- Fade setting, which makes the panel more transparent toward the center of the associated video;
- panel open/closed state;
- Layout Lock preference.

When Layout Lock is enabled, the extension also stores the user's local panel layout preferences:
- text size;
- panel position and size;
- next-up preview height;
- whether Future / Next Up previews are enabled;
- whether Case Fix is enabled for all-caps captions.
- launcher/pill position.

When Layout Lock is off, layout preferences reset for each YouTube video/session. Timeline scrub mode remains hidden and off by default in this release.

These settings remain on the user's browser profile unless removed by uninstalling the extension or clearing extension storage.

The extension does not store transcript text, chat bubble history, the active bubble, playback position, or per-video viewing history.

## Permissions Used

- `storage`
  Used to save the local settings listed above.

- YouTube host access
  Used only on YouTube so the extension can detect watch-page navigation and read caption/transcript/timed-text data for the current video.

The extension's content script is injected only on `https://www.youtube.com/*` so it can observe YouTube single-page navigation. Caption fetching and page-bridge work remains gated to YouTube watch pages (`/watch`) with a valid video id. Chrome and Firefox may ignore path portions of host-permission patterns, so the extension also checks the route before starting caption work.

No additional host permissions are requested.

## Network Access

The extension reads YouTube subtitle/caption/transcript data and limited YouTube page configuration required for on-page functionality. Caption text and page configuration are processed locally in the browser for the current video and are not transmitted to the developer.

YTMMOCC is intended as a local accessibility/navigation aid. It does not bulk download, export, sell, analyze, or transmit YouTube captions to the developer or third parties.

If subtitles or transcript data are unavailable, the extension fails gracefully and shows an in-panel status message. No fallback data is uploaded or collected.

## Keyboard Behavior Safety

Keyboard controls are not globally enabled in the release UI.

- Default mode: shortcuts work only when the pointer is over the extension panel.
- Shortcuts are ignored while typing in inputs, textareas, selects, or editable fields.

## Third-Party Services

YTMMOCC does not integrate with third-party analytics, advertising, ad network, account, payment, or remote code services.

## Local Diagnostics

If a user or developer adds `dcdebug=1` to a YouTube watch URL, the extension
prints concise local diagnostics to the browser console and keeps a small
in-memory event report for that page. Diagnostics are for troubleshooting only,
are not sent anywhere, are cleared when the page reloads, and avoid raw
captions, video titles, account data, cookies, tokens, and personal identifiers.

## Contact

For privacy questions, use the support contact listed in the extension store listing.
