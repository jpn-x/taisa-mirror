'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
// MirrorX launcher: what "Start MirrorX.cmd" / the desktop, Start-menu and taskbar shortcuts run.
//   1. Is a MirrorX server already answering on 127.0.0.1:<port>?
//        - a MirrorX browser tab is open and visible -> bring that window to the front (no extra tab/window)
//        - otherwise                                -> open the page in the default browser
//      Clicking the icon again NEVER touches the iPhone connection.
//   2. Port free?  -> start ONE windowless background server (detached, no console window), wait until it
//      answers, open the browser.
//   3. Port used by something else / start failed?  -> show a readable message page in the browser
//      (the shortcuts run without a console window, so printing to a console would be invisible).
// The launcher itself exits right away, so no console window stays behind.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function probe(port) { // { state: 'ours'|'free'|'busy', ui? }
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/status', timeout: 1500 }, (res) => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', (d) => { if (body.length < 4096) body += d; });
      res.on('end', () => { try { const j = JSON.parse(body); resolve(j.type === 'status' ? { state: 'ours', ui: j.ui || {} } : { state: 'busy' }); } catch { resolve({ state: 'busy' }); } });
    });
    req.on('timeout', () => { req.destroy(); resolve({ state: 'busy' }); });
    req.on('error', (e) => resolve({ state: e.code === 'ECONNREFUSED' ? 'free' : 'busy' }));
  });
}

function openUrl(url) {
  if (process.env.TAISA_NO_BROWSER) return;
  // explorer.exe hands the URL to the default browser through the normal Windows shell path
  // (no hidden window state is inherited, which can make a cold-started Chrome open invisibly).
  const c = spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' });
  c.on('error', () => console.log(`Open this address in Chrome/Edge: ${url}`));
  c.unref();
}

// Try to activate the existing MirrorX browser window by its title. Resolves true if Windows did it.
// (Plain Windows PowerShell + WScript.Shell; if it is unavailable or blocked, the caller just opens the page.)
function focusExisting() {
  return new Promise((resolve) => {
    if (process.env.TAISA_NO_BROWSER) return resolve(true);
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    let out = '', done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const c = spawn(ps, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
        "try { $r = (New-Object -ComObject WScript.Shell).AppActivate('MirrorX'); if ($r) { 'OK' } else { 'NO' } } catch { 'NO' }"],
        { windowsHide: true });
      c.stdout.on('data', (d) => { out += d; });
      c.on('error', () => finish(false));
      c.on('close', () => finish(/OK/.test(out)));
      setTimeout(() => { try { c.kill(); } catch { /* ignore */ } finish(false); }, 4000);
    } catch { finish(false); }
  });
}

// Is there already a browser window titled "MirrorX ..." (e.g. the tab left open after "終了")?
// Read-only check. Such a tab reconnects by itself within ~1.5 s when the server comes back.
function windowExists() {
  return new Promise((resolve) => {
    if (process.env.TAISA_NO_BROWSER) return resolve(false);
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    let out = '', done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const c = spawn(ps, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
        "@(Get-Process | Where-Object { $_.MainWindowTitle -like 'MirrorX*' }).Count"], { windowsHide: true });
      c.stdout.on('data', (d) => { out += d; });
      c.on('error', () => finish(false));
      c.on('close', () => finish(parseInt(out.trim(), 10) > 0));
      setTimeout(() => { try { c.kill(); } catch { /* ignore */ } finish(false); }, 4000);
    } catch { finish(false); }
  });
}

function showMessage(dataDir, title, lines) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const file = path.join(dataDir, 'message.html');
    fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><title>MirrorX</title>
<body style="font-family:system-ui,'Yu Gothic UI',sans-serif;max-width:560px;margin:12vh auto;padding:0 20px;line-height:1.8;color:#12302d">
<h1 style="font-size:22px">${esc(title)}</h1>${lines.map((l) => `<p>${esc(l)}</p>`).join('')}</body>`);
    openUrl('file:///' + file.replace(/\\/g, '/'));
  } catch { /* nothing more we can do */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// one short line per click in data/launcher.log (helps to see what a click did; capped at ~64 KB)
function note(dataDir, msg) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const f = path.join(dataDir, 'launcher.log');
    if (fs.existsSync(f) && fs.statSync(f).size > 65536) fs.renameSync(f, f + '.1');
    fs.appendFileSync(f, `${new Date().toISOString()} ${msg}
`);
  } catch { /* ignore */ }
}

async function run({ port, entry }) {
  const dataDir = process.env.TAISA_DATA || path.join(path.dirname(entry), '..', 'data');
  const url = `http://localhost:${port}/`;
  let p = await probe(port);
  if (p.state === 'busy') {
    console.log(` Port ${port} is used by another program.`);
    showMessage(dataDir, `ポート ${port} が、別のプログラムに使われています`, [
      'MirrorX ではない別のプログラムが、このポートを使っています。',
      'そのプログラムを終了してから、もう一度 MirrorX を起動してください。']);
    await sleep(1200); process.exit(1);
  }
  if (p.state === 'free') {
    const hadWindow = windowExists();              // checked while the server starts
    const child = spawn(process.execPath, [entry, '--serve'], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env });
    child.unref();
    for (let i = 0; i < 60 && p.state !== 'ours'; i++) { await sleep(150); p = await probe(port); }
    if (p.state !== 'ours') {
      console.log(' MirrorX could not start. See data\\mirrorx.log');
      showMessage(dataDir, 'MirrorX を起動できませんでした', ['data フォルダの mirrorx.log に、原因が書かれています。', 'もう一度アイコンを押しても直らないときは、このログを見せてください。']);
      await sleep(1200); process.exit(1);
    }
    // A MirrorX window is still open from before (for example after "終了"): it reconnects by itself,
    // so wait a moment for it and reuse that window instead of opening another one.
    if (await hadWindow) { for (let i = 0; i < 18 && !(p.ui && p.ui.visible > 0); i++) { await sleep(150); p = await probe(port); } }
  }
  if (p.ui && p.ui.visible > 0 && await focusExisting()) {
    note(dataDir, 'click: brought the open MirrorX window forward');
  } else {
    note(dataDir, `click: opened the page (clients=${p.ui ? p.ui.clients : '?'}, visible=${p.ui ? p.ui.visible : '?'})`);
    openUrl(url);
  }
  await sleep(1200); // let explorer.exe start before this process exits
  process.exit(0);
}

module.exports = { run, probe };
