# Dialogue Captions Privacy Policy

Effective date: April 16, 2026

Dialogue Captions is a browser extension for YouTube subtitle navigation.

## Data Collection

Dialogue Captions does not collect, store, sell, or transmit personal data to the developer or third parties.

The extension does not:
- create user accounts;
- collect names, emails, phone numbers, addresses, payment data, or identifiers;
- send analytics, telemetry, or ad-tracking events;
- load advertisements or connect to an ad network.

## Local Data Stored

The extension stores only local preference settings in extension storage:
- preference schema version for safe future migrations;
- panel background blend/transparency;
- text size;
- panel theme preset and custom theme color;
- panel position and size;
- launcher/pill position;
- panel open/closed state.

These settings remain on the user's browser profile unless removed by uninstalling the extension or clearing extension storage.

The extension does not store transcript text, chat bubble history, the active bubble, playback position, or per-video viewing history.

## Permissions Used

- `storage`
  Used to save the local settings listed above.

- YouTube host access
  Used only on YouTube pages so the extension can detect watch-page navigation and read captions for the current video.

The extension's content script is injected on `https://www.youtube.com/*` only to detect YouTube SPA route changes.
Runtime logic remains gated to watch pages (`/watch`) and the panel does not activate on other page types.
Chrome and Firefox may ignore path portions of host-permission patterns, so the extension also checks the route before starting caption work.

No additional host permissions are requested.

## Network Access

The extension reads YouTube subtitle/caption data and limited YouTube page configuration required for on-page functionality. Subtitle/caption text and page configuration are processed locally in the browser for the current video and are not transmitted to the developer.

Dialogue Captions is intended as a local accessibility/navigation aid. It does not bulk download, export, sell, analyze, or transmit YouTube captions to the developer or third parties.

If subtitles or transcript data are unavailable, the extension fails gracefully and shows an in-panel status message. No fallback data is uploaded or collected.

## Keyboard Behavior Safety

Keyboard controls are not globally enabled in the release UI.

- Default mode: shortcuts work only when the pointer is over the extension panel.
- Shortcuts are ignored while typing in inputs, textareas, selects, or editable fields.

## Third-Party Services

Dialogue Captions does not integrate with third-party analytics, advertising, ad network, account, payment, or remote code services.

## Local Diagnostics

If a user or developer adds `dcdebug=1` to a YouTube watch URL, the extension
prints concise local diagnostics to the browser console and keeps a small
in-memory event report for that page. Diagnostics are for troubleshooting only,
are not sent anywhere, are cleared when the page reloads, and avoid raw
captions, video titles, account data, cookies, tokens, and personal identifiers.

## Contact

For privacy questions, use the support contact listed in the extension store listing.
