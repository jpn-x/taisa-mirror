'use strict';
// FairPlay SAP handshake pieces needed by AirPlay mirroring (public information, ported from UxPlay, GPL-3.0).
// The heavy part (playfair_decrypt) runs as WebAssembly built in CI from engine/playfair/*.c,
// so no native/unsigned code is ever loaded (Smart App Control friendly).
const fs = require('fs');
const path = require('path');
const replies = require('./fp_tables');

const HEADER = Buffer.from('46504c590301040000000014', 'hex');
let compiled = null;

/** The C code keeps static state between calls, so every decrypt gets a fresh instance (deterministic). */
function loadWasm() {
  if (!compiled) compiled = compileWasm();
  const wasi = new Proxy({}, { get: (_t, name) => name === 'proc_exit' ? (c) => { throw new Error('wasm exit ' + c); } : () => 0 });
  const inst = new WebAssembly.Instance(compiled, { wasi_snapshot_preview1: wasi, env: new Proxy({}, { get: () => () => 0 }) });
  if (inst.exports._initialize) inst.exports._initialize();
  return inst.exports;
}

function compileWasm() {
  const file = path.join(__dirname, '..', 'engine', 'playfair.wasm');
  if (!fs.existsSync(file)) throw new Error('engine/playfair.wasm not found (run the build-wasm workflow, see docs/BUILD.md)');
  return new WebAssembly.Module(fs.readFileSync(file));
}

class FairPlay {
  constructor() { this.keymsg = null; }
  /** phase 1: 16-byte request -> 142-byte reply */
  setup(req) {
    if (req.length !== 16 || req[4] !== 3) return null;
    const mode = req[14];
    if (mode > 3) return null;
    this.keymsg = null;
    return Buffer.from(replies[mode]);
  }
  /** phase 2: 164-byte request -> 32-byte reply */
  handshake(req) {
    if (req.length !== 164 || req[4] !== 3) return null;
    this.keymsg = Buffer.from(req);
    return Buffer.concat([HEADER, req.subarray(144, 164)]);
  }
  /** 72-byte ekey -> 16-byte AES key */
  decrypt(ekey) {
    if (!this.keymsg || ekey.length < 72) return null;
    const w = loadWasm();
    const mem = () => new Uint8Array(w.memory.buffer);
    const m3 = w.pf_m3(), ct = w.pf_ct(), out = w.pf_out();
    mem().set(this.keymsg, m3);
    mem().set(ekey.subarray(0, 72), ct);
    w.pf_decrypt();
    return Buffer.from(mem().slice(out, out + 16));
  }
}

module.exports = { FairPlay, loadWasm };
