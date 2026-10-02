'use strict';
// TAISA Mirror: local control server. Serves the browser UI on 127.0.0.1 only and bridges
// the AirPlay receiver to the browser over a WebSocket (H.264 -> WebCodecs).
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { AirPlayReceiver } = require('./airplay');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const DATA = process.env.TAISA_DATA || path.join(ROOT, 'data');
const PORT = parseInt(process.env.TAISA_PORT || '7878', 10);
const HOST = '127.0.0.1'; // never exposed to the LAN
const NAME = process.env.TAISA_NAME || 'TAISA Mirror';
const OPEN = process.argv.includes('--open');

fs.mkdirSync(DATA, { recursive: true });
const logStream = fs.createWriteStream(path.join(DATA, 'taisa-mirror.log'), { flags: 'a' });
const log = (m) => { const l = `${new Date().toISOString()} ${m}`; logStream.write(l + '\n'); if (process.env.TAISA_VERBOSE) console.log(l); };

// ---------------------------------------------------------------- state
const ap = new AirPlayReceiver({ name: NAME, dataDir: DATA, log });
const state = { state: 'idle', client: null, error: null, notice: null };
const clients = new Set(); // websockets
let lastConfig = null;     // last avcC packet (so late browsers can start decoding)

function status() { return JSON.stringify({ type: 'status', ...state, name: NAME }); }
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
  lastConfig = configMessage(avcc, w, h);
  broadcastBin(lastConfig);
});
ap.on('frame', (data, key, ts) => {
  const head = Buffer.alloc(10); head[0] = key ? 2 : 3; head.writeBigUInt64BE(BigInt(ts), 2);
  broadcastBin(Buffer.concat([head, data]));
});
ap.on('ended', reason => {
  lastConfig = null;
  if (state.state === 'connected' || state.client) setState({ state: ap.rtspServer ? 'waiting' : 'idle', client: null, notice: reason === 'user' ? '切断しました' : 'iPhone側で接続が終了しました' });
});

function configMessage(avcc, w, h) { // type 1 | w u16 | h u16 | avcC
  const head = Buffer.alloc(5); head[0] = 1; head.writeUInt16BE(w, 1); head.writeUInt16BE(h, 3);
  return Buffer.concat([head, avcc]);
}

// ---------------------------------------------------------------- HTTP (UI + tiny API), localhost only
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const hostOk = (req) => { const h = (req.headers.host || '').toLowerCase(); return h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}`; }; // DNS-rebinding guard
const originOk = (req) => { const o = req.headers.origin; if (!o) return true; return o === `http://127.0.0.1:${PORT}` || o === `http://localhost:${PORT}`; };

const server = http.createServer((req, res) => {
  if (!hostOk(req)) { res.writeHead(403); return res.end('forbidden'); }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/status') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(status()); }
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
  clients.add(sock);
  sock.write(wsFrame(1, Buffer.from(status())));
  if (lastConfig && state.state === 'connected') sock.write(wsFrame(2, lastConfig));
  sock.on('close', () => clients.delete(sock)); sock.on('error', () => {});
  wsParser(sock, msg => {
    let m; try { m = JSON.parse(msg); } catch { return; }
    if (m.cmd === 'start') start();
    else if (m.cmd === 'cancel') cancel();
    else if (m.cmd === 'disconnect') disconnect();
  });
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    // Already running: just open the existing UI.
    console.log(`TAISA Mirror is already running: http://localhost:${PORT}`);
    if (OPEN) openBrowser();
    process.exit(0);
  }
  console.error(e); process.exit(1);
});

function openBrowser() {
  const url = `http://localhost:${PORT}/`;
  // `start` opens the default browser (Chrome/Edge). No extra tools needed.
  exec(`start "" "${url}"`, { windowsHide: true });
}

server.listen(PORT, HOST, () => {
  console.log(`TAISA Mirror  http://localhost:${PORT}   (this window can stay open; close it to quit)`);
  log(`ui listening on ${HOST}:${PORT}`);
  if (OPEN) openBrowser();
});

async function shutdown() { try { await ap.stop(); } catch { /* ignore */ } process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
process.on('uncaughtException', e => { log('uncaught: ' + (e.stack || e)); });

module.exports = { ap };
