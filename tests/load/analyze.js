// node analyze.js out-*.jsonl  [--windows t0,t1,label;t0,t1,label] [--md]
// Per RPC: count, p50/p95/p99 ms, HTTP error % (5xx, 429, timeouts, net), app errors (4xx with a message), inner bundle errors.
const fs = require("fs");
const args = process.argv.slice(2), files = args.filter((a) => !a.startsWith("--") && fs.existsSync(a));
const wArg = (args.find((a) => a.startsWith("--windows=")) || "").slice(10);
const rows = [];
for (const f of files) for (const l of fs.readFileSync(f, "utf8").split("\n")) { if (!l) continue; try { rows.push(JSON.parse(l)); } catch (e) {} }
const q = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
function active(t) { return actUsers.filter(([a, b]) => a <= t && t <= b).length; }
const st = {}, en = {};
for (const r of rows) { const k = r.s + ":" + r.u; if (r.n === "user_start") st[k] = r.t; if (r.n === "user_end") en[k] = r.t; }
const lastT = Math.max(...rows.map((r) => r.t || 0));
const actUsers = Object.keys(st).map((k) => [st[k], en[k] || lastT]);
function table(t0, t1, label) {
  const req = rows.filter((r) => r.ms != null && r.t >= t0 && r.t < t1 && !/^auth_signup$/.test(r.n));
  const by = {};
  for (const r of req) {
    const b = by[r.n] || (by[r.n] = { n: r.n, ms: [], c: 0, e5: 0, e429: 0, to: 0, net: 0, app: 0, codes: {} });
    b.c++; b.ms.push(r.ms);
    if (r.e === "timeout") b.to++; else if (r.e) b.net++;
    else if (r.st === 429) b.e429++; else if (r.st >= 500) b.e5++; else if (r.st >= 400) { b.app++; b.codes[r.ae] = (b.codes[r.ae] || 0) + 1; }
  }
  const inner = {};
  for (const r of rows) if (r.ie && r.t >= t0 && r.t < t1) { const k = r.n + " " + r.ie; inner[k] = (inner[k] || 0) + 1; }
  const all = { n: "ALL", ms: req.map((r) => r.ms), c: req.length, e5: 0, e429: 0, to: 0, net: 0, app: 0 };
  for (const b of Object.values(by)) for (const k of ["e5", "e429", "to", "net", "app"]) all[k] += b[k];
  const mid = (t0 + t1) / 2, users = [];
  for (let t = t0; t < t1; t += 30000) users.push(active(t));
  const cpu = rows.filter((r) => r.n === "client_cpu" && r.t >= t0 && r.t < t1);
  const maxCpu = {}; for (const c of cpu) maxCpu[c.s] = Math.max(maxCpu[c.s] || 0, c.pct);
  const list = [all, ...Object.values(by).sort((a, b) => q(b.ms, 0.95) - q(a.ms, 0.95))];
  const secs = (t1 - t0) / 1000;
  let s = `\n### ${label}\nActive users: ${Math.min(...users)}–${Math.max(...users)} (mean ${Math.round(users.reduce((a, b) => a + b, 0) / users.length)}). ` +
    `Requests: ${req.length} in ${Math.round(secs)} s = ${(req.length / secs).toFixed(1)} req/s. Client CPU max per shard: ${Math.max(0, ...Object.values(maxCpu)).toFixed(0)} %.\n\n`;
  s += "| RPC | calls | p50 ms | p95 ms | p99 ms | max ms | HTTP err % | 429 | timeouts | net | app 4xx |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n";
  for (const b of list) {
    if (b !== all && b.c < 5 && q(b.ms, 0.95) < 500) continue;
    const he = b.e5 + b.e429 + b.to + b.net;
    s += `| ${b.n} | ${b.c} | ${q(b.ms, 0.5)} | ${q(b.ms, 0.95)} | ${q(b.ms, 0.99)} | ${Math.max(0, ...b.ms)} | ${(100 * he / Math.max(1, b.c)).toFixed(2)} | ${b.e429} | ${b.to} | ${b.net} | ${b.app}${b.app && b.codes ? " (" + Object.entries(b.codes).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => k + "×" + v).join(", ") + ")" : ""} |\n`;
  }
  const ie = Object.entries(inner).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (ie.length) s += "\nErrors inside rpc_bundle2 answers: " + ie.map(([k, v]) => "`" + k + "` ×" + v).join("; ") + "\n";
  return s;
}
let out = "";
if (wArg) for (const w of wArg.split(";")) { const [a, b, l] = w.split(","); out += table(+a, +b, l); }
else { const t0 = Math.min(...rows.filter((r) => r.n === "user_start").map((r) => r.t)); out += table(t0, lastT + 1, "whole run"); }
// per minute curve
if (args.includes("--curve")) {
  const t0 = Math.min(...rows.filter((r) => r.n === "user_start").map((r) => r.t));
  out += "\n| minute | users | req/s | p50 | p95 | p99 | err % |\n|---:|---:|---:|---:|---:|---:|---:|\n";
  for (let t = t0; t < lastT; t += 60000) {
    const req = rows.filter((r) => r.ms != null && r.t >= t && r.t < t + 60000);
    const ms = req.map((r) => r.ms), er = req.filter((r) => r.e || r.st === 429 || r.st >= 500).length;
    out += `| ${Math.round((t - t0) / 60000)} | ${active(t + 30000)} | ${(req.length / 60).toFixed(1)} | ${q(ms, .5)} | ${q(ms, .95)} | ${q(ms, .99)} | ${(100 * er / Math.max(1, req.length)).toFixed(2)} |\n`;
  }
}
console.log(out);
