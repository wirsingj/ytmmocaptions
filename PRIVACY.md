# Dialogue Captions Privacy Policy

Effective date: April 16, 2026

Dialogue Captions is a browser extension for YouTube subtitle navigation.

## Data Collection

Dialogue Captions does not collect, store, sell, or transmit personal data to the developer or third parties.

The extension does not:
- create user accounts;
- collect names, emails, phone numbers, addresses, payment data, or identifiers;
- send analytics, telemetry, or ad-tracking events.

## Local Data Stored

The extension stores only local preference settings in extension storage:
- chunk size (`short`, `medium`, `long`);
- auto-scroll enabled/disabled;
- panel collapsed/expanded state;
- keyboard mode (`focus-only` or `global`).

These settings remain on the user's browser profile unless removed by uninstalling the extension or clearing extension storage.

## Permissions Used

- `https://www.youtube.com/watch*`
  Used only to run the content script on YouTube watch pages where subtitle navigation is needed.

The extension's content script is injected on `https://www.youtube.com/*` only to detect YouTube SPA route changes.
Feature logic remains gated to watch pages (`/watch`) and the panel does not activate on other page types.

No additional host permissions are requested.

## Network Access

The extension reads YouTube subtitle data required for on-page functionality. It does not send data to external servers controlled by the developer.

If subtitles or transcript data are unavailable, the extension fails gracefully and shows an in-panel status message. No fallback data is uploaded or collected.

## Keyboard Behavior Safety

Keyboard controls are not globally enabled by default.

- Default mode: `Keys Focus` (shortcuts work only when the extension panel is focused).
- Optional mode: `Keys Global` (user must explicitly enable it in-panel).
- Shortcuts are ignored while typing in inputs, textareas, selects, or editable fields.

## Third-Party Services

Dialogue Captions does not integrate with third-party analytics, advertising, or remote code services.

## Contact

For privacy questions, use the support contact listed in the extension store listing.
