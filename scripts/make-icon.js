'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
// Generates assets/taisa-mirror.ico (teal rounded square + white phone outline). Pure Node, no dependencies.
//   node scripts/make-icon.js
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const TEAL = [0x14, 0xb8, 0xa6], WHITE = [255, 255, 255];
const sdRound = (px, py, cx, cy, hw, hh, r) => { // signed distance to a rounded rectangle
  const qx = Math.abs(px - cx) - (hw - r), qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
function render(S) {
  const buf = Buffer.alloc(S * S * 4), SS = 4;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const u = (x + (sx + .5) / SS) / S, v = (y + (sy + .5) / SS) / S;
      if (sdRound(u, v, .5, .5, .5, .5, .22) > 0) continue; // outside the square
      let c = TEAL;
      if (Math.abs(sdRound(u, v, .5, .5, .19, .35, .07)) <= .0275 || Math.hypot(u - .5, v - .73) <= .03) c = WHITE;
      r += c[0]; g += c[1]; b += c[2]; a += 255;
    }
    const n = SS * SS, i = (y * S + x) * 4;
    const cov = a / 255; // number of covered samples
    buf[i] = cov ? Math.round(r / cov) : 0; buf[i + 1] = cov ? Math.round(g / cov) : 0; buf[i + 2] = cov ? Math.round(b / cov) : 0; buf[i + 3] = Math.round((cov / n) * 255);
  }
  return buf;
}
function png(S, rgba) {
  const raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; rgba.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
  const chunk = (type, data) => { const t = Buffer.from(type, 'latin1'), len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0); return Buffer.concat([len, t, data, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const sizes = [16, 32, 48, 64, 128, 256];
const pngs = sizes.map(s => png(s, render(s)));
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let off = 6 + 16 * sizes.length; const dir = [];
sizes.forEach((s, i) => { const e = Buffer.alloc(16); e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(off, 12); off += pngs[i].length; dir.push(e); });
const out = path.join(__dirname, '..', 'assets', 'taisa-mirror.ico');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([head, ...dir, ...pngs]));
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'taisa-mirror-256.png'), pngs[pngs.length - 1]);
console.log('wrote', out, fs.statSync(out).size, 'bytes');
