'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
// TAISA Mirror launcher: what "Start TAISA Mirror.cmd" / the desktop, Start-menu and taskbar shortcuts run.
//   1. Is a TAISA Mirror server already answering on 127.0.0.1:<port>?  -> just open the browser.
//   2. Port free?  -> start ONE windowless background server (detached, no console window), wait until it
//      answers, open the browser.
//   3. Port used by something else?  -> say so (exit code 1) instead of opening the wrong page.
// The launcher itself exits right away, so no black console window stays behind (nothing to close by mistake,
// and the taskbar button never turns into "the server window").
const http = require('http');
const { spawn } = require('child_process');

function probe(port) { // 'ours' | 'free' | 'busy'
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/status', timeout: 1500 }, (res) => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', (d) => { if (body.length < 4096) body += d; });
      res.on('end', () => { try { resolve(JSON.parse(body).type === 'status' ? 'ours' : 'busy'); } catch { resolve('busy'); } });
    });
    req.on('timeout', () => { req.destroy(); resolve('busy'); });
    req.on('error', (e) => resolve(e.code === 'ECONNREFUSED' ? 'free' : 'busy'));
  });
}

function openBrowser(port) {
  if (process.env.TAISA_NO_BROWSER) return;
  const url = `http://localhost:${port}/`;
  // explorer.exe hands the URL to the default browser through the normal Windows shell path
  // (no hidden window state is inherited, which can make a cold-started Chrome open invisibly).
  const c = spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' });
  c.on('error', () => console.log(`Open this address in Chrome/Edge: ${url}`));
  c.unref();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run({ port, entry }) {
  const state = await probe(port);
  if (state === 'busy') {
    console.log('');
    console.log(` ポート ${port} を、TAISA Mirror ではない別のプログラムが使っています。`);
    console.log(' そのプログラムを終了してから、もう一度起動してください。');
    console.log(` (Port ${port} is used by another program.)`);
    process.exit(1);
  }
  if (state === 'free') {
    const child = spawn(process.execPath, [entry, '--serve'], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env });
    child.unref();
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { await sleep(150); up = (await probe(port)) === 'ours'; }
    if (!up) {
      console.log('');
      console.log(' TAISA Mirror を起動できませんでした。');
      console.log(' 詳しくは data\\taisa-mirror.log を見てください。');
      process.exit(1);
    }
  }
  openBrowser(port);
  await sleep(1200); // let explorer.exe start before this process exits
  process.exit(0);
}

module.exports = { run, probe };
