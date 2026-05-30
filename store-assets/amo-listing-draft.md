# AMO Listing Draft

## Name
YTMMOCC

## Short Summary
Local MMO-style caption panel for YouTube videos.

## Description
YTMMOCC turns YouTube captions and transcripts into a floating MMO-style dialogue log. It helps you skim, replay, and navigate spoken content with readable subtitle bubbles. Hover the panel and use Space / Shift+Space to move through dialogue, or click any bubble to seek the video. Future / Next Up previews are optional. All caption processing happens locally in your browser.

## Reviewer Notes
This extension runs only on `https://www.youtube.com/*`, and caption work is additionally gated to YouTube watch pages with a valid video id. It reads YouTube captions/transcript/timed-text state locally to render a dialogue-style overlay. It does not collect, transmit, sell, export, or store caption text, watched videos, browsing history, account data, or analytics events. It stores only local UI preferences using extension storage. No server, account, analytics, ads, tracking, payment, or remote code services are used.

## Permissions
- storage: saves local panel preferences only.
- youtube.com: reads captions/transcripts and YouTube watch-page state locally for the active video.

## Category Suggestions
Accessibility, Productivity, or Other.
