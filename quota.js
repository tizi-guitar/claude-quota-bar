'use strict';
// Logica pura: nessun require di vscode, così è testabile con node da riga di comando.

const WEEK_MS = 7 * 24 * 3600 * 1000;
const FIVE_HOUR_MS = 5 * 3600 * 1000;
const BLOCKS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];

/** Millisecondi di durata nominale della finestra. */
function windowSpan(key) {
  return key === 'five_hour' ? FIVE_HOUR_MS : WEEK_MS;
}

/**
 * Consumo, ritmo teorico uniforme e delta di una finestra di quota.
 * `utilization` è 0-100 e `resets_at` un ISO 8601 (come li espone Claude Code).
 */
function windowStats(win, key, now = Date.now()) {
  if (!win || typeof win.utilization !== 'number') return null;
  const used = win.utilization;
  const span = windowSpan(key);
  let pace = null;
  let remainingMs = null;
  const reset = win.resets_at ? Date.parse(win.resets_at) : NaN;
  if (!Number.isNaN(reset)) {
    remainingMs = reset - now;
    pace = Math.max(0, Math.min(100, ((span - remainingMs) / span) * 100));
  }
  return {
    used,
    pace,
    remainingMs,
    delta: pace === null ? null : used - pace,
  };
}

/**
 * Barra a larghezza fissa: il riempimento è il consumo reale, il marcatore ┃
 * l'avanzamento teorico uniforme. Sovrapposti sulla stessa barra, così si legge
 * a colpo d'occhio se si sta consumando più o meno del ritmo costante.
 */
function renderBar(used, pace, width) {
  const filled = (Math.max(0, Math.min(100, used)) / 100) * width;
  const cells = [];
  for (let i = 0; i < width; i++) {
    const frac = Math.min(Math.max(filled - i, 0), 1);
    if (frac >= 1) cells.push('█');
    else if (frac <= 0) cells.push('░');
    else cells.push(BLOCKS[Math.max(0, Math.min(7, Math.floor(frac * 8) - 1))]);
  }
  if (pace !== null && pace !== undefined) {
    const pos = Math.max(0, Math.min(width - 1, Math.floor((Math.max(0, Math.min(100, pace)) / 100) * width)));
    cells[pos] = '┃';
  }
  return cells.join('');
}

/** 'sotto' | 'pari' | 'sopra' | 'critico': guida il colore dell'item. */
function severity(used, delta) {
  if (used >= 90) return 'critico';
  if (delta === null) return 'pari';
  if (delta > 15) return 'critico';
  if (delta > 5) return 'sopra';
  if (delta < -5) return 'sotto';
  return 'pari';
}

function humanDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}g${h}h`;
  if (h) return `${h}h${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

function humanAge(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return 'ora';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}g`;
}

/**
 * Testo per la status bar. `stale` allunga il testo con un ⚠ e l'età del dato,
 * perché una percentuale vecchia letta come attuale è peggio di nessun dato.
 */
function statusText(stats, { label = '7g', width = 12, staleMs = null } = {}) {
  const bar = renderBar(stats.used, stats.pace, width);
  let text = `${label} ${bar} ${Math.round(stats.used)}%`;
  if (stats.delta !== null) {
    const sign = stats.delta < -0.5 ? '▼' : stats.delta > 0.5 ? '▲' : '=';
    text += ` ${sign}${Math.round(Math.abs(stats.delta))}`;
  }
  if (staleMs !== null) text += ` ⚠${humanAge(staleMs)}`;
  return text;
}

module.exports = {
  WEEK_MS, FIVE_HOUR_MS,
  windowSpan, windowStats, renderBar, severity, humanDuration, humanAge, statusText,
};
