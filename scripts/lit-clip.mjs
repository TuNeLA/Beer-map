// Öl Nu — 🏠 "only the part near the bar lights up" (CONTRACT "BAREA · krogens yta").
// Used by scripts/bar-buildings.mjs at build time, so phones get small polygons.
//
// litPart(polys, lat, lng) → { k: "whole" | "part", polys, area, full, r? }
//   polys = [[outer, hole, …], …] in [lng, lat] (GeoJSON order, rings closed or open).
//   - building area < SMALL_M2 (600 m²)  → the whole building
//   - else: anchor = the bar point if it is inside the building, else the nearest wall point;
//     building ∩ disk(anchor, r) with r adaptive in [R_MIN, R_MAX] (10–14 m) so that ≈ TARGET_M2 is lit
//     (a point deep inside: r = 10 → ~314 m²; a point at a wall: r ≈ 13 → ~260 m²). If the part would be ≥ 75 %
//     of the house anyway, the whole house is kept.
//   The clip follows the building's real walls; the cut side is a smooth arc (one point per ≤ 12°: ≤ 0.1 m off a true circle).
//   It is an exact disk ∩ polygon clip (any concave polygon with holes; several parts stay separate rings).
export const SMALL_M2 = 600, R_MIN = 10, R_MAX = 14, TARGET_M2 = 260, WHOLE_SHARE = 0.75;
const RAD = Math.PI / 180, R_EARTH = 6371000, ARC_STEP = 12 * RAD;

/* ---------- local metres ---------- */
function frame(lat0, lng0) {
  const kx = Math.cos(lat0 * RAD) * RAD * R_EARTH, ky = RAD * R_EARTH;
  return {
    to: (p) => [(p[0] - lng0) * kx, (p[1] - lat0) * ky],
    from: (q) => [lng0 + q[0] / kx, lat0 + q[1] / ky],
  };
}
const open = (r) => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r.slice());
export function signedArea(r) {   // metres, open ring
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
function inRing(pt, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
const inAll = (pt, rings) => rings.reduce((c, r) => (inRing(pt, r) ? !c : c), false);   // even-odd over every ring
function nearestOnRings(rings) {   // nearest boundary point to the origin
  let best = null, bd = Infinity;
  for (const r of rings) for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
    let t = l ? -(a[0] * dx + a[1] * dy) / l : 0; t = Math.max(0, Math.min(1, t));
    const x = a[0] + t * dx, y = a[1] + t * dy, d = x * x + y * y;
    if (d < bd) { bd = d; best = [x, y]; }
  }
  return best;
}

/* ---------- disk ∩ polygon (centre = origin) ----------
   Rings oriented interior-left (outer CCW, holes CW). Walk each ring; at every crossing of the circle note an
   entry (outside → inside) or an exit. Output = from an entry follow the ring to its next exit, then follow the
   circle counter-clockwise to the next crossing (always an entry), and so on until the ring closes. Rings that never
   cross the circle are kept when inside it; the full circle is kept when it crosses nothing and lies inside. */
export function clipDisk(rings, r) {
  rings = rings.map((x) => x.slice()).filter((x) => x.length >= 3);
  // keep vertices off the circle (degenerate touches) — nudge the radius by a millimetre
  for (let k = 0; k < 8 && rings.some((x) => x.some((p) => Math.abs(Math.hypot(p[0], p[1]) - r) < 1e-4)); k++) r += 1e-3;
  const nodes = [], cross = [];   // per ring: [{p, x?:{type, th, ring, i}}]
  rings.forEach((ring, ri) => {
    const list = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      list.push({ p: a });
      const dx = b[0] - a[0], dy = b[1] - a[1], A = dx * dx + dy * dy;
      if (!A) continue;
      const B = 2 * (a[0] * dx + a[1] * dy), C = a[0] * a[0] + a[1] * a[1] - r * r, D = B * B - 4 * A * C;
      if (D <= 1e-12) continue;   // misses or only touches
      const s = Math.sqrt(D), ts = [(-B - s) / (2 * A), (-B + s) / (2 * A)].filter((t) => t > 0 && t < 1);
      let inside = C < 0;
      for (const t of ts) {
        const p = [a[0] + t * dx, a[1] + t * dy];
        const x = { type: inside ? "exit" : "entry", th: Math.atan2(p[1], p[0]), ring: ri, used: false };
        inside = !inside;
        const n = { p, x }; x.node = n; list.push(n); cross.push(x);
      }
    }
    list.forEach((n, i) => { n.i = i; });
    nodes.push(list);
  });
  const out = [];
  const arc = (t0, t1) => {   // points strictly between angles t0 → t1 (CCW)
    let d = t1 - t0; while (d <= 0) d += 2 * Math.PI;
    const n = Math.max(1, Math.ceil(d / ARC_STEP)), pts = [];
    for (let k = 1; k < n; k++) { const t = t0 + (d * k) / n; pts.push([r * Math.cos(t), r * Math.sin(t)]); }
    return pts;
  };
  const nextOnCircle = (x) => {
    let best = null, bd = Infinity;
    for (const y of cross) { if (y === x) continue; let d = y.th - x.th; while (d <= 1e-12) d += 2 * Math.PI; if (d < bd) { bd = d; best = y; } }
    return best;
  };
  for (const start of cross) {
    if (start.type !== "entry" || start.used) continue;
    const ring = []; let cur = start, guard = 0;
    while (guard++ < 100000) {
      cur.used = true;
      const list = nodes[cur.ring]; let i = cur.node.i;
      ring.push(cur.node.p);
      // along the ring to the next crossing (an exit)
      let ex = null;
      for (let k = 1; k <= list.length; k++) {
        const n = list[(i + k) % list.length];
        if (n.x) { ex = n.x; break; }
        ring.push(n.p);
      }
      if (!ex) break;
      ex.used = true; ring.push(ex.node.p);
      const nx = nextOnCircle(ex);
      if (!nx) break;
      ring.push(...arc(ex.th, nx.th));
      if (nx === start) break;
      if (nx.used) break;
      cur = nx;
    }
    if (ring.length >= 3) out.push(ring);
  }
  rings.forEach((ring, ri) => {
    if (nodes[ri].some((n) => n.x)) return;
    if (Math.hypot(ring[0][0], ring[0][1]) < r) out.push(ring);
  });
  if (!cross.length && inAll([r, 0], rings)) out.push(arc(0, 2 * Math.PI).concat([[r, 0]]));
  return out.filter((x) => Math.abs(signedArea(x)) > 0.5);
}
// rings (metres, mixed) → polygons [[outer, hole…]…]: holes go into the smallest outer that holds them
function assemble(rings) {
  const outers = rings.filter((x) => signedArea(x) > 0).map((x) => ({ o: x, a: signedArea(x), h: [] }));
  for (const h of rings.filter((x) => signedArea(x) < 0)) {
    let best = null;
    for (const o of outers) if (inRing(h[0], o.o) && (!best || o.a < best.a)) best = o;
    if (best) best.h.push(h);
  }
  return outers.map((o) => [o.o, ...o.h]);
}
const polysAreaM = (polys) => polys.reduce((s, p) => s + Math.abs(signedArea(p[0])) - p.slice(1).reduce((h, x) => h + Math.abs(signedArea(x)), 0), 0);

