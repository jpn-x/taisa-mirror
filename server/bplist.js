'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
// TAISA Mirror (https://github.com/jpn-x/taisa-mirror). AirPlay protocol handling follows UxPlay (GPL-3.0); see THIRD_PARTY_NOTICES.md.
// Minimal binary plist (bplist00) reader/writer. Zero dependencies.

class Real { constructor(v) { this.value = v; } }

function parse(buf) {
  if (buf.length < 40 || buf.toString('latin1', 0, 8) !== 'bplist00') throw new Error('not a bplist');
  const t = buf.length - 32;
  const offSize = buf[t + 6], refSize = buf[t + 7];
  const num = Number(buf.readBigUInt64BE(t + 8));
  const top = Number(buf.readBigUInt64BE(t + 16));
  const tableOff = Number(buf.readBigUInt64BE(t + 24));
  const uint = (pos, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + buf[pos + i]; return v; };
  const offsets = [];
  for (let i = 0; i < num; i++) offsets.push(uint(tableOff + i * offSize, offSize));

  function readInt(pos) {
    const n = 1 << (buf[pos] & 0x0f);
    if (n === 16) return { v: buf.readBigUInt64BE(pos + 9), len: 17 };
    if (n === 8) {
      const b = buf.readBigUInt64BE(pos + 1);
      return { v: b <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(b) : b, len: 9 };
    }
    return { v: uint(pos + 1, n), len: 1 + n };
  }
  function lenOf(pos, low) {
    if (low !== 0x0f) return { n: low, start: pos + 1 };
    const r = readInt(pos + 1);
    return { n: Number(r.v), start: pos + 1 + r.len };
  }
  function obj(i, depth) {
    if (depth > 32) throw new Error('bplist too deep');
    const pos = offsets[i];
    const m = buf[pos], hi = m >> 4, lo = m & 0x0f;
    switch (hi) {
      case 0x0: return lo === 8 ? false : lo === 9 ? true : null;
      case 0x1: return readInt(pos).v;
      case 0x2: return lo === 2 ? buf.readFloatBE(pos + 1) : buf.readDoubleBE(pos + 1);
      case 0x3: return new Date(Date.UTC(2001, 0, 1) + buf.readDoubleBE(pos + 1) * 1000);
      case 0x4: { const { n, start } = lenOf(pos, lo); return Buffer.from(buf.subarray(start, start + n)); }
      case 0x5: { const { n, start } = lenOf(pos, lo); return buf.toString('latin1', start, start + n); }
      case 0x6: { const { n, start } = lenOf(pos, lo); return Buffer.from(buf.subarray(start, start + n * 2)).swap16().toString('utf16le'); }
      case 0xa: {
        const { n, start } = lenOf(pos, lo); const a = [];
        for (let k = 0; k < n; k++) a.push(obj(uint(start + k * refSize, refSize), depth + 1));
        return a;
      }
      case 0xd: {
        const { n, start } = lenOf(pos, lo); const d = {};
        for (let k = 0; k < n; k++) {
          const key = obj(uint(start + k * refSize, refSize), depth + 1);
          d[key] = obj(uint(start + (n + k) * refSize, refSize), depth + 1);
        }
        return d;
      }
      default: return null;
    }
  }
  return obj(top, 0);
}

function build(root) {
  const objs = []; // each: Buffer (with refs patched later via closures)
  const REF = 2;
  const encLen = (hi, n) => {
    if (n < 15) return Buffer.from([(hi << 4) | n]);
    return Buffer.concat([Buffer.from([(hi << 4) | 0x0f]), encInt(n)]);
  };
  function encInt(v) {
    if (typeof v === 'bigint') { const b = Buffer.alloc(9); b[0] = 0x13; b.writeBigUInt64BE(BigInt.asUintN(64, v), 1); return b; }
    if (v < 0) { const b = Buffer.alloc(9); b[0] = 0x13; b.writeBigInt64BE(BigInt(v), 1); return b; }
    if (v < 0x100) return Buffer.from([0x10, v]);
    if (v < 0x10000) { const b = Buffer.alloc(3); b[0] = 0x11; b.writeUInt16BE(v, 1); return b; }
    if (v < 0x100000000) { const b = Buffer.alloc(5); b[0] = 0x12; b.writeUInt32BE(v, 1); return b; }
    const b = Buffer.alloc(9); b[0] = 0x13; b.writeBigUInt64BE(BigInt(v), 1); return b;
  }
  function add(v) {
    const idx = objs.length; objs.push(null);
    let out;
    if (v === null || v === undefined) out = Buffer.from([0x00]);
    else if (typeof v === 'boolean') out = Buffer.from([v ? 0x09 : 0x08]);
    else if (v instanceof Real) { out = Buffer.alloc(9); out[0] = 0x23; out.writeDoubleBE(v.value, 1); }
    else if (typeof v === 'bigint' || typeof v === 'number') {
      if (typeof v === 'number' && !Number.isInteger(v)) { out = Buffer.alloc(9); out[0] = 0x23; out.writeDoubleBE(v, 1); }
      else out = encInt(v);
    }
    else if (Buffer.isBuffer(v)) out = Buffer.concat([encLen(0x4, v.length), v]);
    else if (typeof v === 'string') {
      if (/^[\x00-\x7f]*$/.test(v)) out = Buffer.concat([encLen(0x5, v.length), Buffer.from(v, 'latin1')]);
      else { const u = Buffer.from(v, 'utf16le').swap16(); out = Buffer.concat([encLen(0x6, u.length / 2), u]); }
    }
    else if (Array.isArray(v)) {
      const refs = v.map(add);
      out = Buffer.concat([encLen(0xa, v.length), refBuf(refs)]);
    }
    else {
      const keys = Object.keys(v);
      const kr = keys.map(add), vr = keys.map(k => add(v[k]));
      out = Buffer.concat([encLen(0xd, keys.length), refBuf(kr), refBuf(vr)]);
    }
    objs[idx] = out;
    return idx;
  }
  function refBuf(refs) { const b = Buffer.alloc(refs.length * REF); refs.forEach((r, i) => b.writeUInt16BE(r, i * REF)); return b; }
  add(root);
  if (objs.length > 0xffff) throw new Error('bplist too large');
  const head = Buffer.from('bplist00', 'latin1');
  const offsets = []; let pos = head.length;
  for (const o of objs) { offsets.push(pos); pos += o.length; }
  const table = Buffer.alloc(objs.length * 4); offsets.forEach((o, i) => table.writeUInt32BE(o, i * 4));
  const trailer = Buffer.alloc(32);
  trailer[6] = 4; trailer[7] = REF;
  trailer.writeBigUInt64BE(BigInt(objs.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(pos), 24);
  return Buffer.concat([head, ...objs, table, trailer]);
}

module.exports = { parse, build, Real };
