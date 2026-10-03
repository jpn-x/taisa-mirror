'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
// MirrorX (dev codename TAISA MIRROR, https://github.com/jpn-x/taisa-mirror). AirPlay protocol handling follows UxPlay (GPL-3.0); see THIRD_PARTY_NOTICES.md.
// AirPlay (legacy / "AirPlay 1" screen mirroring) receiver. Zero dependencies.
// Protocol knowledge follows the open-source UxPlay project (GPL-3.0).
// Video only in v0.1: the H.264 stream is decrypted here and handed to the browser (WebCodecs).
const net = require('net');
const dgram = require('dgram');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const bplist = require('./bplist');
const { FairPlay } = require('./fairplay');
const { MdnsAdvertiser } = require('./mdns');

const VERSION = '220.68';
const MODEL = 'AppleTV3,2';
const FEATURES = '0x5A7FFEE6,0x0';
const FEATURES_NUM = 0x5A7FFEE6;
// M1 audio experiment (MIRRORX_AUDIO_TEST=1): tell the phone we only take ALAC (44.1 kHz/16-bit/stereo = bit 18) and log what arrives.
// MIRRORX_AUDIO_TEST: 1|alac = ALAC only (bit 18), lc = AAC-LC only (bit 22), default = leave all formats on (baseline capture).
const AUDIO_TEST = process.env.MIRRORX_AUDIO_TEST || '';
const AUDIO_MASK = { '1': 0x40000, alac: 0x40000, lc: 0x400000 }[AUDIO_TEST] || 0x3fffffc;
const PI = '2e388006-13ba-4041-9a67-25dd4a43d536';

const PORTS = { rtsp: 7000, mirror: 7100, audioData: 7101, audioCtl: 7102, timing: 7103 };

const sha512 = (...parts) => { const h = crypto.createHash('sha512'); parts.forEach(p => h.update(p)); return h.digest(); };
const rawOf = (key) => Buffer.from(key.export({ format: 'jwk' }).x, 'base64url');
const importPub = (type, raw) => crypto.createPublicKey({ key: { kty: 'OKP', crv: type === 'ed' ? 'Ed25519' : 'X25519', x: raw.toString('base64url') }, format: 'jwk' });

function loadIdentity(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'identity.json');
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { deviceId: j.deviceId, priv: crypto.createPrivateKey(j.priv) };
  } catch { /* create below */ }
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const mac = crypto.randomBytes(6); mac[0] = (mac[0] & 0xfe) | 0x02; // locally administered, unicast
  const deviceId = [...mac].map(b => b.toString(16).padStart(2, '0')).join(':').toUpperCase();
  fs.writeFileSync(file, JSON.stringify({ deviceId, priv: privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 });
  return { deviceId, priv: privateKey };
}

// ---------------------------------------------------------------- AAC-ELD audio decoder (FFmpeg's AAC decoder built to WebAssembly in CI, engine/aac_eld.wasm)
let aacModule;
function makeAacDecoder() {
  try {
    if (aacModule === undefined) aacModule = new WebAssembly.Module(fs.readFileSync(path.join(__dirname, '..', 'engine', 'aac_eld.wasm')));
    const wasi = new Proxy({}, { get: (_t, n) => n === 'proc_exit' ? (c) => { throw new Error('wasm exit ' + c); } : () => 0 });
    const x = new WebAssembly.Instance(aacModule, { wasi_snapshot_preview1: wasi, env: new Proxy({}, { get: () => () => 0 }) }).exports;
    const mem = () => new Uint8Array(x.memory.buffer), inP = x.mx_in_ptr(), outP = x.mx_out_ptr();
    const asc = Buffer.from('f8e85000', 'hex');   // AudioSpecificConfig: AAC-ELD, 44.1 kHz, stereo, 480 samples per frame
    mem().set(asc, inP);
    if (x.mx_aac_init(asc.length, 44100, 2) !== 0) return null;
    return { decode(buf) { if (buf.length < 9 || buf.length > 8192) return null; mem().set(buf, inP); const n = x.mx_aac_decode(buf.length); return n > 0 ? Buffer.from(mem().slice(outP, outP + n * 4)) : null; } };
  } catch { aacModule = null; return null; }
}

