'use strict';
// Pure logic: no vscode require, so it's testable with plain node.

const WEEK_MS = 7 * 24 * 3600 * 1000;
const FIVE_HOUR_MS = 5 * 3600 * 1000;
const BLOCKS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
// A status bar item has a single text color, so the only way to give the pace
// marker its own color is a color emoji. A full square also fills its whole
// cell, unlike the thin `┃`, which left dark gaps on both sides of the line.
const DEFAULT_MARKER = '🟦';

/** Nominal duration of the window, in milliseconds. */
function windowSpan(key) {
  return key === 'five_hour' ? FIVE_HOUR_MS : WEEK_MS;
}

/**
 * Usage, theoretical uniform pace, and delta for a quota window.
 * `utilization` is 0-100 and `resets_at` an ISO 8601 string (as exposed by
 * Claude Code).
 *
 * If `resets_at` is already past, the data predates a reset: the usage no
 * longer applies, so `used` is null and `expired` is true. The weekly window
 * starts again right away, so its pace carries on into the new week; the
 * 5-hour one only starts with the next message, so its pace is unknown.
 */
function windowStats(win, key, now = Date.now()) {
  if (!win || typeof win.utilization !== 'number') return null;
  let used = win.utilization;
  const span = windowSpan(key);
  let pace = null;
  let remainingMs = null;
  let expired = false;
  let reset = win.resets_at ? Date.parse(win.resets_at) : NaN;
  if (!Number.isNaN(reset) && reset <= now) {
    expired = true;
    used = null;
    reset = key === 'five_hour' ? NaN : reset + (Math.floor((now - reset) / span) + 1) * span;
  }
  if (!Number.isNaN(reset)) {
    remainingMs = reset - now;
    pace = Math.max(0, Math.min(100, ((span - remainingMs) / span) * 100));
  }
  return {
    used,
    pace,
    remainingMs,
    expired,
    delta: pace === null || used === null ? null : used - pace,
    // Time the uniform pace needs to catch up with usage (negative: usage is behind it).
    deltaMs: pace === null || used === null ? null : ((used - pace) / 100) * span,
  };
}

/**
 * Fixed-width bar: the fill is real usage, the marker is the theoretical
 * uniform pace. Overlaid on the same bar so it's readable at a glance whether
 * usage is running ahead of or behind a constant pace.
 */
function renderBar(used, pace, width, marker = DEFAULT_MARKER) {
  const filled = (Math.max(0, Math.min(100, used || 0)) / 100) * width;
  const cells = [];
  for (let i = 0; i < width; i++) {
    const frac = Math.min(Math.max(filled - i, 0), 1);
    if (frac >= 1) cells.push('█');
    else if (frac <= 0) cells.push('░');
    else cells.push(BLOCKS[Math.max(0, Math.min(7, Math.floor(frac * 8) - 1))]);
  }
  if (pace !== null && pace !== undefined) {
    const pos = Math.max(0, Math.min(width - 1, Math.floor((Math.max(0, Math.min(100, pace)) / 100) * width)));
    cells[pos] = marker;
  }
  return cells.join('');
}

/**
 * 'below' | 'even' | 'above' | 'critical': drives the item's color. It depends
 * only on the distance from the uniform pace, never on how much is used:
 * more than 10 points over it is critical (red), 1 to 10 over is above (yellow),
 * anything else is neutral ('below' only changes the wording, not the color).
 */
function severity(used, delta) {
  if (used === null || delta === null) return 'even';
  if (delta > 10) return 'critical';
  if (delta > 1) return 'above';
  if (delta < -1) return 'below';
  return 'even';
}

function humanDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d${h}h`;
  if (h) return `${h}h${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

/** Signed duration, margin-style: '+5h20m' when behind pace (time in hand), '−1d3h' when ahead of it. */
function signedDuration(ms) {
  if (Math.abs(ms) < 30_000) return '0m';
  return `${ms < 0 ? '+' : '−'}${humanDuration(Math.abs(ms))}`;
}

function humanAge(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Status bar text. `staleMs` appends a ⚠ and the data's age, because an old
 * percentage read as current is worse than no data at all.
 */
function statusText(stats, { label = '7d', width = 12, staleMs = null, marker = DEFAULT_MARKER, equivalent = false } = {}) {
  const bar = renderBar(stats.used, stats.pace, width, marker);
  let text = `${label} ${bar} ${stats.used === null ? 'reset' : `${Math.round(stats.used)}%`}`;
  if (stats.delta !== null) {
    const sign = stats.delta < -0.5 ? '▼' : stats.delta > 0.5 ? '▲' : '=';
    text += ` ${sign}${Math.round(Math.abs(stats.delta))}%`;
    if (equivalent && stats.deltaMs !== null) text += ` (${signedDuration(stats.deltaMs)})`;
  }
  if (staleMs !== null) text += ` ⚠${humanAge(staleMs)}`;
  return text;
}

module.exports = {
  WEEK_MS, FIVE_HOUR_MS, DEFAULT_MARKER,
  windowSpan, windowStats, renderBar, severity, humanDuration, signedDuration, humanAge, statusText,
};
