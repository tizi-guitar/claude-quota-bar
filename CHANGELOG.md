# Changelog

## 0.2.0

- The uniform-pace marker is now a colored square (🟦 by default) instead
  of the thin `┃`: it stands out from the fill and no longer leaves dark
  gaps on either side. New `claudeQuotaBar.paceMarker` setting to pick the
  color, or go back to `┃`.
- Optional web page with the same bar, to check the quota from a phone
  (Android included) or any browser on the network: settings
  `claudeQuotaBar.webServer.*` and the "show web page URL" command.

## 0.1.0

- First public release: status bar item showing the Claude Code weekly quota
  (and, optionally, the 5-hour one) with a theoretical uniform-pace marker
  overlaid on top.
- Reads `GET /api/oauth/usage` with Claude Code's local OAuth token, caches
  results, backs off increasingly on 429s, and falls back to
  `~/.claude.json` when the endpoint doesn't respond.
