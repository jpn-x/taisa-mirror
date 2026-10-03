'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
// MirrorX (dev codename TAISA MIRROR, https://github.com/jpn-x/taisa-mirror). AirPlay protocol handling follows UxPlay (GPL-3.0); see THIRD_PARTY_NOTICES.md.
// MirrorX: local control server. Serves the browser UI on 127.0.0.1 only and bridges
// the AirPlay receiver to the browser over a WebSocket (H.264 -> WebCodecs).
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { AirPlayReceiver } = require('./airplay');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const DATA = process.env.TAISA_DATA || path.join(ROOT, 'data');
const PORT = parseInt(process.env.TAISA_PORT || '7878', 10);
const HOST = '127.0.0.1'; // never exposed to the LAN
const NAME = process.env.TAISA_NAME || 'MirrorX';
const argv = process.argv;
const OPEN = argv.includes('--open');
const BACKGROUND = argv.includes('--serve');            // the detached, windowless server process

// `--open` (what "Start MirrorX.cmd" runs) = launcher mode: make sure ONE windowless server is running,
// open the browser, and exit. No console window stays open, so nothing can be closed by mistake and the
// taskbar/desktop shortcut always behaves the same (see server/launcher.js).
if (OPEN && !BACKGROUND && !argv.includes('--foreground')) { require('./launcher').run({ port: PORT, entry: __filename }); return; }

fs.mkdirSync(DATA, { recursive: true });
const logStream = fs.createWriteStream(path.join(DATA, 'mirrorx.log'), { flags: 'a' });
const log = (m) => { const l = `${new Date().toISOString()} ${m}`; logStream.write(l + '\n'); if (process.env.TAISA_VERBOSE) console.log(l); };

// ---------------------------------------------------------------- state
const ap = new AirPlayReceiver({ name: NAME, dataDir: DATA, log });
const state = { state: 'idle', client: null, error: null, notice: null };
const clients = new Set(); // websockets
let lastConfig = null;     // last avcC packet (so late browsers can start decoding)
let gop = [];              // frames since the last IDR, so a browser can resync instantly (the iPhone rarely sends new IDRs)
let gopBytes = 0;

const BOOT = Date.now();   // changes at every start: a page left open from an older run reloads itself (see web/index.html)
function status() { return JSON.stringify({ type: 'status', ...state, name: NAME, boot: BOOT }); }
function setState(patch) { Object.assign(state, patch); broadcastText(status()); }

// ---------------------------------------------------------------- minimal WebSocket (RFC 6455, server side)
function wsFrame(opcode, payload) {
  const n = payload.length; let head;
  if (n < 126) head = Buffer.from([0x80 | opcode, n]);
  else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, payload]);
}
function broadcastText(s) { const f = wsFrame(1, Buffer.from(s)); for (const c of clients) c.write(f); }
function broadcastBin(buf) {
  const f = wsFrame(2, buf);
  for (const c of clients) { if (c.writableLength > 8 << 20) continue; /* slow browser: drop, never queue unboundedly */ c.write(f); }
}

function wsParser(sock, onMessage) {
  let buf = Buffer.alloc(0);
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0; let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20 || !masked) { sock.destroy(); return; }
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4); const data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + len);
      if (op === 8) { sock.end(wsFrame(8, Buffer.alloc(0))); return; }
      if (op === 9) { sock.write(wsFrame(10, data)); continue; }
      if (op === 1) onMessage(data.toString('utf8'));
    }
  });
}

// ---------------------------------------------------------------- commands from the browser
let busy = false;
async function start() {
  if (busy || state.state !== 'idle') return;
  busy = true; setState({ error: null, notice: null });
  try { await ap.start(); setState({ state: 'waiting' }); }
  catch (e) {
    log('start failed: ' + e.stack);
    const m = e.code === 'EADDRINUSE' ? `ポート ${e.port || ''} が使用中です（別のミラーリングソフトやUxPlayが動いていませんか？）` : e.message;
    setState({ state: 'idle', error: m });
  } finally { busy = false; }
}
async function cancel() {
  if (busy) return; busy = true;
  try { await ap.stop(); } finally { busy = false; lastConfig = null; setState({ state: 'idle', client: null, notice: null }); }
}
function disconnect() { ap.disconnect(); }

