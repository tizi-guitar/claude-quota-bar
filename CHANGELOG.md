# Changelog

## 0.2.1

- New **equivalent time** next to the difference: the status bar reads
  `▼12% (+20h)`, the tooltip and the web page show it too. It is the
  difference converted to time (difference × window length): positive when
  you are below the uniform pace (time in hand), negative when above it.
- The difference now carries a `%` sign.
- Colors depend only on the distance from the uniform pace: red beyond 10
  points above it, yellow from 1 to 10, neutral otherwise. Having used a lot
  of quota no longer turns the bar red by itself, and being below the pace
  is no longer green.

## 0.2.0

- The uniform-pace marker is now a colored square (🟦 by default) instead
  of the thin `┃`: it stands out from the fill and no longer leaves dark
  gaps on either side. New `claudeQuotaBar.paceMarker` setting to pick the
  color, or go back to `┃`.
- Optional web page with the same bar, to check the quota from a phone
  (Android included) or any browser on the network: settings
  `claudeQuotaBar.webServer.*` and the "show web page URL" command.
- Data older than the last reset is no longer shown as current: the bar
  reads `reset`, the tooltip says usage since then is unknown, and the weekly
  pace carries on into the new week instead of sticking at 100%.

## 0.1.0

- First public release: status bar item showing the Claude Code weekly quota
  (and, optionally, the 5-hour one) with a theoretical uniform-pace marker
  overlaid on top.
- Reads `GET /api/oauth/usage` with Claude Code's local OAuth token, caches
  results, backs off increasingly on 429s, and falls back to
  `~/.claude.json` when the endpoint doesn't respond.
