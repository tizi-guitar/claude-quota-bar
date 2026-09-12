'use strict';
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const q = require('./quota');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CREDENTIALS = path.join(os.homedir(), '.claude', '.credentials.json');
const CLI_STATE = path.join(os.homedir(), '.claude.json');
const REDRAW_MS = 30_000; // il ritmo teorico avanza anche senza fetch

let item, timer, output, state, cacheFile;

function log(msg) {
  if (output) output.appendLine(`${new Date().toISOString().slice(11, 19)} ${msg}`);
}

function config() {
  const c = vscode.workspace.getConfiguration('claudeQuotaBar');
  return {
    pollMinutes: Math.max(1, c.get('pollMinutes', 5)),
    barWidth: Math.max(4, Math.min(40, c.get('barWidth', 12))),
    showFiveHour: c.get('showFiveHour', false),
    alignment: c.get('alignment', 'right'),
    priority: c.get('priority', 100),
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

/** Dato di ripiego: la cache che Claude Code tiene in ~/.claude.json. */
function readCliCache() {
  const data = readJson(CLI_STATE);
  const cached = data && data.cachedUsageUtilization;
  if (!cached || !cached.utilization) return null;
  return { fetchedAt: cached.fetchedAtMs || 0, limits: cached.utilization, source: 'cache di Claude Code' };
}

function loadCache() {
  const data = readJson(cacheFile);
  return data && data.limits ? data : null;
}

function saveCache(entry) {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(entry));
  } catch (e) {
    log(`cache: scrittura fallita: ${e.message}`);
  }
}

/**
 * Token OAuth di Claude Code, riletto dal disco ogni volta: il CLI lo rinnova da
 * sé e qui non vogliamo toccare il refresh token per non interferire con lui.
 */
function accessToken() {
  const creds = readJson(CREDENTIALS);
  const oauth = creds && creds.claudeAiOauth;
  if (!oauth || !oauth.accessToken) return { token: null, reason: 'non autenticato' };
  if (oauth.expiresAt && oauth.expiresAt < Date.now()) return { token: null, reason: 'token scaduto, lo rinnova Claude Code' };
  return { token: oauth.accessToken };
}

function curlGet(url, headers) {
  const args = ['-s', '-m', '15', '-w', '\n%{http_code}'];
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  args.push(url);
  return new Promise((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 4 << 20 }, (err, stdout) => {
      if (err) return reject(err);
      const cut = stdout.lastIndexOf('\n');
      resolve({ status: parseInt(stdout.slice(cut + 1), 10) || 0, body: stdout.slice(0, cut) });
    });
  });
}

/** L'endpoint che interroga anche /usage. Un 429 qui è un cooldown per account. */
async function fetchUsage() {
  const { token, reason } = accessToken();
  if (!token) return { ok: false, reason };
  const headers = {
    Authorization: `Bearer ${token}`,
    'anthropic-beta': 'oauth-2025-04-20',
    'Content-Type': 'application/json',
  };
  let res;
  try {
    if (!state.preferCurl) {
      const r = await fetch(USAGE_URL, { headers });
      const body = await r.text();
      // Anthropic rifiuta certe impronte TLS: curl passa dove fetch viene bloccato.
      if (r.status === 403 && body.includes('Request not allowed')) {
        state.preferCurl = true;
        log('fetch: 403 "Request not allowed" → passo a curl');
      } else {
        res = { status: r.status, body };
      }
    }
    if (!res) res = await curlGet(USAGE_URL, headers);
  } catch (e) {
    return { ok: false, reason: `rete: ${e.message}` };
  }
  log(`GET usage → HTTP ${res.status}`);
  if (res.status === 429) return { ok: false, reason: 'cooldown (429)', backoff: true };
  if (res.status === 401) return { ok: false, reason: 'token rifiutato' };
  if (res.status !== 200) return { ok: false, reason: `HTTP ${res.status}` };
  let limits;
  try {
    limits = JSON.parse(res.body);
  } catch (e) {
    return { ok: false, reason: 'risposta illeggibile' };
  }
  return { ok: true, entry: { fetchedAt: Date.now(), limits, source: 'API' } };
}

async function poll(force = false) {
  const now = Date.now();
  if (!force && state.cooldownUntil > now) {
    log(`salto il fetch: cooldown per altri ${Math.round((state.cooldownUntil - now) / 1000)}s`);
    return;
  }
  const res = await fetchUsage();
  if (res.ok) {
    state.entry = res.entry;
    state.error = null;
    state.failures = 0;
    saveCache(res.entry);
  } else {
    state.error = res.reason;
    if (res.backoff) {
      // backoff crescente: l'endpoint è condiviso con Claude Code e con altre
      // estensioni che lo interrogano, quindi insistere non aiuta.
      state.failures = Math.min(state.failures + 1, 5);
      state.cooldownUntil = now + Math.min(10 * 60_000, 60_000 * 2 ** (state.failures - 1));
    }
    log(`fetch non riuscito: ${res.reason}`);
  }
  render();
}

