// Makes docs/season/tree.glb: the real 3D Christmas tree for the tilted map (lane seasons, owner I-117: "I would like the
// real 3D tree"). No downloads, no assets: the mesh is built here (glTF 2.0 binary, Y up, metres: about 11 m tall).
// Mapbox GL JS 3.32 model layer needs an index list and TEXCOORD_0 on every primitive (round 3 note). Usage:
//   node scripts/make-tree-glb.mjs [out]      (default docs/season/tree.glb; prints the size; must stay under 150 KB)
import fs from "node:fs";
import path from "node:path";

const OUT = process.argv[2] || "docs/season/tree.glb";
const TAU = Math.PI * 2;
let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

// one primitive = { pos: [], nrm: [], uv: [], idx: [], mat }
function prim(mat) { return { pos: [], nrm: [], uv: [], idx: [], mat }; }
function vert(p, x, y, z, nx, ny, nz) { const l = Math.hypot(nx, ny, nz) || 1; p.pos.push(x, y, z); p.nrm.push(nx / l, ny / l, nz / l); p.uv.push(0, 0); return p.pos.length / 3 - 1; }
function tri(p, a, b, c) { p.idx.push(a, b, c); }
// a cone tier with a jagged (branchy) rim, open at the top
function tier(p, y0, y1, r, n, drop) {
  const top = vert(p, 0, y1, 0, 0, 1, 0);
  const rim = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU, rr = r * (i % 2 ? 0.78 : 1) * (0.94 + rnd() * 0.12), yy = y0 - (i % 2 ? 0 : drop);
    rim.push(vert(p, Math.cos(a) * rr, yy, Math.sin(a) * rr, Math.cos(a), r / (y1 - y0) * 0.9, Math.sin(a)));
  }
  for (let i = 0; i < n; i++) tri(p, top, rim[i + 1], rim[i]);
  // the underside (a flat ring towards the trunk), so the tier is not hollow from below
  const c = vert(p, 0, y0 + 0.3, 0, 0, -1, 0);
  for (let i = 0; i < n; i++) tri(p, c, rim[i], rim[i + 1]);
}
function cylinder(p, r, y0, y1, n) {
  const a0 = [], a1 = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * TAU; a0.push(vert(p, Math.cos(a) * r, y0, Math.sin(a) * r, Math.cos(a), 0, Math.sin(a))); a1.push(vert(p, Math.cos(a) * r * 0.85, y1, Math.sin(a) * r * 0.85, Math.cos(a), 0, Math.sin(a))); }
  for (let i = 0; i < n; i++) { tri(p, a0[i], a1[i], a0[i + 1]); tri(p, a0[i + 1], a1[i], a1[i + 1]); }
}
function ball(p, cx, cy, cz, r, seg) {   // a low-poly sphere
  const rows = seg, cols = seg * 2, base = [];
  for (let i = 0; i <= rows; i++) { const v = i / rows, ph = v * Math.PI; base.push([]);
    for (let j = 0; j <= cols; j++) { const u = j / cols, th = u * TAU, x = Math.sin(ph) * Math.cos(th), y = Math.cos(ph), z = Math.sin(ph) * Math.sin(th); base[i].push(vert(p, cx + x * r, cy + y * r, cz + z * r, x, y, z)); } }
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { tri(p, base[i][j], base[i + 1][j], base[i][j + 1]); tri(p, base[i][j + 1], base[i + 1][j], base[i + 1][j + 1]); }
}
function star(p, cy, r) {   // a 5-point star, thick, facing both ways
  const pts = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.42 : r; pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
  for (const s of [1, -1]) { const c = vert(p, 0, cy, 0.18 * s, 0, 0, s); const v = pts.map(([x, y]) => vert(p, x, cy - y, 0.02 * s, 0, 0, s));
    for (let i = 0; i < 10; i++) s > 0 ? tri(p, c, v[i], v[(i + 1) % 10]) : tri(p, c, v[(i + 1) % 10], v[i]); }
}

