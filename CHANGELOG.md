# Changelog

## 0.1.0

- First public release: status bar item showing the Claude Code weekly quota
  (and, optionally, the 5-hour one) with a theoretical uniform-pace marker
  overlaid on top.
- Reads `GET /api/oauth/usage` with Claude Code's local OAuth token, caches
  results, backs off increasingly on 429s, and falls back to
  `~/.claude.json` when the endpoint doesn't respond.
