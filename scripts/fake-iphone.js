'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
// MirrorX (dev codename TAISA MIRROR, https://github.com/jpn-x/taisa-mirror). AirPlay protocol handling follows UxPlay (GPL-3.0); see THIRD_PARTY_NOTICES.md.
// A fake "iPhone" used for end-to-end self tests without a real device.
// It speaks the sender side of the same protocol: pair-setup / pair-verify / fp-setup / SETUP,
// then pushes an encrypted H.264 mirror stream (generated with ffmpeg) at the receiver.
//   node scripts/fake-iphone.js [host] [seconds]
// Requires the receiver (npm start) to be running and in "waiting" state, and ffmpeg on PATH.
const net = require('net');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const bplist = require('../server/bplist');
const { FairPlay } = require('../server/fairplay');

const host = process.argv[2] || '127.0.0.1';
const seconds = parseInt(process.argv[3] || '6', 10);
const loops = parseInt(process.argv[4] || '1', 10); // number of connect/stream/teardown cycles (soak test)
const abrupt = process.argv[5] === 'abrupt';      // drop the TCP connections without TEARDOWN (simulates Wi-Fi loss)
const sha512 = (...p) => { const h = crypto.createHash('sha512'); p.forEach(x => h.update(x)); return h.digest(); };
const rawOf = (k) => Buffer.from(k.export({ format: 'jwk' }).x, 'base64url');
const imp = (t, raw) => crypto.createPublicKey({ key: { kty: 'OKP', crv: t === 'ed' ? 'Ed25519' : 'X25519', x: raw.toString('base64url') }, format: 'jwk' });

function rtsp(sock) {
  let buf = Buffer.alloc(0), cseq = 0, waiting = null;
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    const he = buf.indexOf('\r\n\r\n'); if (he < 0) return;
    const head = buf.toString('latin1', 0, he); const m = /Content-Length: (\d+)/i.exec(head); const n = m ? +m[1] : 0;
    if (buf.length < he + 4 + n) return;
    const body = buf.subarray(he + 4, he + 4 + n); buf = buf.subarray(he + 4 + n);
    const w = waiting; waiting = null; w({ status: head.split('\r\n')[0], head, body });
  });
  return (method, url, body = Buffer.alloc(0), headers = {}) => new Promise(res => {
    waiting = res;
    const h = [`${method} ${url} RTSP/1.0`, `CSeq: ${++cseq}`, 'User-Agent: AirPlay/320.20', ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), `Content-Length: ${body.length}`];
    sock.write(Buffer.concat([Buffer.from(h.join('\r\n') + '\r\n\r\n'), body]));
  });
}

function makeStream() {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=590x1278:rate=30', '-t', String(seconds), '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '4.0',
    '-pix_fmt', 'yuv420p', '-g', '30', '-x264-params', 'slices=1:sliced-threads=0', '-bf', '0', '-f', 'h264', '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + r.stderr);
  const d = r.stdout, nals = []; let i = 0, start = -1;
  for (; i + 3 <= d.length; i++) {
    if (d[i] === 0 && d[i + 1] === 0 && (d[i + 2] === 1 || (d[i + 2] === 0 && d[i + 3] === 1))) {
      const sc = d[i + 2] === 1 ? 3 : 4; if (start >= 0) nals.push(d.subarray(start, i)); start = i + sc; i += sc - 1;
    }
  }
  nals.push(d.subarray(start));
  const sps = nals.find(n => (n[0] & 0x1f) === 7), pps = nals.find(n => (n[0] & 0x1f) === 8);
  const avcc = Buffer.concat([Buffer.from([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 255]), sps, Buffer.from([1, pps.length >> 8, pps.length & 255]), pps]);
  const frames = []; let cur = [];
  for (const n of nals) {
    const t = n[0] & 0x1f; if (t === 7 || t === 8 || t === 9) continue;
    const pre = Buffer.alloc(4); pre.writeUInt32BE(n.length); cur.push(pre, n);
    if (t === 1 || t === 5) { frames.push(Buffer.concat(cur)); cur = []; }
  }
  return { avcc, frames };
}

