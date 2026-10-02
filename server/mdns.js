'use strict';
// Tiny mDNS / DNS-SD responder (RFC 6762/6763) for advertising _raop._tcp and _airplay._tcp.
// Zero dependencies. Only answers questions about our own names. Nothing leaves the LAN.
const dgram = require('dgram');
const os = require('os');

const MDNS_ADDR = '224.0.0.251', MDNS_PORT = 5353;
const T = { A: 1, PTR: 12, TXT: 16, SRV: 33, ANY: 255 };

function encName(name) {
  const parts = name.split('.').filter(Boolean);
  const bufs = parts.map(p => { const b = Buffer.from(p, 'utf8'); if (b.length > 63) throw new Error('label too long'); return Buffer.concat([Buffer.from([b.length]), b]); });
  return Buffer.concat([...bufs, Buffer.from([0])]);
}
function decName(buf, pos) {
  const labels = []; let jumped = false, end = pos, guard = 0;
  while (guard++ < 64) {
    const len = buf[pos];
    if (len === undefined) throw new Error('truncated');
    if (len === 0) { if (!jumped) end = pos + 1; break; }
    if ((len & 0xc0) === 0xc0) { const ptr = ((len & 0x3f) << 8) | buf[pos + 1]; if (!jumped) end = pos + 2; jumped = true; pos = ptr; continue; }
    labels.push(buf.toString('utf8', pos + 1, pos + 1 + len)); pos += 1 + len;
  }
  return { name: labels.join('.'), end };
}
function rr(name, type, ttl, rdata, flush) {
  const h = Buffer.alloc(10);
  h.writeUInt16BE(type, 0); h.writeUInt16BE(flush ? 0x8001 : 1, 2); h.writeUInt32BE(ttl, 4); h.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([encName(name), h, rdata]);
}
function txtRdata(obj) {
  const parts = Object.entries(obj).map(([k, v]) => { const b = Buffer.from(`${k}=${v}`, 'utf8'); if (b.length > 255) throw new Error('txt too long'); return Buffer.concat([Buffer.from([b.length]), b]); });
  return parts.length ? Buffer.concat(parts) : Buffer.from([0]);
}

function ifaces() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) continue; // private LAN only (skips VPN/CGNAT/link-local)
      const ip = a.address.split('.').map(Number), m = a.netmask.split('.').map(Number);
      out.push({ name, address: a.address, net: ip.map((x, i) => x & m[i]).join('.'), mask: m });
    }
  }
  return out;
}
const sameSubnet = (ifc, addr) => { const a = addr.split('.').map(Number); return ifc.mask.every((m, i) => (a[i] & m) === Number(ifc.net.split('.')[i])); };

class MdnsAdvertiser {
  /** services: [{ type:'_raop._tcp', instance:'..', port, txt:{} }]; host: 'taisa-mirror-ab12' */
  constructor({ host, services, log }) {
    this.host = host + '.local'; this.services = services; this.log = log || (() => {});
    this.sock = null; this.timers = [];
  }
  start() {
    return new Promise((resolve, reject) => {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.sock = s;
      s.on('error', e => { this.log('mdns error: ' + e.message); reject(e); });
      s.on('message', (msg, rinfo) => { try { this._onMessage(msg, rinfo); } catch (e) { /* ignore malformed */ } });
      s.bind(MDNS_PORT, '0.0.0.0', () => {
        try {
          s.setMulticastTTL(255); s.setMulticastLoopback(true);
          this.ifs = ifaces();
          for (const i of this.ifs) { try { s.addMembership(MDNS_ADDR, i.address); } catch (e) { this.log(`mdns join ${i.address} failed: ${e.message}`); } }
          this._announce(120);
          this.timers.push(setTimeout(() => this._announce(120), 1000), setTimeout(() => this._announce(120), 3000));
          resolve(this.ifs);
        } catch (e) { reject(e); }
      });
    });
  }
  stop() {
    this.timers.forEach(clearTimeout); this.timers = [];
    if (!this.sock) return Promise.resolve();
    const s = this.sock; this.sock = null;
    try { this._announce(0, s); } catch { /* ignore */ }
    return new Promise(res => setTimeout(() => { try { s.close(); } catch { /* ignore */ } res(); }, 150));
  }
  _records(ifc, ttl) {
    const answers = [], extra = [];
    answers.push(rr('_services._dns-sd._udp.local', T.PTR, ttl, encName(this.services[0].type + '.local')));
    for (const sv of this.services) {
      const full = `${sv.instance}.${sv.type}.local`;
      answers.push(rr(`${sv.type}.local`, T.PTR, ttl, encName(full)));
      const srv = Buffer.alloc(6); srv.writeUInt16BE(0, 0); srv.writeUInt16BE(0, 2); srv.writeUInt16BE(sv.port, 4);
      extra.push(rr(full, T.SRV, ttl, Buffer.concat([srv, encName(this.host)]), true));
      extra.push(rr(full, T.TXT, ttl, txtRdata(sv.txt), true));
    }
    extra.push(rr(this.host, T.A, ttl, Buffer.from(ifc.address.split('.').map(Number)), true));
    return { answers, extra };
  }
  _packet(ifc, ttl) {
    const { answers, extra } = this._records(ifc, ttl);
    const h = Buffer.alloc(12); h.writeUInt16BE(0x8400, 2); h.writeUInt16BE(answers.length, 6); h.writeUInt16BE(extra.length, 10);
    return Buffer.concat([h, ...answers, ...extra]);
  }
  _announce(ttl, sock = this.sock) {
    if (!sock) return;
    for (const ifc of this.ifs || []) {
      try { sock.setMulticastInterface(ifc.address); sock.send(this._packet(ifc, ttl), MDNS_PORT, MDNS_ADDR); } catch (e) { this.log(`mdns send ${ifc.address}: ${e.message}`); }
    }
  }
  _onMessage(msg, rinfo) {
    if (!this.sock || msg.length < 12 || (msg.readUInt16BE(2) & 0x8000)) return; // only queries
    const qd = msg.readUInt16BE(4); let pos = 12; const mine = new Set([
      '_services._dns-sd._udp.local', this.host,
      ...this.services.flatMap(s => [`${s.type}.local`, `${s.instance}.${s.type}.local`])].map(x => x.toLowerCase()));
    let hit = false; const asked = [];
    for (let i = 0; i < qd; i++) {
      const { name, end } = decName(msg, pos); pos = end + 4;
      if (mine.has(name.toLowerCase())) { hit = true; asked.push(name); }
    }
    if (!hit) return;
    this.log(`mdns query from ${rinfo.address}: ${asked.join(', ')}`);
    const ifc = (this.ifs || []).find(i => sameSubnet(i, rinfo.address));
    if (!ifc) return; // not from our LAN
    const pkt = this._packet(ifc, 120);
    this.sock.setMulticastInterface(ifc.address);
    this.sock.send(pkt, MDNS_PORT, MDNS_ADDR);
    if (rinfo.port !== MDNS_PORT) this.sock.send(pkt, rinfo.port, rinfo.address); // legacy unicast resolver
  }
}

module.exports = { MdnsAdvertiser, ifaces, decName, encName };
