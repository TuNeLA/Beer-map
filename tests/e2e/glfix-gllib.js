// glfix: GL-side probes for the old canvas tests (the bars, heat and clouds are drawn in the Mapbox GL map now).
// glHeat(page, [lat,lng], distancesPx) → { z, rPx (heatmap-radius at this zoom), op (heatmap-opacity), d: [glow at each distance] }
//   glow = mean |RGB| difference (0–255) in a 3×3 box between the map WITH and WITHOUT the heat layer, read from the GL
//   drawing buffer right after a synchronous render (same task, so preserveDrawingBuffer is not needed).
async function glHeat(page, ll, dists, dirDeg) {
  return page.evaluate(([ll, dists, dirDeg]) => {
    const g = BASEMAP.mapbox().getMapboxMap(), cv = g.getCanvas(), dpr = cv.width / cv.clientWidth;
    const render = () => { if (g._frame && g._frame.cancel) { g._frame.cancel(); g._frame = null; } g._render(performance.now()); };
    const grab = () => { render(); const c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height; const x = c.getContext("2d"); x.drawImage(cv, 0, 0); return x; };
    const p = g.project([ll[1], ll[0]]), ang = (dirDeg || 0) * Math.PI / 180;
    const vis = g.getLayoutProperty("olnu-heat", "visibility") || "visible";
    // the heat alone: the bar pills / dots / names sit on top of it (hidden for both grabs, back after)
    const bars = (GLBARS._layers ? GLBARS._layers() : []).filter((x) => /bar/.test(x)), bv = bars.map((id) => g.getLayoutProperty(id, "visibility") || "visible");
    bars.forEach((id) => g.setLayoutProperty(id, "visibility", "none"));
    const a = grab(); g.setLayoutProperty("olnu-heat", "visibility", "none"); g.style.update && 0; const b = grab(); g.setLayoutProperty("olnu-heat", "visibility", vis); bars.forEach((id, i) => g.setLayoutProperty(id, "visibility", bv[i])); render();
    const diff = (dx, dy) => { const X = Math.round((p.x + dx) * dpr) - 1, Y = Math.round((p.y + dy) * dpr) - 1; if (X < 0 || Y < 0 || X + 3 > cv.width || Y + 3 > cv.height) return null;
      const A = a.getImageData(X, Y, 3, 3).data, B = b.getImageData(X, Y, 3, 3).data; let s = 0; for (let i = 0; i < A.length; i += 4) s += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]); return +(s / 27).toFixed(1); };
    const L = g.style.getOwnLayer("olnu-heat"), ev = (k) => { try { const v = L.paint.get(k); return typeof v === "number" ? v : +v.evaluate({ properties: {} }, {}); } catch (e) { return null; } };
    return { z: __map.getZoom(), rPx: ev("heatmap-radius"), op: ev("heatmap-opacity"), d: dists.map((r) => diff(Math.cos(ang) * r, Math.sin(ang) * r)) };
  }, [ll, dists, dirDeg || 0]);
}
module.exports = { glHeat };