async function session(stream) {
  const sock = net.connect(7000, host); await new Promise(r => sock.once('connect', r));
  const call = rtsp(sock);
  let r = await call('GET', '/info'); console.log('info', r.status, bplist.parse(r.body).name);
  // pair-setup / pair-verify
  const ed = crypto.generateKeyPairSync('ed25519'), edPub = rawOf(ed.publicKey);
  r = await call('POST', '/pair-setup', edPub, { 'Content-Type': 'application/octet-stream' }); console.log('pair-setup', r.status, r.body.length);
  const x = crypto.generateKeyPairSync('x25519'), xPub = rawOf(x.publicKey);
  r = await call('POST', '/pair-verify', Buffer.concat([Buffer.from([1, 0, 0, 0]), xPub, edPub]), { 'Content-Type': 'application/octet-stream' });
  const srvX = r.body.subarray(0, 32), encSig = r.body.subarray(32, 96);
  const secret = crypto.diffieHellman({ privateKey: x.privateKey, publicKey: imp('x', srvX) });
  const kdf = (s) => sha512(Buffer.from(s), secret).subarray(0, 16);
  const dec = crypto.createDecipheriv('aes-128-ctr', kdf('Pair-Verify-AES-Key'), kdf('Pair-Verify-AES-IV')); const srvSig = dec.update(encSig);
  console.log('pair-verify 1', r.status, 'server signature verified:', !!srvSig.length);
  const enc = crypto.createCipheriv('aes-128-ctr', kdf('Pair-Verify-AES-Key'), kdf('Pair-Verify-AES-IV')); enc.update(Buffer.alloc(64));
  const mySig = enc.update(crypto.sign(null, Buffer.concat([xPub, srvX]), ed.privateKey));
  r = await call('POST', '/pair-verify', Buffer.concat([Buffer.from([0, 0, 0, 0]), mySig]), { 'Content-Type': 'application/octet-stream' }); console.log('pair-verify 2', r.status);
  // fp-setup
  const fp = new FairPlay();
  const p1 = Buffer.from('46504c59030101000000000402000300', 'hex');
  r = await call('POST', '/fp-setup', p1, { 'Content-Type': 'application/octet-stream' });
  console.log('fp-setup 1', r.status, r.body.length);
  const m3 = crypto.randomBytes(164); m3[4] = 3; fp.handshake(m3);
  r = await call('POST', '/fp-setup', m3, { 'Content-Type': 'application/octet-stream' }); console.log('fp-setup 2', r.status, r.body.length);
  // SETUP 1
  const ekey = crypto.randomBytes(72), aes = fp.decrypt(ekey), aesKey = sha512(aes, secret).subarray(0, 16);
  r = await call('SETUP', 'rtsp://127.0.0.1/1', bplist.build({ ekey, eiv: crypto.randomBytes(16), deviceID: 'AA:BB:CC:DD:EE:FF', name: 'Fake iPhone', model: 'iPhone15,2', timingProtocol: 'NTP', timingPort: 49999 }), { 'Content-Type': 'application/x-apple-binary-plist' });
  console.log('setup 1', r.status, bplist.parse(r.body));
  // SETUP 2 (mirror stream)
  const streamId = 123456789012345678n;
  r = await call('SETUP', 'rtsp://127.0.0.1/1', bplist.build({ streams: [{ type: 110, streamConnectionID: streamId }] }), { 'Content-Type': 'application/x-apple-binary-plist' });
  const mp = bplist.parse(r.body).streams[0].dataPort; console.log('setup 2', r.status, 'mirror port', mp);
  r = await call('RECORD', 'rtsp://127.0.0.1/1'); console.log('record', r.status);
  // stream
  const { avcc, frames } = stream;
  const ms = net.connect(mp, host); await new Promise(res => ms.once('connect', res));
  const key = sha512(Buffer.from('AirPlayStreamKey' + streamId), aesKey).subarray(0, 16), iv = sha512(Buffer.from('AirPlayStreamIV' + streamId), aesKey).subarray(0, 16);
  const cipher = crypto.createCipheriv('aes-128-ctr', key, iv);
  const hdr = (size, type, opt) => { const h = Buffer.alloc(128); h.writeUInt32LE(size, 0); h[4] = type; h[6] = opt; h.writeBigUInt64LE(BigInt(Date.now()) * 1000000n, 8); return h; };
  const cfg = hdr(avcc.length, 1, 0x16); cfg.writeFloatLE(590, 16); cfg.writeFloatLE(1278, 20); cfg.writeFloatLE(590, 40); cfg.writeFloatLE(1278, 44); cfg.writeFloatLE(590, 56); cfg.writeFloatLE(1278, 60);
  ms.write(Buffer.concat([cfg, avcc]));
  for (const f of frames) {
    ms.write(Buffer.concat([hdr(f.length, 0, 0), cipher.update(f)]));
    await new Promise(r => setTimeout(r, 33));
  }
  await new Promise(r => setTimeout(r, 300));
  if (!abrupt) { r = await call('TEARDOWN', 'rtsp://127.0.0.1/1', bplist.build({ streams: [{ type: 110 }] })); console.log('teardown', r.status); }
  sock.destroy(); ms.destroy();
}

(async () => {
  const stream = makeStream(); console.log(`generated ${stream.frames.length} frames, avcC ${stream.avcc.length}B`);
  for (let i = 1; i <= loops; i++) { if (loops > 1) console.log(`--- session ${i}/${loops}`); await session(stream); await new Promise(r => setTimeout(r, 400)); }
  console.log('DONE');
})().catch(e => { console.error('FAILED', e); process.exit(1); });