const M = {
  green: { name: "needles", pbrMetallicRoughness: { baseColorFactor: [0.09, 0.42, 0.17, 1], metallicFactor: 0, roughnessFactor: 0.85 } },
  snow: { name: "snow", pbrMetallicRoughness: { baseColorFactor: [0.93, 0.96, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
  trunk: { name: "trunk", pbrMetallicRoughness: { baseColorFactor: [0.33, 0.2, 0.09, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
  gold: { name: "star", pbrMetallicRoughness: { baseColorFactor: [1, 0.78, 0.2, 1], metallicFactor: 0.6, roughnessFactor: 0.35 }, emissiveFactor: [1, 0.75, 0.2] },
  red: { name: "red balls", pbrMetallicRoughness: { baseColorFactor: [0.85, 0.08, 0.12, 1], metallicFactor: 0.4, roughnessFactor: 0.3 }, emissiveFactor: [0.45, 0.02, 0.04] },
  blue: { name: "blue balls", pbrMetallicRoughness: { baseColorFactor: [0.2, 0.55, 0.95, 1], metallicFactor: 0.4, roughnessFactor: 0.3 }, emissiveFactor: [0.08, 0.22, 0.45] },
  light: { name: "lights", pbrMetallicRoughness: { baseColorFactor: [1, 0.93, 0.7, 1], metallicFactor: 0, roughnessFactor: 0.5 }, emissiveFactor: [1, 0.85, 0.5] }
};
const P = { green: prim("green"), snow: prim("snow"), trunk: prim("trunk"), gold: prim("gold"), red: prim("red"), blue: prim("blue"), light: prim("light") };
cylinder(P.trunk, 0.42, 0, 1.6, 10);
const T = [[1.2, 4.4, 3.6], [3.2, 6.4, 2.9], [5.0, 8.3, 2.2], [6.8, 10.2, 1.45]];
T.forEach(([y0, y1, r], i) => {
  tier(P.green, y0, y1, r, 24, 0.35);
  tier(P.snow, y0 + 0.12, y0 + 0.12 + (y1 - y0) * 0.18, r * 0.98, 24, 0.33);   // a snowy rim
  for (let k = 0; k < 5 + i; k++) { const a = rnd() * TAU, rr = r * 0.82, y = y0 + 0.15; ball(k % 2 ? P.red : P.blue, Math.cos(a) * rr, y, Math.sin(a) * rr, 0.24, 4); }
  for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU + i, u = 0.35 + 0.5 * ((k * 7) % 12) / 12, rr = r * (1 - u) * 0.98, y = y0 + (y1 - y0) * u; ball(P.light, Math.cos(a) * rr, y, Math.sin(a) * rr, 0.12, 3); }
});
star(P.gold, 10.8, 0.85);

// ---------- pack (one buffer, one bufferView per accessor, 4-byte aligned) ----------
const prims = Object.values(P).filter((p) => p.idx.length);
const chunks = [], views = [], accs = [], meshPrims = [], mats = [];
let off = 0;
function addView(buf, target) { const pad = (4 - (buf.length % 4)) % 4; chunks.push(buf, Buffer.alloc(pad)); views.push({ buffer: 0, byteOffset: off, byteLength: buf.length, target }); off += buf.length + pad; return views.length - 1; }
function bounds(a) { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], a[i + k]); mx[k] = Math.max(mx[k], a[i + k]); } return [mn, mx]; }
for (const p of prims) {
  const n = p.pos.length / 3, [mn, mx] = bounds(p.pos);
  const pv = addView(Buffer.from(new Float32Array(p.pos).buffer), 34962); accs.push({ bufferView: pv, componentType: 5126, count: n, type: "VEC3", min: mn, max: mx }); const ap = accs.length - 1;
  const nv = addView(Buffer.from(new Float32Array(p.nrm).buffer), 34962); accs.push({ bufferView: nv, componentType: 5126, count: n, type: "VEC3" }); const an = accs.length - 1;
  const uv = addView(Buffer.from(new Float32Array(p.uv).buffer), 34962); accs.push({ bufferView: uv, componentType: 5126, count: n, type: "VEC2" }); const au = accs.length - 1;
  const iv = addView(Buffer.from(new Uint16Array(p.idx).buffer), 34963); accs.push({ bufferView: iv, componentType: 5123, count: p.idx.length, type: "SCALAR" }); const ai = accs.length - 1;
  let mi = mats.indexOf(M[p.mat]); if (mi < 0) { mats.push(M[p.mat]); mi = mats.length - 1; }
  meshPrims.push({ attributes: { POSITION: ap, NORMAL: an, TEXCOORD_0: au }, indices: ai, material: mi, mode: 4 });
}
const bin = Buffer.concat(chunks);
const json = { asset: { version: "2.0", generator: "PintsNow make-tree-glb.mjs" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: "tree" }],
  meshes: [{ name: "tree", primitives: meshPrims }], materials: mats, accessors: accs, bufferViews: views, buffers: [{ byteLength: bin.length }] };
let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const total = 12 + 8 + js.length + 8 + bin.length, head = Buffer.alloc(12);
head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([head, jh, js, bh, bin]));
const tris = prims.reduce((a, p) => a + p.idx.length / 3, 0);
console.log(OUT + ": " + (total / 1024).toFixed(1) + " KB, " + tris + " triangles, " + prims.length + " primitives");
if (total > 150 * 1024) { console.error("too big (> 150 KB)"); process.exit(1); }
