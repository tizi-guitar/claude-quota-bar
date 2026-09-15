# Changelog

## 0.1.0

- Prima versione pubblica: barra di stato con quota settimanale (e, a scelta,
  quella di 5 ore) di Claude Code, con marcatore del ritmo di consumo teorico
  uniforme sovrapposto.
- Lettura di `GET /api/oauth/usage` con il token OAuth locale di Claude Code,
  cache e backoff crescente sui 429, fallback su `~/.claude.json` quando
  l'endpoint non risponde.
