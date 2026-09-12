# Claude Quota Bar

Barra di stato per VS Code che mostra quanto della **quota settimanale di Claude
Code** è stato consumato, con l'**avanzamento teorico uniforme** sovrapposto
sulla stessa barra.

    7g ████▍┃░░░░░░ 37% ▼12

- il riempimento `█` è il consumo reale della finestra di 7 giorni;
- il marcatore `┃` è dove sarebbe il consumo se fosse perfettamente uniforme
  nel tempo, cioè la frazione di settimana già trascorsa;
- `▼12` / `▲12` è la differenza in punti percentuali: sotto o sopra quel ritmo.

Se il riempimento sta a sinistra del marcatore c'è margine, se lo supera si sta
consumando più in fretta di quanto la settimana permetta.

## Perché esiste

Claude Code espone `rate_limits` agli script di status line, ma quelle status
line sono una funzione del TUI nel terminale: l'estensione VS Code non le
renderizza. Questa estensione porta la stessa informazione nella barra di stato
dell'editor, aggiungendo il confronto con il ritmo uniforme che la status line
nativa non fa.

## Da dove vengono i dati

`GET https://api.anthropic.com/api/oauth/usage`, lo stesso endpoint che alimenta
`/usage`, autenticato con il token OAuth che Claude Code tiene in
`~/.claude/.credentials.json`. Il token viene riletto dal disco a ogni
tentativo e non viene mai rinnovato da qui: il refresh resta compito di Claude
Code, così non si interferisce con la sua sessione.

L'endpoint ha un cooldown per account, condiviso con Claude Code e con ogni
altra estensione che lo interroga: un 429 non è un errore ma un "riprova più
tardi". In quel caso la barra continua a mostrare l'ultimo dato noto e, se è
vecchio, lo segnala con `⚠` e l'età. All'avvio, prima del primo fetch, si parte
dalla cache che Claude Code tiene in `~/.claude.json`
(`cachedUsageUtilization`).

Il ritmo teorico invece non dipende dalla rete: si ricava da `resets_at` meno
sette giorni e si aggiorna ogni 30 secondi.

## Impostazioni

| chiave | default | cosa fa |
|---|---|---|
| `claudeQuotaBar.pollMinutes` | 5 | minuti fra due fetch (con backoff fino a 10 min dopo un 429) |
| `claudeQuotaBar.barWidth` | 12 | larghezza della barra in caratteri |
| `claudeQuotaBar.showFiveHour` | false | mostra anche la finestra di 5 ore |
| `claudeQuotaBar.alignment` | right | lato della barra di stato |
| `claudeQuotaBar.priority` | 100 | posizione nel gruppo |

Clic sulla barra: aggiorna subito. Il tooltip riporta consumo, ritmo, delta,
reset, età del dato e finestra di 5 ore. Il colore di sfondo diventa giallo
oltre +5 punti di scostamento e rosso oltre +15 o sopra il 90% di quota.

## File

    extension.js   attivazione, fetch, cache, rendering nella barra di stato
    quota.js       logica pura (ritmo, barra, soglie), testabile con node