export function litPart(polys, lat, lng) {
  const F = frame(lat, lng);
  const rings = [];   // metres, interior-left
  for (const p of polys) p.forEach((ring, i) => {
    let r = open(ring).map(F.to); if (r.length < 3) return;
    const a = signedArea(r); if ((i === 0 && a < 0) || (i > 0 && a > 0)) r = r.reverse();
    rings.push(r);
  });
  const full = polysAreaM(assemble(rings));
  if (!rings.length) return null;
  if (full < SMALL_M2) return { k: "whole", polys, area: full, full };
  const inside = inAll([0, 0], rings);
  const anchor = inside ? [0, 0] : nearestOnRings(rings);
  const shifted = rings.map((r) => r.map((p) => [p[0] - anchor[0], p[1] - anchor[1]]));
  const cut = (r) => assemble(clipDisk(shifted, r));
  let r = R_MIN, best = cut(r), area = polysAreaM(best);
  // adaptive radius: grow from 10 m (0.25 m steps) until ≈ TARGET_M2 is lit, max 14 m
  while (area < TARGET_M2 && r < R_MAX) { r = Math.min(R_MAX, r + 0.25); best = cut(r); area = polysAreaM(best); }
  if (!best.length || area >= WHOLE_SHARE * full) return { k: "whole", polys, area: full, full };
  const back = (q) => { const g = F.from([q[0] + anchor[0], q[1] + anchor[1]]); return [g[0], g[1]]; };
  const geo = best.map((p) => p.map((ring) => { const g = ring.map(back); g.push(g[0].slice()); return g; }));
  return { k: "part", polys: geo, area, full, r };
}