class AirPlayReceiver extends EventEmitter {
  constructor({ name = 'MirrorX', dataDir, log = () => {} }) {
    super();
    this.name = name; this.log = log; this.dataDir = dataDir;
    this.id = loadIdentity(dataDir);
    this.edPub = rawOf(crypto.createPublicKey(this.id.priv));
    this.rtspServer = null; this.mdns = null; this.session = null; this.conns = new Set();
  }

  txt() {
    const pk = this.edPub.toString('hex');
    const raop = { ch: '2', cn: '0,1,2,3', da: 'true', et: '0,3,5', vv: '2', ft: FEATURES, am: MODEL, md: '0,1,2', rhd: '5.6.0.0',
      pw: 'false', sf: '0x4', sr: '44100', ss: '16', sv: 'false', tp: 'UDP', txtvers: '1', vs: VERSION, vn: '65537', pk };
    const airplay = { deviceid: this.id.deviceId, features: FEATURES, pw: 'false', flags: '0x4', model: MODEL, pk, pi: PI, srcvers: VERSION, vv: '2' };
    return { raop, airplay };
  }

  async start() {
    if (this.rtspServer) return;
    await new Promise((resolve, reject) => {
      const s = net.createServer(sock => this._onConn(sock));
      s.once('error', reject);
      s.listen(PORTS.rtsp, '0.0.0.0', () => {
        s.removeListener('error', reject);
        s.on('error', e => this.log('rtsp server error: ' + e.message));
        this.rtspServer = s; resolve();
      });
    });
    const { raop, airplay } = this.txt();
    const idc = this.id.deviceId.replace(/:/g, '');
    this.mdns = new MdnsAdvertiser({
      host: 'mirrorx-' + idc.slice(-4).toLowerCase(), log: this.log,
      services: [
        { type: '_raop._tcp', instance: `${idc}@${this.name}`, port: PORTS.rtsp, txt: raop },
        { type: '_airplay._tcp', instance: this.name, port: PORTS.rtsp, txt: airplay },
      ],
    });
    try { await this.mdns.start(); } catch (e) { await this.stop(); throw e; }
    this.log(`advertising "${this.name}" (deviceid ${this.id.deviceId}) on tcp/${PORTS.rtsp}`);
  }

  async stop() {
    this._endSession('stopped');
    for (const c of [...this.conns]) c.destroy();
    this.conns.clear();
    if (this.mdns) { await this.mdns.stop(); this.mdns = null; }
    if (this.rtspServer) { const s = this.rtspServer; this.rtspServer = null; await new Promise(r => s.close(r)); }
  }

  /** Disconnect the current phone but keep advertising. */
  disconnect() { this._endSession('user'); for (const c of [...this.conns]) c.destroy(); this.conns.clear(); }

