'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
// MirrorX (dev codename TAISA MIRROR, https://github.com/jpn-x/taisa-mirror). AirPlay protocol handling follows UxPlay (GPL-3.0); see THIRD_PARTY_NOTICES.md.
// Tiny control client for tests: node scripts/ctl.js start|cancel|disconnect|status
const net = require('net');
const cmd = process.argv[2] || 'status';
const s = net.connect(7878, '127.0.0.1');
s.on('error', e => { console.error('not running: ' + e.message); process.exit(1); });
s.write('GET /ws HTTP/1.1\r\nHost: 127.0.0.1:7878\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
let got = false;
s.on('data', d => {
  if (!got) {
    got = true;
    if (cmd !== 'status') { const p = Buffer.from(JSON.stringify({ cmd })), m = Buffer.from([1, 2, 3, 4]); s.write(Buffer.concat([Buffer.from([0x81, 0x80 | p.length]), m, Buffer.from(p.map((b, i) => b ^ m[i & 3]))])); }
    setTimeout(() => process.exit(0), 600);
  }
  const t = d.toString('utf8'); const i = t.indexOf('{"type":"status"'); if (i >= 0) console.log(t.slice(i, t.indexOf('}', i) + 1));
});
