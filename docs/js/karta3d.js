/* Öl Nu — 3D map demo (docs/karta3d.html, not linked from the app). Mapbox GL JS v3, Standard style, night preset,
   pitch 60, 3D buildings. Two demo bars with the app's pill markers (HTML markers) and a small heatmap from fake points. */
(function () {
  "use strict";
  var CFG = window.OLNU_CONFIG || {}, U = window.U;
  if (!window.mapboxgl || !CFG.MAPBOX_TOKEN) { document.body.insertAdjacentHTML("beforeend", '<p style="color:#fff;padding:60px 16px">Mapbox saknas.</p>'); return; }
  mapboxgl.accessToken = CFG.MAPBOX_TOKEN;
  var map = new mapboxgl.Map({
    container: "m3", style: "mapbox://styles/mapbox/standard", center: [15.1876, 60.1503], zoom: 15.5, pitch: 60, bearing: 0,
    config: { basemap: { lightPreset: "night", showPointOfInterestLabels: false, show3dObjects: true, showTransitLabels: false,
      colorMotorways: "#f5a623", colorTrunks: "#c77a0e", colorPlaceLabels: "#ffd28a", colorBuildingHighlight: "#f5a623" } }
  });
  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");
  var bars = [
    { name: "Pitchers", ll: [15.18679, 60.14997], n: 5, lvl: 1 },
    { name: "Grekiska", ll: [15.18059, 60.15205], n: 3, lvl: 0 }
  ];
  bars.forEach(function (b) {
    var el = document.createElement("div"); el.className = "k3-mk";
    el.innerHTML = U.pillHTML(b.n, b.lvl, { cls: "p-bar" }) + '<span class="k3-name"></span>';
    el.querySelector(".k3-name").textContent = b.name;
    new mapboxgl.Marker({ element: el, anchor: "center" }).setLngLat(b.ll).addTo(map);
  });
  // Fake heat: a cloud of points around the two bars and the centre.
  function cloud(c, n, r, w) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
      out.push({ type: "Feature", properties: { w: w }, geometry: { type: "Point", coordinates: [c[0] + Math.cos(a) * d * 2, c[1] + Math.sin(a) * d] } });
    }
    return out;
  }
  map.on("style.load", function () {
    var pts = cloud(bars[0].ll, 30, 0.0006, 1).concat(cloud(bars[1].ll, 18, 0.0005, 0.8), cloud([15.1905, 60.1515], 14, 0.0012, 0.5));
    map.addSource("heat", { type: "geojson", data: { type: "FeatureCollection", features: pts } });
    map.addLayer({ id: "heat", type: "heatmap", source: "heat", slot: "top", paint: {
      "heatmap-weight": ["get", "w"],
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 12, 0.25, 17, 0.6],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 12, 14, 17, 42],
      "heatmap-opacity": 0.7,
      "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(90,35,0,0)", 0.2, "#c2650a", 0.45, "#f5a623", 0.65, "#ff7a1a", 0.85, "#ff3b3b", 1, "#fff6e0"]
    } });
  });
  window.__k3 = map;
})();