ap.on('client', c => setState({ client: c }));
ap.on('mirroring', c => setState({ state: 'connected', client: c }));
ap.on('config', (avcc, w, h) => {
  const msg = configMessage(avcc, w, h);
  // After screen-off/on the iPhone re-sends the same SPS/PPS and keeps going without a new IDR:
  // resetting the decoder then would freeze it, so an unchanged config is ignored.
  if (lastConfig && lastConfig.equals(msg)) return;
  lastConfig = msg; gop = []; gopBytes = 0;
  broadcastBin(lastConfig);
});
ap.on('audio', (pcm) => {   // decoded iPhone audio: 16-bit interleaved stereo, 44.1 kHz  ->  browser (binary type 4)
  if (!clients.size) return;
  const f = wsFrame(2, Buffer.concat([Buffer.from([4]), pcm]));
  for (const c of clients) { if (c.writableLength > 1 << 20) continue; c.write(f); }   // slow browser: drop audio rather than queue it
});
ap.on('audioreset', () => broadcastText(JSON.stringify({ type: 'audioreset' })));
ap.on('volume', (db) => broadcastText(JSON.stringify({ type: 'volume', db })));
ap.on('screen', (off) => broadcastText(JSON.stringify({ type: 'screen', off })));   // lets the page explain a frozen picture
let nFrames = 0;
setInterval(() => { if (nFrames) log(`frames in last 5s: ${nFrames}`); nFrames = 0; }, 5000).unref();
ap.on('frame', (data, key, ts) => {
  nFrames++;
  const head = Buffer.alloc(10); head[0] = key ? 2 : 3; head.writeBigUInt64BE(BigInt(ts), 2);
  const msg = Buffer.concat([head, data]);
  if (key) { gop = [msg]; gopBytes = msg.length; }
  else if (gop.length) { gop.push(msg); gopBytes += msg.length; if (gopBytes > 64 << 20) { gop = []; gopBytes = 0; } }
  broadcastBin(msg);
});
ap.on('ended', reason => {
  lastConfig = null; gop = []; gopBytes = 0;
  if (state.state === 'connected' || state.client) setState({ state: ap.rtspServer ? 'waiting' : 'idle', client: null, notice: reason === 'user' ? '切断しました' : 'iPhone側で接続が終了しました' });
});

function resync(sock) { // config + every frame since the last IDR
  if (!lastConfig || state.state !== 'connected' || !gop.length) return;
  sock.write(wsFrame(2, lastConfig)); for (const f of gop) sock.write(wsFrame(2, f));
}

function configMessage(avcc, w, h) { // type 1 | w u16 | h u16 | avcC
  const head = Buffer.alloc(5); head[0] = 1; head.writeUInt16BE(w, 1); head.writeUInt16BE(h, 3);
  return Buffer.concat([head, avcc]);
}

// ---------------------------------------------------------------- first-run: offer to create the shortcut (asked only once)
const PREFS_FILE = path.join(DATA, 'prefs.json');
const readPrefs = () => { try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); } catch { return {}; } };
const writePrefs = (o) => { try { fs.writeFileSync(PREFS_FILE, JSON.stringify({ ...readPrefs(), ...o }, null, 2)); } catch (e) { log('prefs write failed: ' + e.message); } };
function desktopHasShortcut() { // an existing MirrorX shortcut (e.g. made earlier by ショートカットを作る.cmd) means: don't ask
  const up = process.env.USERPROFILE || '';
  return [path.join(up, 'Desktop'), path.join(up, 'OneDrive', 'Desktop'), path.join(process.env.OneDrive || '', 'Desktop')]
    .some((d) => { try { return fs.existsSync(path.join(d, 'MirrorX.lnk')); } catch { return false; } });
}
const shortcutAsk = () => process.platform === 'win32' && !process.env.TAISA_NO_BROWSER && !readPrefs().shortcutAsked && !desktopHasShortcut();
function createShortcuts(cb) {
  const ps = path.join(process.env.SystemRoot || String.raw`C:\Windows`, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const c = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'create-shortcut.ps1')], { windowsHide: true });
  let err = ''; c.stderr.on('data', (d) => { err += d; });
  c.on('error', (e) => cb(false, e.message));
  c.on('close', (code) => cb(code === 0, err.trim().slice(0, 300)));
}

// ---------------------------------------------------------------- HTTP (UI + tiny API), localhost only
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const hostOk = (req) => { const h = (req.headers.host || '').toLowerCase(); return h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}`; }; // DNS-rebinding guard
const originOk = (req) => { const o = req.headers.origin; if (!o) return true; return o === `http://127.0.0.1:${PORT}` || o === `http://localhost:${PORT}`; };

