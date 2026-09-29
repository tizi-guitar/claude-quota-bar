# Claude Quota Bar

VS Code status bar item that shows how much of your **Claude Code weekly
quota** has been used, with the **theoretical uniform pace** overlaid on the
same bar.

    7d ████▍🟦░░░░░░ 37% ▼12

- the fill `█` is the real usage of the 7-day window;
- the 🟦 marker is where usage would be if it were perfectly uniform over
  time, i.e. the fraction of the week already elapsed. It's a color emoji
  so it stands out from the fill whatever the theme: a status bar item has
  a single text color, and the thin `┃` used before left dark gaps on both
  sides of the line;
- `▼12` / `▲12` is the difference in percentage points: below or above that
  pace.

If the fill sits to the left of the marker, you have margin; if it passes it,
you're burning through the week faster than it allows.

Other Claude Code quota extensions show the percentage used and a countdown
to reset, but none of them compare usage against a uniform pace: this bar
tells you "you're on track" or "you're burning fast", not just "you're at
40%".

## Why it exists

Claude Code exposes `rate_limits` to status line scripts, but those status
lines are a terminal TUI feature — the VS Code extension doesn't render
them. This extension brings the same information into the editor's status
bar, adding the uniform-pace comparison that the native status line doesn't
do.

## Where the data comes from

`GET https://api.anthropic.com/api/oauth/usage`, the same endpoint that
powers `/usage`, authenticated with the OAuth token Claude Code keeps in
`~/.claude/.credentials.json`. The token is re-read from disk on every
attempt and never refreshed from here: refreshing stays Claude Code's job, so
this extension doesn't interfere with its session.

The endpoint has a per-account cooldown, shared with Claude Code and with any
other extension that queries it: a 429 isn't an error, it's a "try again
later". When that happens, the bar keeps showing the last known value and, if
it's old, flags it with `⚠` and its age. On startup, before the first fetch,
it starts from the cache Claude Code itself keeps in `~/.claude.json`
(`cachedUsageUtilization`).

The theoretical pace, on the other hand, doesn't depend on the network: it's
derived from `resets_at` minus seven days, and refreshes every 30 seconds.

## Settings

| key | default | what it does |
|---|---|---|
| `claudeQuotaBar.pollMinutes` | 5 | minutes between fetches (backs off up to 10 min after a 429) |
| `claudeQuotaBar.barWidth` | 12 | bar width in characters |
| `claudeQuotaBar.showFiveHour` | false | also show the 5-hour window |
| `claudeQuotaBar.paceMarker` | 🟦 | pace marker: a colored square, or `┃` for the original thin line |
| `claudeQuotaBar.alignment` | right | which side of the status bar |
| `claudeQuotaBar.priority` | 100 | position within the group |
| `claudeQuotaBar.webServer.enabled` | false | serve the web page described below |
| `claudeQuotaBar.webServer.host` | 0.0.0.0 | address it listens on (`127.0.0.1` for this machine only) |
| `claudeQuotaBar.webServer.port` | 8787 | port it listens on |

Click the bar to refresh immediately. The tooltip reports usage, pace, delta,
reset time, data age, and the 5-hour window. The background color turns
yellow past +5 percentage points off pace, and red past +15 or above 90% of
quota.

## Web page (phone, other devices)

Turn on `claudeQuotaBar.webServer.enabled`, or run **Claude Quota: show web
page URL** from the command palette, which offers to turn it on and shows
the address to open, e.g. `http://192.168.1.20:8787/`. Open it in the
phone's browser (Android included) while it's on the same network, or
through a VPN such as Tailscale; "Add to home screen" makes it one tap away.

The page shows the same bar with real colors: the fill is real usage, and
the uniform pace is a solid line in the `paceMarker` color. It also shows
the percentages, the delta, the reset countdown and the 5-hour window, and
refreshes every 30 seconds.

It reuses the data the extension has already fetched, so it doesn't add any
requests to the rate-limited endpoint, and it exposes only quota
percentages, never the token. It's plain HTTP with no login, though: anyone
who can reach the port can see those percentages. Set the host to
`127.0.0.1` if the network isn't yours and you'd rather reach it through a
tunnel. With several VS Code windows open, one of them serves the page, and
another takes over when it's closed. `GET /api/quota` returns the same data
as JSON.

## Files

    extension.js   activation, fetch, cache, status bar rendering
    quota.js       pure logic (pace, bar, thresholds), testable with node
    web.js         HTTP server and page for viewing the bar from other devices
