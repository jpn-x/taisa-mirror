'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
// Audio M2 check: decodes the AAC-ELD frames recorded by the M1 test (data/audio-m1.bin) with engine/aac_eld.wasm
// and writes a normal WAV file you can double-click to listen to.  node scripts/decode-dump.js [dump] [out.wav]
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const dump = fs.readFileSync(process.argv[2] || path.join(root, 'data', 'audio-m1.bin'));
const outFile = process.argv[3] || path.join(root, 'data', 'audio-m2.wav');
const wasi = new Proxy({}, { get: (_t, n) => n === 'proc_exit' ? (c) => { throw new Error('wasm exit ' + c); } : () => 0 });
const mod = new WebAssembly.Module(fs.readFileSync(path.join(root, 'engine', 'aac_eld.wasm')));
const x = new WebAssembly.Instance(mod, { wasi_snapshot_preview1: wasi, env: new Proxy({}, { get: () => () => 0 }) }).exports;
const mem = () => new Uint8Array(x.memory.buffer);
const ASC = Buffer.from('f8e85000', 'hex');   // AAC-ELD, 44.1 kHz, stereo, 480 samples per frame
const inP = x.mx_in_ptr(), outP = x.mx_out_ptr();
mem().set(ASC, inP);
const r = x.mx_aac_init(ASC.length, 44100, 2);
if (r !== 0) { console.error('decoder init failed:', r); process.exit(1); }
const frames = []; let off = 0, ok = 0, bad = 0, firstErr = null;
while (off + 6 <= dump.length) {
  const len = dump.readUInt32BE(off), seq = dump.readUInt16BE(off + 4); off += 6;
  const f = dump.subarray(off, off + len); off += len;
  mem().set(f, inP);
  const n = x.mx_aac_decode(len);
  if (n > 0) { frames.push(Buffer.from(mem().slice(outP, outP + n * 4))); ok++; } else { bad++; if (firstErr === null) firstErr = `seq ${seq}: ${n}`; }
}
const pcm = Buffer.concat(frames);
const hdr = Buffer.alloc(44);
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVEfmt ', 8); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20);
hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(44100, 24); hdr.writeUInt32LE(44100 * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34);
hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
fs.writeFileSync(outFile, Buffer.concat([hdr, pcm]));
let peak = 0, sum = 0; for (let i = 0; i + 1 < pcm.length; i += 2) { const v = Math.abs(pcm.readInt16LE(i)); if (v > peak) peak = v; sum += v * v; }
console.log(`frames decoded=${ok} failed=${bad}${firstErr ? ' (first: ' + firstErr + ')' : ''} seconds=${(pcm.length / 4 / 44100).toFixed(2)} peak=${peak} rms=${Math.round(Math.sqrt(sum / (pcm.length / 2 || 1)))}`);
console.log('wrote', outFile);