const server = http.createServer((req, res) => {
  if (!hostOk(req)) { res.writeHead(403); return res.end('forbidden'); }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/status') {
    const ui = { clients: clients.size, visible: [...clients].filter(c => c.visible).length };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ ...JSON.parse(status()), ui }));
  }
  if (url.pathname === '/api/audio-support' && req.method === 'POST' && originOk(req) && req.headers['x-mirrorx'] === '1') {   // M1 diagnostics: which audio codecs can this browser decode?
    let body = ''; req.on('data', (d) => { if (body.length < 2048) body += d; });
    req.on('end', () => { log('browser audio decode support: ' + body.slice(0, 600)); res.writeHead(204); res.end(); });
    return;
  }
  if (url.pathname === '/api/shortcut') {
    if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ ask: shortcutAsk() })); }
    if (req.method === 'POST' && originOk(req) && req.headers['x-mirrorx'] === '1') {
      let body = ''; req.on('data', (d) => { if (body.length < 1024) body += d; });
      req.on('end', () => {
        let a = ''; try { a = JSON.parse(body).action; } catch { /* ignore */ }
        const done = (ok, msg) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ ok, msg })); };
        if (a === 'create') createShortcuts((ok, msg) => { writePrefs({ shortcutAsked: true, shortcutCreated: ok, shortcutAt: new Date().toISOString() }); log('shortcut create: ' + (ok ? 'ok' : 'failed ' + msg)); done(ok, msg); });
        else if (a === 'skip') { writePrefs({ shortcutAsked: true, shortcutCreated: false, shortcutAt: new Date().toISOString() }); done(true, ''); }
        else done(false, 'bad request');
      });
      return;
    }
    res.writeHead(403); return res.end('forbidden');
  }
  let p = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(WEB, p));
  if (!file.startsWith(WEB + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
});

server.on('upgrade', (req, sock) => {
  if (!hostOk(req) || !originOk(req) || req.url !== '/ws' || !req.headers['sec-websocket-key']) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sock.setNoDelay(true);
  clients.add(sock); idleCheck();
  sock.write(wsFrame(1, Buffer.from(status())));
  resync(sock);
  sock.on('close', () => { clients.delete(sock); idleCheck(); }); sock.on('error', () => {});
  wsParser(sock, msg => {
    let m; try { m = JSON.parse(msg); } catch { return; }
    if (m.cmd === 'start') start();
    else if (m.cmd === 'cancel') cancel();
    else if (m.cmd === 'disconnect') disconnect();
    else if (m.cmd === 'resync') resync(sock);
    else if (m.cmd === 'vis') sock.visible = !!m.visible;
    else if (m.cmd === 'quit') { log('quit requested from the browser'); setTimeout(shutdown, 150); }
  });
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is already in use (MirrorX may already be running): http://localhost:${PORT}`);
    log(`listen failed: port ${PORT} in use`);
    process.exit(1);
  }
  console.error(e); process.exit(1);
});

// Background server only: if no browser tab has been connected for a while, quit by itself
// (so a forgotten, windowless server never lingers and stops advertising on the LAN).
const IDLE_EXIT_MS = Math.max(1, parseFloat(process.env.TAISA_IDLE_EXIT_MIN || '10')) * 60 * 1000;
let idleTimer = null;
function idleCheck() {
  if (!BACKGROUND) return;
  clearTimeout(idleTimer); idleTimer = null;
  if (clients.size === 0) idleTimer = setTimeout(() => { log(`no browser for ${IDLE_EXIT_MS / 60000} min: quitting`); shutdown(); }, IDLE_EXIT_MS);
}

server.listen(PORT, HOST, () => {
  console.log(`MirrorX  http://localhost:${PORT}   (Ctrl+C to quit; the browser page also has a quit button)`);
  log(`ui listening on ${HOST}:${PORT}${BACKGROUND ? ' (background)' : ''}`);
  idleCheck();
});

async function shutdown() {
  try { broadcastText(JSON.stringify({ type: 'bye' })); } catch { /* ignore */ }   // lets open tabs show "終了しました" instead of an error
  try { await ap.stop(); } catch { /* ignore */ }
  setTimeout(() => process.exit(0), 150);                                          // give the 'bye' frame time to flush
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
process.on('uncaughtException', e => { log('uncaught: ' + (e.stack || e)); });

module.exports = { ap };