  // ---------------------------------------------------------------- RTSP/HTTP connection
  _onConn(sock) {
    sock.setNoDelay(true); sock.setKeepAlive(true, 5000); // notice a vanished phone (Wi-Fi off) within ~a minute
    this.conns.add(sock);
    const conn = {
      sock, fp: new FairPlay(), ecdhSecret: null, ecdhOurs: null, ecdhTheirs: null, edTheirs: null, hsStatus: 0,
      aesKey: null, remoteAddr: sock.remoteAddress ? sock.remoteAddress.replace(/^::ffff:/, '') : null, client: {},
    };
    let buf = Buffer.alloc(0);
    const pump = () => {
      for (;;) {
        const he = buf.indexOf('\r\n\r\n');
        if (he < 0) { if (buf.length > 1 << 20) sock.destroy(); return; }
        const head = buf.toString('latin1', 0, he).split('\r\n');
        const [method, url, proto] = head[0].split(' ');
        const headers = {};
        for (const l of head.slice(1)) { const i = l.indexOf(':'); if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); }
        const clen = parseInt(headers['content-length'] || '0', 10) || 0;
        if (buf.length < he + 4 + clen) return;
        const body = buf.subarray(he + 4, he + 4 + clen);
        buf = buf.subarray(he + 4 + clen);
        const req = { method, url, proto: proto || 'RTSP/1.0', headers, body };
        try { this._handle(conn, req); }
        catch (e) { this.log(`handler error (${method} ${url}): ${e.stack || e.message}`); this._reply(conn, req, 500, 'Internal Server Error'); }
      }
    };
    sock.on('data', d => { buf = Buffer.concat([buf, d]); pump(); });
    sock.on('error', () => {});
    sock.on('close', () => {
      this.conns.delete(sock);
      if (this.session && this.session.conn === conn) this._endSession('closed');
    });
  }

  _reply(conn, req, code, text, headers = {}, body = null) {
    const lines = [`${req.proto || 'RTSP/1.0'} ${code} ${text}`, `Server: AirTunes/${VERSION}`];
    const cseq = req.headers && req.headers['cseq'];
    if (cseq) lines.push(`CSeq: ${cseq}`);
    for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
    lines.push(`Content-Length: ${body ? body.length : 0}`);
    const head = Buffer.from(lines.join('\r\n') + '\r\n\r\n', 'latin1');
    if (!conn.sock.destroyed) conn.sock.write(body && body.length ? Buffer.concat([head, body]) : head);
  }

  _handle(conn, req) {
    const { method, url } = req;
    const ok = (headers, body) => this._reply(conn, req, 200, 'OK', headers, body);
    const plist = (obj) => ok({ 'Content-Type': 'application/x-apple-binary-plist' }, bplist.build(obj));
    this.log(`< ${method} ${url} (${req.body.length}B)`);
    switch (method + ' ' + url.split('?')[0]) {
      case 'GET /info': return this._info(conn, req, plist);
      case 'POST /pair-setup': {
        if (req.body.length !== 32) return this._reply(conn, req, 400, 'Bad Request');
        conn.hsStatus = 1;
        return ok({ 'Content-Type': 'application/octet-stream' }, this.edPub);
      }
      case 'POST /pair-verify': return this._pairVerify(conn, req, ok);
      case 'POST /fp-setup': {
        const b = req.body;
        let out = null;
        if (b.length === 16) { if (b[4] !== 3) return this._reply(conn, req, 501, 'Not Implemented'); out = conn.fp.setup(b); }
        else if (b.length === 164) out = conn.fp.handshake(b);
        if (!out) return this._reply(conn, req, 400, 'Bad Request');
        return ok({ 'Content-Type': 'application/octet-stream' }, out);
      }
      case 'POST /feedback':
      case 'POST /audioMode':
      case 'POST /command':
        return ok();
      default:
    }
    switch (method) {
      case 'OPTIONS': return ok({ Public: 'SETUP, RECORD, FLUSH, TEARDOWN, OPTIONS, GET_PARAMETER, SET_PARAMETER' });
      case 'SETUP': return this._setup(conn, req, plist);
      case 'RECORD': return ok({ 'Audio-Latency': '0', 'Audio-Jack-Status': 'connected; type=analog' });
      case 'GET_PARAMETER':
        if ((req.headers['content-type'] || '') === 'text/parameters' && req.body.toString().startsWith('volume'))
          return ok({ 'Content-Type': 'text/parameters' }, Buffer.from('volume: 0.000000\r\n'));
        return ok();
      case 'TEARDOWN': return this._teardown(conn, req);
      case 'FLUSH':
      case 'SET_PARAMETER': {
        const m = /^volume:\s*(-?[\d.]+)/m.exec(req.body.toString('latin1'));
        if (m) { this.log('volume ' + m[1] + ' dB'); this.emit('volume', parseFloat(m[1])); }
        return ok();
      }
      default:
        this.log(`unhandled ${method} ${url}`);
        return ok();
    }
  }

  _info(conn, req, plist) {
    const { raop, airplay } = this.txt();
    const res = {};
    const ct = req.headers['content-type'] || '';
    if (ct.includes('application/x-apple-binary-plist') && req.body.length) {
      try {
        const q = bplist.parse(req.body).qualifier;
        if (Array.isArray(q)) {
          const txtBuf = (o) => Buffer.concat(Object.entries(o).map(([k, v]) => { const b = Buffer.from(`${k}=${v}`); return Buffer.concat([Buffer.from([b.length]), b]); }));
          if (q[0] === 'txtAirPlay') res.txtAirPlay = txtBuf(airplay);
          if (q[0] === 'txtRAOP') res.txtRAOP = txtBuf(raop);
        }
      } catch { /* ignore */ }
    }
    if (ct) return plist(res);
    Object.assign(res, {
      deviceID: this.id.deviceId, macAddress: this.id.deviceId, pk: this.edPub, features: FEATURES_NUM, name: this.name,
      pi: PI, vv: 2, statusFlags: 68, keepAliveLowPower: 1, sourceVersion: VERSION, keepAliveSendStatsAsBody: true, model: MODEL,
    });
    if (!req.headers['cseq']) return plist(res);
    Object.assign(res, {
      initialVolume: new bplist.Real(0),
      audioLatencies: [100, 101].map(t => ({ type: t, inputLatencyMicros: 0, audioType: 'default', outputLatencyMicros: false })),
      audioFormats: [100, 101].map(t => ({ type: t, audioInputFormats: AUDIO_MASK, audioOutputFormats: AUDIO_MASK })),
      displays: [{
        uuid: 'e0ff8a27-6738-3d56-8a16-cc53aacee925', widthPhysical: 0, heightPhysical: 0, width: 1920, height: 1080,
        widthPixels: 1920, heightPixels: 1080, rotation: false, refreshRate: new bplist.Real(1 / 60), maxFPS: 30, overscanned: false, features: 14,
      }],
    });
    return plist(res);
  }

  _kdf(conn, salt) { return sha512(Buffer.from(salt), conn.ecdhSecret).subarray(0, 16); }

  _pairVerify(conn, req, ok) {
    const d = req.body;
    if (d.length < 4) return this._reply(conn, req, 400, 'Bad Request');
    const headers = { 'Content-Type': 'application/octet-stream' };
    if (d[0] === 1) {
      if (d.length !== 68) return this._reply(conn, req, 400, 'Bad Request');
      const theirsRaw = Buffer.from(d.subarray(4, 36)), edRaw = d.subarray(36, 68);
      conn.ecdhTheirs = theirsRaw; conn.edTheirs = importPub('ed', Buffer.from(edRaw));
      const ours = crypto.generateKeyPairSync('x25519');
      conn.ecdhOurs = rawOf(ours.publicKey);
      conn.ecdhSecret = crypto.diffieHellman({ privateKey: ours.privateKey, publicKey: importPub('x', theirsRaw) });
      const sig = crypto.sign(null, Buffer.concat([conn.ecdhOurs, theirsRaw]), this.id.priv);
      const c = crypto.createCipheriv('aes-128-ctr', this._kdf(conn, 'Pair-Verify-AES-Key'), this._kdf(conn, 'Pair-Verify-AES-IV'));
      const encSig = c.update(sig);
      conn.hsStatus = 2;
      return ok(headers, Buffer.concat([conn.ecdhOurs, encSig]));
    }
    if (d[0] === 0) {
      if (d.length !== 68 || conn.hsStatus !== 2) return this._reply(conn, req, 470, 'Client Authentication Failure');
      const c = crypto.createDecipheriv('aes-128-ctr', this._kdf(conn, 'Pair-Verify-AES-Key'), this._kdf(conn, 'Pair-Verify-AES-IV'));
      c.update(Buffer.alloc(64)); // skip the keystream already used for our own signature
      const sig = c.update(d.subarray(4, 68));
      const valid = crypto.verify(null, Buffer.concat([conn.ecdhTheirs, conn.ecdhOurs]), conn.edTheirs, sig);
      if (!valid) {
        this.log('pair-verify: bad client signature');
        this._reply(conn, req, 470, 'Client Authentication Failure', { Connection: 'close' });
        return conn.sock.end();
      }
      conn.hsStatus = 3;
      return ok(headers);
    }
    return this._reply(conn, req, 400, 'Bad Request');
  }

  _setup(conn, req, plist) {
    const p = bplist.parse(req.body);
    const res = {};
    if (p.ekey && p.eiv) {
      const aes = conn.fp.decrypt(p.ekey);
      if (!aes) return this._reply(conn, req, 400, 'Bad Request');
      conn.aesKey = conn.ecdhSecret ? sha512(aes, conn.ecdhSecret).subarray(0, 16) : aes;
      conn.eiv = Buffer.isBuffer(p.eiv) ? p.eiv : null;
      conn.client = { name: p.name || 'iPhone', model: p.model || '', deviceID: p.deviceID || '' };
      this._beginSession(conn, p.timingPort);
      res.timingPort = PORTS.timing; res.eventPort = 0;
    }
    if (Array.isArray(p.streams)) {
      res.streams = [];
      for (const st of p.streams) {
        if (st.type === 110) {
          this._startMirror(conn, BigInt(st.streamConnectionID).toString());
          res.streams.push({ dataPort: PORTS.mirror, type: 110 });
        } else if (st.type === 96) {
          this.log('audio stream offered: ' + JSON.stringify(st, (k, v) => typeof v === 'bigint' ? v.toString() : Buffer.isBuffer(v) ? `<${v.length}B>` : v));
          this._startAudioSink(conn, st);
          res.streams.push({ dataPort: PORTS.audioData, controlPort: PORTS.audioCtl, type: 96 });
        } else this.log('unknown stream type ' + st.type);
      }
    }
    return plist(res);
  }

  _teardown(conn, req) {
    let types = [];
    try { const p = bplist.parse(req.body); if (Array.isArray(p.streams)) types = p.streams.map(s => s.type); } catch { /* none */ }
    this._reply(conn, req, 200, 'OK', { Connection: 'close' });
    if (types.includes(96) && !types.includes(110)) return; // audio-only teardown: keep mirroring
    this._endSession('teardown');
  }

  // ---------------------------------------------------------------- session / streams
  _beginSession(conn, timingPort) {
    if (this.session) this._endSession('replaced');
    const s = { conn, mirrorServer: null, mirrorSock: null, udp: [], timer: null, decipher: null, state: 'setup' };
    this.session = s;
    // NTP timing: the phone is the timing server; we poll it like UxPlay does.
    if (timingPort && conn.remoteAddr) {
      const u = dgram.createSocket('udp4'); s.udp.push(u);
      u.on('error', e => this.log('timing socket: ' + e.message));
      u.on('message', () => {});
      u.bind(PORTS.timing, '0.0.0.0', () => {
        const send = () => {
          const pkt = Buffer.alloc(32); pkt[0] = 0x80; pkt[1] = 0xd2; pkt[3] = 0x07;
          const ms = Date.now() + 2208988800000; // NTP epoch
          pkt.writeUInt32BE(Math.floor(ms / 1000), 24); pkt.writeUInt32BE(Math.floor(((ms % 1000) / 1000) * 4294967296), 28);
          try { u.send(pkt, timingPort, conn.remoteAddr); } catch { /* ignore */ }
        };
        send(); s.timer = setInterval(send, 3000);
      });
    }
    this.emit('client', conn.client);
    this.log(`client "${conn.client.name}" (${conn.client.model}) connected`);
  }

  // M1: receive the audio RTP stream, decrypt it (AES-128-CBC, key = the session key, iv = "eiv"), and only LOG what arrives.
  // Nothing is played yet. With MIRRORX_AUDIO_TEST=1 the first frames are also dumped to data/audio-m1.bin for offline decoding (M2).
  _startAudioSink(conn, st) {
    const s = this.session; if (!s || s.audioStarted) return; s.audioStarted = true;
    const ct = Number(st && st.ct);
    const seen = new Set();
    if (ct === 8) { s.audio = { dec: makeAacDecoder(), next: -1, pending: new Map(), lost: 0, frames: 0 }; if (!s.audio.dec) this.log('audio: AAC-ELD decoder (engine/aac_eld.wasm) is not available; audio stays silent'); }
    s.audioDrain = setInterval(() => this._audioDrain(s), 20);
    const st8 = { dups: 0, pkts: 0, bytes: 0, gaps: 0, lastSeq: -1, alac: 0, other: 0, ctl: 0, ctlTypes: {} };
    let dump = null, dumped = 0;
    if (AUDIO_TEST && this.dataDir) { try { dump = fs.openSync(path.join(this.dataDir, 'audio-m1.bin'), 'w'); } catch { /* ignore */ } }
    s.audioTimer = setInterval(() => {
      if (!st8.pkts && !st8.ctl) return;
      this.log(`audio rx 5s: pkts=${st8.pkts} bytes=${st8.bytes} redundantCopies=${st8.dups} seqGaps=${st8.gaps} alacLike=${st8.alac} other=${st8.other} ctl=${st8.ctl} ${JSON.stringify(st8.ctlTypes)}`);
      st8.dups = st8.pkts = st8.bytes = st8.gaps = st8.alac = st8.other = st8.ctl = 0; st8.ctlTypes = {};
    }, 5000);
    for (const port of [PORTS.audioData, PORTS.audioCtl]) {
      const u = dgram.createSocket('udp4'); s.udp.push(u);
      u.on('error', () => {});
      u.on('message', (m) => {
        try {
          if (port === PORTS.audioCtl) { st8.ctl++; const t = m.length > 1 ? '0x' + (m[1] & 0x7f).toString(16) : '?'; st8.ctlTypes[t] = (st8.ctlTypes[t] || 0) + 1; return; }
          if (m.length < 12) return;
          const seq = m.readUInt16BE(2), pay = m.subarray(12);
          if (st8.lastSeq >= 0 && ((st8.lastSeq + 1) & 0xffff) !== seq) st8.gaps++;
          st8.lastSeq = seq; st8.pkts++; st8.bytes += pay.length;
          let dec = pay;
          const n = pay.length & ~15;
          if (conn.eiv && conn.aesKey && n > 0) {
            const d = crypto.createDecipheriv('aes-128-cbc', conn.aesKey, conn.eiv); d.setAutoPadding(false);
            dec = Buffer.concat([d.update(pay.subarray(0, n)), pay.subarray(n)]);
          }
          // ALAC frames start with a 3-bit element tag; 1 (stereo pair) => first byte 0b001xxxxx
          if (dec.length > 8 && (dec[0] & 0xe0) === 0x20) st8.alac++; else st8.other++;
          const dup = seen.has(seq); seen.add(seq); if (seen.size > 512) seen.delete(seen.values().next().value);
          if (dup) { st8.dups++; return; }
          if (st8.pkts + st8.other <= 3 && st8.pkts <= 3) this.log(`audio pkt seq=${seq} ts=${m.readUInt32BE(4)} payload=${pay.length}B first8=${dec.subarray(0, 8).toString('hex')}`);
          this._audioIn(s, seq, dec);
          if (dump !== null && dumped < 3000 && dec.length > 8) { const h = Buffer.alloc(6); h.writeUInt32BE(dec.length); h.writeUInt16BE(seq, 4); fs.writeSync(dump, h); fs.writeSync(dump, dec); dumped++; }   // [len u32][seq u16][frame]
        } catch (e) { this.log('audio rx error: ' + e.message); }
      });
      u.bind(port, '0.0.0.0');
    }
    this.log(`audio sink started (ct=${ct}${AUDIO_TEST ? ', test mode ' + AUDIO_TEST : ''})`);
  }

  // Audio frames arrive 3x (redundancy) and maybe out of order: put them in sequence, skip a hole after 40 ms, decode, emit PCM.
  _audioIn(s, seq, frame) {
    const a = s.audio; if (!a || !a.dec) return;
    if (a.next < 0) a.next = seq;
    if (((seq - a.next) & 0xffff) > 0x8000 || a.pending.has(seq)) return;   // already played / duplicate
    a.pending.set(seq, { frame: Buffer.from(frame), at: Date.now() });
    this._audioDrain(s);
  }

  _audioDrain(s) {
    const a = s.audio; if (!a || !a.dec) return;
    for (let guard = 0; guard < 70000; guard++) {
      const e = a.pending.get(a.next);
      if (e) {
        a.pending.delete(a.next); a.next = (a.next + 1) & 0xffff;
        let pcm = null; try { pcm = a.dec.decode(e.frame); } catch (err) { this.log('audio decode error: ' + err.message); }
        if (pcm) { a.frames++; this.emit('audio', pcm); }
        continue;
      }
      if (!a.pending.size) return;
      let oldest = Infinity, nearest = 0x10000, nearSeq = a.next;
      for (const [k, v] of a.pending) { if (v.at < oldest) oldest = v.at; const d = (k - a.next) & 0xffff; if (d < nearest) { nearest = d; nearSeq = k; } }
      if (a.pending.size > 8 || Date.now() - oldest > 40) { a.lost += nearest; a.next = nearSeq; continue; }   // give up on the missing frame(s)
      return;
    }
  }

  _startMirror(conn, streamId) {
    const s = this.session; if (!s) return;
    const key = sha512(Buffer.from('AirPlayStreamKey' + streamId), conn.aesKey).subarray(0, 16);
    const iv = sha512(Buffer.from('AirPlayStreamIV' + streamId), conn.aesKey).subarray(0, 16);
    s.decipher = crypto.createDecipheriv('aes-128-ctr', key, iv);
    if (s.mirrorServer) return;
    const srv = net.createServer(sock => {
      const peer = sock.remoteAddress ? sock.remoteAddress.replace(/^::ffff:/, '') : null;
      if (conn.remoteAddr && peer !== conn.remoteAddr) { sock.destroy(); return; } // only the phone that paired
      if (s.mirrorSock) s.mirrorSock.destroy();
      s.mirrorSock = sock; sock.setNoDelay(true); sock.setKeepAlive(true, 5000);
      this._readMirror(s, sock);
    });
    srv.on('error', e => this.log('mirror server: ' + e.message));
    srv.listen(PORTS.mirror, '0.0.0.0'); s.mirrorServer = srv;
  }

  _readMirror(s, sock) {
    let buf = Buffer.alloc(0);
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 128) return;
        const size = buf.readUInt32LE(0);
        if (size > 64 << 20) { this.log('mirror: absurd packet size, dropping'); sock.destroy(); return; }
        if (buf.length < 128 + size) return;
        const hdr = buf.subarray(0, 128), payload = buf.subarray(128, 128 + size);
        buf = buf.subarray(128 + size);
        try { this._mirrorPacket(s, hdr, payload); } catch (e) { this.log('mirror packet error: ' + e.message); }
      }
    });
    sock.on('error', () => {});
  }

  _mirrorPacket(s, hdr, payload) {
    const type = hdr[4];
    if (s.dbg === undefined) s.dbg = 0;
    if (s.dbg++ < 4) this.log(`mirror pkt type=${type} opt=${hdr[6]} size=${payload.length} head=${payload.subarray(0, 8).toString('hex')}`);
    if (type === 0) { // encrypted VCL NAL(s)
      if (!s.decipher) return;
      const data = s.decipher.update(payload); // CTR is one continuous stream across packets
      let off = 0, key = false;
      while (off + 4 <= data.length) {
        const n = data.readUInt32BE(off);
        if (n > data.length - off - 4) return this.log('mirror: bad NAL length (decrypt failure?)');
        if ((data[off + 4] & 0x1f) === 5) key = true;
        off += 4 + n;
      }
      if (off !== data.length) return this.log('mirror: trailing bytes after NALs');
      const ts = Number(hdr.readBigUInt64LE(8) / 1000n); // microseconds
      if (key) this.log(`mirror IDR frame ${data.length}B`);
      this.emit('frame', data, key, ts);
    } else if (type === 1) { // avcC (SPS+PPS), unencrypted
      const w = Math.round(hdr.readFloatLE(56)), h = Math.round(hdr.readFloatLE(60));
      this.log(`mirror config packet opt=0x${hdr[6].toString(16)} size=${payload.length} ${w}x${h}${hdr[6] === 0x56 || hdr[6] === 0x5e ? ' (video stopping: screen off?)' : ''}`);
      this.emit('screen', hdr[6] === 0x56 || hdr[6] === 0x5e);   // true = the iPhone screen went off, false = back on
      if (payload.length < 8) return; // empty/odd config (e.g. stream suspended): keep the current decoder
      if (payload.length >= 8 && payload.toString('latin1', 4, 8) === 'hvc1') return this.log('H.265 stream not supported in v0.1');
      this.emit('config', Buffer.from(payload), w, h);
      if (this.session === s && s.state !== 'mirroring') {
        s.state = 'mirroring';
        this.emit('mirroring', { ...s.conn.client, width: w, height: h });
      }
    } // types 2 (heartbeat) and 5 (stats) are ignored
  }

  _endSession(reason) {
    const s = this.session; if (!s) return;
    this.session = null;
    clearInterval(s.timer); clearInterval(s.audioTimer); clearInterval(s.audioDrain);
    for (const u of s.udp) { try { u.close(); } catch { /* ignore */ } }
    if (s.mirrorSock) s.mirrorSock.destroy();
    if (s.mirrorServer) s.mirrorServer.close();
    this.log(`session ended (${reason})`);
    this.emit('ended', reason);
  }
}

module.exports = { AirPlayReceiver, PORTS, makeAacDecoder };