function pickWindow(limits, key) {
  const win = limits && limits[key];
  return win && typeof win.utilization === 'number' ? win : null;
}

function render() {
  const cfg = config();
  const entry = state.entry;
  if (!entry) {
    item.text = '$(clock) quota n/d';
    item.tooltip = new vscode.MarkdownString(
      `**Quota Claude non disponibile**\n\n${state.error || 'nessun dato ancora'}\n\nClic per riprovare.`);
    item.backgroundColor = undefined;
    item.show();
    return;
  }
  const week = pickWindow(entry.limits, 'seven_day');
  const stats = week ? q.windowStats(week, 'seven_day') : null;
  if (!stats) {
    item.text = '$(clock) quota n/d';
    item.tooltip = new vscode.MarkdownString('**Quota Claude**\n\nIl piano non espone una finestra settimanale.');
    item.show();
    return;
  }
  const ageMs = Date.now() - (entry.fetchedAt || 0);
  const stale = ageMs > 90 * 60_000 ? ageMs : null; // oltre un'ora e mezza il dato va segnalato
  let text = q.statusText(stats, { label: '7g', width: cfg.barWidth, staleMs: stale });

  const five = pickWindow(entry.limits, 'five_hour');
  const fiveStats = five ? q.windowStats(five, 'five_hour') : null;
  if (cfg.showFiveHour && fiveStats) {
    text += `  ${q.statusText(fiveStats, { label: '5h', width: Math.max(4, Math.round(cfg.barWidth / 2)) })}`;
  }
  item.text = text;

  const sev = q.severity(stats.used, stats.delta);
  item.backgroundColor = sev === 'critico'
    ? new vscode.ThemeColor('statusBarItem.errorBackground')
    : sev === 'sopra' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;

  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**Quota settimanale Claude**\n\n`);
  md.appendMarkdown(`- Consumato: **${stats.used.toFixed(1)}%**\n`);
  if (stats.pace !== null) {
    md.appendMarkdown(`- Ritmo uniforme atteso: **${stats.pace.toFixed(1)}%**\n`);
    const verdict = stats.delta < -5 ? 'sotto il ritmo: hai margine'
      : stats.delta > 15 ? 'molto sopra il ritmo'
      : stats.delta > 5 ? 'sopra il ritmo' : 'in linea con il ritmo';
    md.appendMarkdown(`- Differenza: **${stats.delta > 0 ? '+' : ''}${stats.delta.toFixed(1)} pp** — ${verdict}\n`);
    md.appendMarkdown(`- Reset fra **${q.humanDuration(stats.remainingMs)}**\n`);
  }
  if (fiveStats) {
    md.appendMarkdown(`\n**Finestra 5 ore**: ${fiveStats.used.toFixed(1)}%`
      + (fiveStats.pace !== null ? ` (ritmo ${fiveStats.pace.toFixed(0)}%, reset fra ${q.humanDuration(fiveStats.remainingMs)})` : '') + '\n');
  }
  md.appendMarkdown(`\nDato da ${entry.source}, aggiornato ${q.humanAge(ageMs)}${stale ? ' ⚠' : ''}.`);
  if (state.error) md.appendMarkdown(`\n\nUltimo tentativo: ${state.error}.`);
  md.appendMarkdown(`\n\nIl riempimento è il consumo reale, il marcatore \`┃\` l'avanzamento teorico uniforme. Clic per aggiornare adesso.`);
  item.tooltip = md;
  item.show();
}

function schedule() {
  if (timer) clearInterval(timer);
  const cfg = config();
  let ticks = 0;
  const pollEvery = Math.round((cfg.pollMinutes * 60_000) / REDRAW_MS);
  timer = setInterval(() => {
    ticks++;
    render(); // il ritmo teorico si muove da solo
    if (ticks % pollEvery === 0) poll();
  }, REDRAW_MS);
}

function activate(context) {
  output = vscode.window.createOutputChannel('Claude Quota Bar');
  cacheFile = path.join(context.globalStorageUri.fsPath, 'usage-cache.json');
  state = { entry: null, error: null, failures: 0, cooldownUntil: 0, preferCurl: false };

  const cfg = config();
  item = vscode.window.createStatusBarItem(
    cfg.alignment === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right,
    cfg.priority);
  item.command = 'claudeQuotaBar.refresh';
  item.name = 'Quota Claude';

  // Mostra subito qualcosa: prima la nostra cache, poi quella del CLI.
  state.entry = loadCache() || readCliCache();
  render();

  context.subscriptions.push(
    item, output,
    vscode.commands.registerCommand('claudeQuotaBar.refresh', () => poll(true)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeQuotaBar')) { render(); schedule(); }
    }),
    { dispose: () => timer && clearInterval(timer) },
  );

  poll();
  schedule();
}

function deactivate() {
  if (timer) clearInterval(timer);
}

module.exports = { activate, deactivate };
