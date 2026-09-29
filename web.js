'use strict';
// Small HTTP server that shows the same bar as a web page, so it can be
// checked from a phone on the same network. No vscode require: it only gets a
// snapshot function, and serves nothing but quota percentages (never tokens).

const http = require('http');
const os = require('os');

/** CSS color for each pace marker the extension offers. */
const MARKER_COLORS = {
  '🟦': '#3b8eea',
  '🟪': '#b36bff',
  '🟩': '#23c46b',
  '🟨': '#f5c518',
  '🟧': '#ff8c1a',
  '🟥': '#f14c4c',
};

function markerColor(marker) {
  return MARKER_COLORS[marker] || null; // null: the page's text color
}

/** Non-internal IPv4 addresses, to tell the user which URL to open on the phone. */
function lanUrls(port) {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${port}/`);
    }
  }
  return urls;
}

function startServer({ host, port, snapshot, log, onError }) {
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }
    if (url === '/api/quota') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(snapshot()));
    }
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(PAGE);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });
  server.on('error', onError);
  server.listen(port, host, () => log(`web: listening on http://${host}:${port}/`));
  return server;
}

// The pace marker is a solid line in its own color, with no shadow or halo,
// so it doesn't blur into the fill on either side.
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#1e1e1e">
<title>Claude Quota</title>
<style>
  :root {
    --bg: #f6f6f4; --card: #ffffff; --text: #1f1f1f; --muted: #6b6b6b;
    --track: #e4e4e0; --fill: #8a8a86; --marker: var(--text);
    --even: #6b6b6b; --below: #1a8f4c; --above: #b58100; --critical: #d23b3b;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #161616; --card: #1f1f1f; --text: #ececec; --muted: #9b9b9b;
      --track: #333331; --fill: #a9a9a5;
      --even: #9b9b9b; --below: #3ccf7c; --above: #f0b429; --critical: #ff6b6b;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: 24px 16px; display: flex; justify-content: center;
  }
  main { width: 100%; max-width: 560px; display: grid; gap: 16px; }
  h1 { font-size: 18px; margin: 0; font-weight: 600; }
  .card { background: var(--card); border-radius: 12px; padding: 18px 16px; }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .label { color: var(--muted); font-size: 14px; }
  .pct { font-size: 34px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .track { position: relative; height: 22px; background: var(--track); border-radius: 6px; overflow: hidden; margin: 12px 0 10px; }
  .fill { position: absolute; inset: 0 auto 0 0; background: var(--fill); }
  .marker { position: absolute; top: 0; bottom: 0; width: 4px; margin-left: -2px; background: var(--marker); }
  .delta { font-weight: 600; font-variant-numeric: tabular-nums; }
  .delta.below { color: var(--below); } .delta.even { color: var(--even); }
  .delta.above { color: var(--above); } .delta.critical { color: var(--critical); }
  .meta { color: var(--muted); font-size: 14px; display: flex; flex-wrap: wrap; gap: 4px 14px; }
  .foot { color: var(--muted); font-size: 13px; }
  .key { display: inline-block; width: 4px; height: 12px; background: var(--marker); vertical-align: -1px; margin: 0 2px; }
  .warn { color: var(--critical); }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <h1>Claude quota</h1>
  <section class="card" id="seven_day"></section>
  <section class="card" id="five_hour" hidden></section>
  <p class="foot" id="foot">Loading…</p>
</main>
<script>
  const VERDICT = { below: 'below pace: you have margin', even: 'on pace', above: 'above pace', critical: 'well above pace' };

  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function dur(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d) return d + 'd ' + h + 'h';
    if (h) return h + 'h ' + String(m).padStart(2, '0') + 'm';
    return m + 'm';
  }

  function card(el, title, w) {
    if (!w) { el.hidden = true; return; }
    el.hidden = false;
    const clamp = (v) => Math.max(0, Math.min(100, v));
    const sign = w.delta === null ? '' : w.delta > 0.5 ? '▲' : w.delta < -0.5 ? '▼' : '=';
    el.innerHTML =
      '<div class="head"><span class="label">' + title + '</span>'
      + (w.delta === null ? '' : '<span class="delta ' + w.severity + '">' + sign + Math.abs(w.delta).toFixed(1) + ' pp</span>')
      + '</div>'
      + '<div class="pct">' + w.used.toFixed(1) + '%</div>'
      + '<div class="track" role="img" aria-label="' + w.used.toFixed(0) + '% used'
      + (w.pace === null ? '' : ', uniform pace ' + w.pace.toFixed(0) + '%') + '">'
      + '<div class="fill" style="width:' + clamp(w.used) + '%"></div>'
      + (w.pace === null ? '' : '<div class="marker" style="left:' + clamp(w.pace) + '%"></div>')
      + '</div>'
      + '<div class="meta">'
      + (w.pace === null ? '' : '<span>Uniform pace ' + w.pace.toFixed(1) + '%</span><span>' + VERDICT[w.severity] + '</span>')
      + (w.remainingMs === null ? '' : '<span>Resets in ' + dur(w.remainingMs) + '</span>')
      + '</div>';
  }

  async function load() {
    const foot = document.getElementById('foot');
    try {
      const r = await fetch('api/quota', { cache: 'no-store' });
      const s = await r.json();
      if (s.markerColor) document.documentElement.style.setProperty('--marker', s.markerColor);
      if (!s.seven_day) {
        card(document.getElementById('seven_day'), '', null);
        card(document.getElementById('five_hour'), '', null);
        foot.textContent = 'Quota unavailable' + (s.error ? ': ' + s.error : '') + '.';
        return;
      }
      card(document.getElementById('seven_day'), 'Weekly (7 days)', s.seven_day);
      card(document.getElementById('five_hour'), '5-hour window', s.five_hour);
      const age = Date.now() - s.fetchedAt;
      foot.innerHTML = 'Data from ' + esc(s.source) + ', updated ' + (age < 90000 ? 'just now' : dur(age) + ' ago')
        + (s.stale ? ' <span class="warn">⚠ stale</span>' : '')
        + (s.error ? '. Last attempt: ' + esc(s.error) : '')
        + '. The fill is real usage, the <span class="key"></span> line is the theoretical uniform pace.';
    } catch (e) {
      foot.innerHTML = '<span class="warn">Can\\'t reach VS Code</span>: is the window with the extension still open?';
    }
  }
  load();
  setInterval(load, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
</script>
</body>
</html>
`;

module.exports = { startServer, lanUrls, markerColor };
