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
const REDRAW_MS = 30_000; // the theoretical pace keeps moving even without a fetch

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

/** Fallback value: the cache Claude Code itself keeps in ~/.claude.json. */
function readCliCache() {
  const data = readJson(CLI_STATE);
  const cached = data && data.cachedUsageUtilization;
  if (!cached || !cached.utilization) return null;
  return { fetchedAt: cached.fetchedAtMs || 0, limits: cached.utilization, source: 'Claude Code cache' };
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
    log(`cache: write failed: ${e.message}`);
  }
}

/**
 * Claude Code's OAuth token, re-read from disk every time: the CLI refreshes
 * it on its own and we don't want to touch the refresh token here, so as not
 * to interfere with its session.
 */
function accessToken() {
  const creds = readJson(CREDENTIALS);
  const oauth = creds && creds.claudeAiOauth;
  if (!oauth || !oauth.accessToken) return { token: null, reason: 'not authenticated' };
  if (oauth.expiresAt && oauth.expiresAt < Date.now()) return { token: null, reason: 'token expired, Claude Code will refresh it' };
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

/** The same endpoint that powers /usage. A 429 here is a per-account cooldown. */
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
      // Anthropic rejects certain TLS fingerprints: curl gets through where fetch is blocked.
      if (r.status === 403 && body.includes('Request not allowed')) {
        state.preferCurl = true;
        log('fetch: 403 "Request not allowed" → falling back to curl');
      } else {
        res = { status: r.status, body };
      }
    }
    if (!res) res = await curlGet(USAGE_URL, headers);
  } catch (e) {
    return { ok: false, reason: `network: ${e.message}` };
  }
  log(`GET usage → HTTP ${res.status}`);
  if (res.status === 429) return { ok: false, reason: 'cooldown (429)', backoff: true };
  if (res.status === 401) return { ok: false, reason: 'token rejected' };
  if (res.status !== 200) return { ok: false, reason: `HTTP ${res.status}` };
  let limits;
  try {
    limits = JSON.parse(res.body);
  } catch (e) {
    return { ok: false, reason: 'unreadable response' };
  }
  return { ok: true, entry: { fetchedAt: Date.now(), limits, source: 'API' } };
}

async function poll(force = false) {
  const now = Date.now();
  if (!force && state.cooldownUntil > now) {
    log(`skipping fetch: cooldown for ${Math.round((state.cooldownUntil - now) / 1000)}s more`);
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
      // Increasing backoff: the endpoint is shared with Claude Code and with
      // any other extension querying it, so retrying harder doesn't help.
      state.failures = Math.min(state.failures + 1, 5);
      state.cooldownUntil = now + Math.min(10 * 60_000, 60_000 * 2 ** (state.failures - 1));
    }
    log(`fetch failed: ${res.reason}`);
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
    item.text = '$(clock) quota n/a';
    item.tooltip = new vscode.MarkdownString(
      `**Claude quota unavailable**\n\n${state.error || 'no data yet'}\n\nClick to retry.`);
    item.backgroundColor = undefined;
    item.show();
    return;
  }
  const week = pickWindow(entry.limits, 'seven_day');
  const stats = week ? q.windowStats(week, 'seven_day') : null;
  if (!stats) {
    item.text = '$(clock) quota n/a';
    item.tooltip = new vscode.MarkdownString('**Claude quota**\n\nThis plan doesn\'t expose a weekly window.');
    item.show();
    return;
  }
  const ageMs = Date.now() - (entry.fetchedAt || 0);
  const stale = ageMs > 90 * 60_000 ? ageMs : null; // past an hour and a half, the data should be flagged
  let text = q.statusText(stats, { label: '7d', width: cfg.barWidth, staleMs: stale });

  const five = pickWindow(entry.limits, 'five_hour');
  const fiveStats = five ? q.windowStats(five, 'five_hour') : null;
  if (cfg.showFiveHour && fiveStats) {
    text += `  ${q.statusText(fiveStats, { label: '5h', width: Math.max(4, Math.round(cfg.barWidth / 2)) })}`;
  }
  item.text = text;

  const sev = q.severity(stats.used, stats.delta);
  item.backgroundColor = sev === 'critical'
    ? new vscode.ThemeColor('statusBarItem.errorBackground')
    : sev === 'above' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;

  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**Claude weekly quota**\n\n`);
  md.appendMarkdown(`- Used: **${stats.used.toFixed(1)}%**\n`);
  if (stats.pace !== null) {
    md.appendMarkdown(`- Expected uniform pace: **${stats.pace.toFixed(1)}%**\n`);
    const verdict = stats.delta < -5 ? 'below pace: you have margin'
      : stats.delta > 15 ? 'well above pace'
      : stats.delta > 5 ? 'above pace' : 'on pace';
    md.appendMarkdown(`- Difference: **${stats.delta > 0 ? '+' : ''}${stats.delta.toFixed(1)} pp** — ${verdict}\n`);
    md.appendMarkdown(`- Resets in **${q.humanDuration(stats.remainingMs)}**\n`);
  }
  if (fiveStats) {
    md.appendMarkdown(`\n**5-hour window**: ${fiveStats.used.toFixed(1)}%`
      + (fiveStats.pace !== null ? ` (pace ${fiveStats.pace.toFixed(0)}%, resets in ${q.humanDuration(fiveStats.remainingMs)})` : '') + '\n');
  }
  md.appendMarkdown(`\nData from ${entry.source}, updated ${q.humanAge(ageMs)} ago${stale ? ' ⚠' : ''}.`);
  if (state.error) md.appendMarkdown(`\n\nLast attempt: ${state.error}.`);
  md.appendMarkdown(`\n\nThe fill is real usage, the \`┃\` marker is the theoretical uniform pace. Click to refresh now.`);
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
    render(); // the theoretical pace moves on its own
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
  item.name = 'Claude Quota';

  // Show something right away: our own cache first, then the CLI's.
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
