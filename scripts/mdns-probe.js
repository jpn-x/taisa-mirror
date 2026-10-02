'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
// TAISA Mirror (https://github.com/jpn-x/taisa-mirror). AirPlay protocol handling follows UxPlay (GPL-3.0); see THIRD_PARTY_NOTICES.md.
// Sends an mDNS PTR query and prints AirPlay-related answers seen on the LAN (debug helper).
const dgram = require('dgram');
const { decName, encName, ifaces } = require('../server/mdns');
const name = process.argv[2] || '_airplay._tcp.local';
const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
const seen = new Set();
s.on('message', (msg, r) => {
  if (!(msg.readUInt16BE(2) & 0x8000)) return;
  try {
    let pos = 12; const qd = msg.readUInt16BE(4), an = msg.readUInt16BE(6) + msg.readUInt16BE(8) + msg.readUInt16BE(10);
    for (let i = 0; i < qd; i++) pos = decName(msg, pos).end + 4;
    for (let i = 0; i < an; i++) {
      const n = decName(msg, pos); pos = n.end; const type = msg.readUInt16BE(pos), len = msg.readUInt16BE(pos + 8); pos += 10;
      let v = '';
      if (type === 12) v = decName(msg, pos).name; else if (type === 1) v = [...msg.subarray(pos, pos + 4)].join('.');
      else if (type === 33) v = `port ${msg.readUInt16BE(pos + 4)} -> ${decName(msg, pos + 6).name}`;
      else if (type === 16) { const parts = []; let p = pos; while (p < pos + len) { const l = msg[p]; parts.push(msg.toString('utf8', p + 1, p + 1 + l)); p += 1 + l; } v = parts.slice(0, 4).join(' | ') + ' ...'; }
      const line = `${r.address}  type${type}  ${n.name}  ${v}`;
      if (!seen.has(line)) { seen.add(line); console.log(line); }
      pos += len;
    }
  } catch (e) { /* ignore */ }
});
s.bind(5353, '0.0.0.0', () => {
  for (const i of ifaces()) { try { s.addMembership('224.0.0.251', i.address); } catch {} }
  const h = Buffer.alloc(12); h.writeUInt16BE(1, 4);
  const q = Buffer.concat([h, encName(name), Buffer.from([0, 12, 0x80, 1])]);
  for (const i of ifaces()) { s.setMulticastInterface(i.address); s.send(q, 5353, '224.0.0.251'); }
  setTimeout(() => process.exit(0), 2500);
});
