/* PintsNow — ENGÅNGSKAMERAN · FILMRULLAR (film stocks). window.FILMFX. Migration 0345 (film_stock / film_set_stock / film_save_list).
   Why: owner 2026-11-08 "can we add filters?". Research (Dispo, Huji, Gudak, NOMO, Lapse): people love ONE look per roll,
   picked before shooting, and seen only when the roll is developed. So: the group loads ONE film per night (any member
   can change it until the first photo; then it is locked). The look is put on AT THE CLICK, on the phone, to the copy
   that goes up: the original never leaves the phone, no EXIF/GPS (canvas re-encode), and the album / Morgontidningen /
   "Spara" get the developed look with no extra work. Nobody sees it until 10:00, like before.
   - STOCKS: 6 films. 'kvall' (Kvällsljus 400) is the default (no server row = kvall, for ever).
   - render(src, id, o) → canvas. WebGL 1 (one pass: colour LUT + saturation + flash + halation + light leak + vignette +
     grain), Canvas 2D fallback (same maths, slower). Date stamp (orange 7-segment digits) drawn on top, no font needed.
   - develop(canvas | blob | {blob,w,h}, id, {at}) → Promise<{blob, w, h, ms, film}>: long side ≤ 1024, JPEG ≤ 120 kB
     (same rules as PHOTO._shrink and the server). Never rejects for a filter error: then the plain photo goes up.
   - sample(w, h, kind) → a procedural sample scene (picker preview when the camera is off; tests).
   - setRoll(gid, film) / rollOf(gid): the night's film per group (film.js sets it, filmcam.js reads it at the click).
   - Save: fileName(), stripJpeg(), zip(files) (store-only ZIP writer, UTF-8 names), saveMethod(), save(files, method).
   Store-safe: names and lines are about light and colour, never about drinking. */
(function () {
  "use strict";
  var I = window.I18N;
  function sv() { return !I || I.lang !== "en"; }
  var MAX_SIDE = 1024, TARGET = 120 * 1024, HARD_MAX = 158 * 1024;
  var DEFAULT = "kvall";
  // p: sat, con (S-curve 0..1), gam[r,g,b] (gamma), lift[r,g,b] (black point), gain[r,g,b] (white point), sh / hi [r,g,b] (split tone),
  //    bw [r,g,b] (mono mix, null = colour), grain (amount), gsz (grain size px at 1024), vig, hal (halation) + halc, flash,
  //    leak (chance 0..1) + leakc, stamp ('' | 'today' | '98').
  var STOCKS = [
    { id: "kvall", sv: "Kvällsljus 400", en: "Evening Glow 400", line: ["Varm och mjuk. Fina hudtoner i lampljus.", "Warm and soft. Kind skin tones in lamp light."], icon: "film-warm",
      p: { sat: 1.06, con: 0.32, gam: [0.93, 0.99, 1.08], lift: [0.045, 0.03, 0.03], gain: [1.0, 0.965, 0.88], sh: [0.015, 0.0, -0.01], hi: [0.03, 0.012, -0.03],
        grain: 0.045, gsz: 1.35, vig: 0.3, hal: 0.26, halc: [1.0, 0.42, 0.18], flash: 0, leak: 0.22, leakc: [1.0, 0.42, 0.1], stamp: "" } },
    { id: "midsommar", sv: "Midsommar 200", en: "Midsummer 200", line: ["Ljus och luftig. Pastell, som en sommarnatt.", "Bright and airy. Pastel, like a summer night."], icon: "film-sun",
      p: { sat: 0.9, con: 0.12, gam: [0.86, 0.85, 0.9], lift: [0.07, 0.065, 0.06], gain: [1.0, 1.0, 0.96], sh: [0.0, 0.01, 0.02], hi: [0.025, 0.015, -0.01],
        grain: 0.03, gsz: 1.2, vig: 0.12, hal: 0.16, halc: [1.0, 0.6, 0.4], flash: 0, leak: 0.35, leakc: [1.0, 0.62, 0.45], stamp: "" } },
    { id: "fjall", sv: "Fjällgrön 160", en: "Forest Green 160", line: ["Kylig och klar. Gröna toner, kalla skuggor.", "Cool and clear. Green tones, cool shadows."], icon: "film-leaf",
      p: { sat: 1.0, con: 0.28, gam: [1.04, 0.96, 0.98], lift: [0.02, 0.035, 0.04], gain: [0.97, 1.0, 0.97], sh: [-0.02, 0.018, 0.02], hi: [0.0, 0.012, -0.012],
        grain: 0.035, gsz: 1.2, vig: 0.18, hal: 0.08, halc: [0.9, 0.6, 0.4], flash: 0, leak: 0.08, leakc: [1.0, 0.7, 0.4], stamp: "" } },
    { id: "svartvit", sv: "Svartvit Klassiker", en: "Black & White Classic", line: ["Hård kontrast och tydligt korn. Tidlös.", "Hard contrast and strong grain. Timeless."], icon: "film-bw",
      p: { sat: 1, con: 0.55, gam: [1.02, 1.02, 1.02], lift: [0.03, 0.03, 0.03], gain: [0.98, 0.98, 0.98], sh: [0, 0, 0], hi: [0, 0, 0], bw: [0.42, 0.44, 0.14],
        grain: 0.085, gsz: 1.6, vig: 0.34, hal: 0, halc: [1, 1, 1], flash: 0, leak: 0, leakc: [1, 1, 1], stamp: "" } },
    { id: "blixt", sv: "Blixt-fest 800", en: "Flash Party 800", line: ["Rak blixt: skarp i mitten, mörkt runt om.", "Direct flash: bright centre, dark edges."], icon: "flash",
      p: { sat: 1.14, con: 0.48, gam: [0.97, 1.0, 1.0], lift: [0.0, 0.005, 0.03], gain: [1.0, 0.98, 0.96], sh: [0.005, -0.01, 0.03], hi: [0.01, 0.0, -0.015],
        grain: 0.07, gsz: 1.5, vig: 0.55, hal: 0.3, halc: [1.0, 0.35, 0.3], flash: 0.55, leak: 0.12, leakc: [1.0, 0.3, 0.15], stamp: "" } },
    { id: "retro", sv: "Retro 1998", en: "Retro 1998", line: ["Blekt, gulgrön och ljusläckor. Datum i hörnet.", "Faded, yellow-green, light leaks. Date in the corner."], icon: "film-date",
      p: { sat: 0.8, con: 0.16, gam: [0.95, 0.92, 1.06], lift: [0.085, 0.075, 0.035], gain: [1.0, 0.97, 0.83], sh: [0.0, 0.012, -0.01], hi: [0.02, 0.03, -0.05],
        grain: 0.06, gsz: 1.5, vig: 0.3, hal: 0.18, halc: [1.0, 0.5, 0.2], flash: 0, leak: 0.7, leakc: [1.0, 0.36, 0.08], stamp: "98" } }
  ];
  var BY = {}; STOCKS.forEach(function (s) { BY[s.id] = s; });
  function get(id) { return BY[id] || BY[DEFAULT]; }
  function name(id, en) { var s = get(id); return (en == null ? !sv() : en) ? s.en : s.sv; }
  function line(id) { var s = get(id); return sv() ? s.line[0] : s.line[1]; }

  /* ---------- tiny seeded random ---------- */
  function rng(seed) { var s = (seed >>> 0) || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

  /* ---------- colour LUT (256 × RGB) ---------- */
  var lutCache = {};
  function lut(id) {
    if (lutCache[id]) return lutCache[id];
    var p = get(id).p, out = new Uint8Array(256 * 4);
    for (var i = 0; i < 256; i++) {
      for (var c = 0; c < 3; c++) {
        var x = i / 255;
        var s = x * x * (3 - 2 * x); x = x + (s - x) * p.con * 1.6;            // S-curve
        x = Math.max(0, Math.min(1, x));
        x = Math.pow(x, p.gam[c]);
        x += p.sh[c] * (1 - x) * (1 - x) * 2 + p.hi[c] * x * x * 1.5;          // split tone
        x = p.lift[c] + x * (p.gain[c] - p.lift[c]);                          // fade (black point) + white point
        out[i * 4 + c] = Math.max(0, Math.min(255, Math.round(x * 255)));
      }
      out[i * 4 + 3] = 255;
    }
    return (lutCache[id] = out);
  }

  /* ---------- per-shot random parts (light leak, grain seed) ---------- */
  function plan(id, w, h, seed) {
    var p = get(id).p, r = rng(seed * 2654435761 + 7), lk = null;
    if (r() < p.leak) {
      var side = r() < 0.6 ? (r() < 0.5 ? 0 : 1) : 2;   // 0 left, 1 right, 2 top
      var t = 0.15 + r() * 0.7;
      lk = { x: side === 0 ? -0.04 : side === 1 ? 1.04 : t, y: side === 2 ? -0.04 : t, rx: side === 2 ? 0.45 : 0.16 + r() * 0.12, ry: side === 2 ? 0.14 + r() * 0.1 : 0.4 + r() * 0.25,
        s: 0.45 + r() * 0.45, c: p.leakc };
    }
    return { p: p, leak: lk, seed: Math.floor(r() * 997), fx: 0.5 + (r() - 0.5) * 0.08, fy: 0.42 + (r() - 0.5) * 0.08 };
  }

  /* ---------- WebGL ---------- */
  var VS = "attribute vec2 a;varying vec2 v;void main(){v=a*0.5+0.5;gl_Position=vec4(a,0.0,1.0);}";
  var FS = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif",
    "uniform sampler2D img,blr,lut;uniform vec2 res;uniform float sat,mono,grain,gsz,vig,hal,flash,seed,leakS;",
    "uniform vec3 bw,halc,leakC;uniform vec4 leak;uniform vec2 fc;varying vec2 v;",
    "float h(vec2 p){p=mod(p,1024.0);return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}",
    "float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h(i),h(i+vec2(1.0,0.0)),f.x),mix(h(i+vec2(0.0,1.0)),h(i+vec2(1.0,1.0)),f.x),f.y);}",
    "vec3 L(vec3 c){c=clamp(c,0.0,1.0)*(255.0/256.0)+0.5/256.0;return vec3(texture2D(lut,vec2(c.r,0.5)).r,texture2D(lut,vec2(c.g,0.5)).g,texture2D(lut,vec2(c.b,0.5)).b);}",
    "void main(){",
    " vec3 c=texture2D(img,v).rgb;",
    " float asp=res.x/res.y;vec2 q=(v-0.5)*vec2(asp,1.0);float r=length(q)/length(vec2(asp,1.0)*0.5);",
    " if(flash>0.0){vec2 d=(vec2(v.x,1.0-v.y)-fc)*vec2(asp,1.0);float f=exp(-dot(d,d)/0.22);c=c*(1.0+flash*0.75*f)*(1.0-flash*0.45*(1.0-f));}",
    " if(hal>0.0){vec3 b=texture2D(blr,v).rgb;float l=dot(b,vec3(0.3,0.59,0.11));c+=halc*hal*smoothstep(0.55,1.0,l)*1.4;}",
    " float lu=dot(c,vec3(0.299,0.587,0.114));c=mix(vec3(lu),c,sat);",
    " if(mono>0.5)c=vec3(dot(c,bw));",
    " c=L(c);",
    " c*=1.0-vig*smoothstep(0.38,1.08,r);",
    " if(leakS>0.0){vec2 d=(vec2(v.x,1.0-v.y)-leak.xy)/leak.zw;float f=exp(-dot(d,d));c=1.0-(1.0-c)*(1.0-clamp(leakC*leakS*f,0.0,1.0));}",
    " if(grain>0.0){vec2 p=gl_FragCoord.xy/gsz+seed;float g=vn(p)+0.5*vn(p*2.03+17.0)-0.75;float y=dot(c,vec3(0.299,0.587,0.114));",
    "  float w=0.55+0.9*y*(1.0-y)*4.0*0.5;c+=g*grain*2.2*w;}",
    " gl_FragColor=vec4(clamp(c,0.0,1.0),1.0);}"
  ].join("\n");
  var G = null, glFail = false;
  function glInit() {
    if (G || glFail) return G;
    try {
      var cv = document.createElement("canvas");
      var gl = cv.getContext("webgl", { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false, alpha: false }) ||
        cv.getContext("experimental-webgl", { preserveDrawingBuffer: true, antialias: false, alpha: false });
      if (!gl) { glFail = true; return null; }
      function sh(t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
      var pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error("link");
      gl.useProgram(pr);
      var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      var a = gl.getAttribLocation(pr, "a"); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      var tx = [0, 1, 2].map(function (i) {
        var t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, i === 2 ? gl.NEAREST : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, i === 2 ? gl.NEAREST : gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
      });
      var U = {}; ["img", "blr", "lut", "res", "sat", "mono", "grain", "gsz", "vig", "hal", "flash", "seed", "leakS", "bw", "halc", "leakC", "leak", "fc"].forEach(function (n) { U[n] = gl.getUniformLocation(pr, n); });
      gl.uniform1i(U.img, 0); gl.uniform1i(U.blr, 1); gl.uniform1i(U.lut, 2);
      var max = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;
      cv.addEventListener("webglcontextlost", function (e) { e.preventDefault(); G = null; }, false);
      G = { cv: cv, gl: gl, tx: tx, U: U, max: max, lutId: null };
      return G;
    } catch (e) { glFail = true; G = null; return null; }
  }
  function blurOf(src, w, h) {
    // Halation source: a small copy (1/16), drawn up again by the GPU (linear) = a wide soft blur, almost free.
    var bw = Math.max(4, Math.round(w / 16)), bh = Math.max(4, Math.round(h / 16));
    var a = document.createElement("canvas"); a.width = Math.max(8, bw * 2); a.height = Math.max(8, bh * 2);
    var x = a.getContext("2d"); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "medium"; x.drawImage(src, 0, 0, a.width, a.height);
    var b = document.createElement("canvas"); b.width = bw; b.height = bh;
    var y = b.getContext("2d"); y.imageSmoothingEnabled = true; y.drawImage(a, 0, 0, bw, bh);
    a.width = a.height = 0;
    return b;
  }
  function renderGL(src, w, h, id, pl) {
    var g = glInit(); if (!g || w > g.max || h > g.max) return null;
    var gl = g.gl, U = g.U, p = pl.p;
    if (gl.isContextLost && gl.isContextLost()) { G = null; return null; }
    g.cv.width = w; g.cv.height = h; gl.viewport(0, 0, w, h);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.tx[0]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
    var bl = p.hal > 0 ? blurOf(src, w, h) : null;
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, g.tx[1]);
    if (bl) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, bl); else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(3));
    if (g.lutId !== id) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, g.tx[2]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut(id));
      g.lutId = id;
    }
    var k = Math.max(w, h) / 1024;   // grain size follows the picture size (same look in the preview and the photo)
    gl.uniform2f(U.res, w, h); gl.uniform1f(U.sat, p.sat); gl.uniform1f(U.mono, p.bw ? 1 : 0); gl.uniform3fv(U.bw, p.bw || [0.3, 0.59, 0.11]);
    gl.uniform1f(U.grain, p.grain); gl.uniform1f(U.gsz, Math.max(0.6, p.gsz * k)); gl.uniform1f(U.vig, p.vig);
    gl.uniform1f(U.hal, bl ? p.hal : 0); gl.uniform3fv(U.halc, p.halc); gl.uniform1f(U.flash, p.flash); gl.uniform2f(U.fc, pl.fx, pl.fy);
    gl.uniform1f(U.seed, pl.seed);
    var lk = pl.leak; gl.uniform1f(U.leakS, lk ? lk.s : 0); gl.uniform3fv(U.leakC, lk ? lk.c : [0, 0, 0]); gl.uniform4f(U.leak, lk ? lk.x : 0, lk ? lk.y : 0, lk ? lk.rx : 1, lk ? lk.ry : 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    var out = document.createElement("canvas"); out.width = w; out.height = h;
    out.getContext("2d").drawImage(g.cv, 0, 0);
    if (bl) bl.width = bl.height = 0;
    return out;
  }

  /* ---------- Canvas 2D fallback (same maths; ~5–8× slower) ---------- */
  function render2D(src, w, h, id, pl) {
    var p = pl.p, out = document.createElement("canvas"); out.width = w; out.height = h;
    var x = out.getContext("2d"); x.drawImage(src, 0, 0, w, h);
    var im = x.getImageData(0, 0, w, h), d = im.data, T = lut(id);
    var bd = null;
    if (p.hal > 0) { var bl = blurOf(src, w, h), bc = document.createElement("canvas"); bc.width = w; bc.height = h; var bx = bc.getContext("2d"); bx.imageSmoothingEnabled = true; bx.drawImage(bl, 0, 0, w, h); bd = bx.getImageData(0, 0, w, h).data; bc.width = bc.height = 0; }
    var asp = w / h, nrm = Math.sqrt(asp * asp + 1) * 0.5, k = Math.max(w, h) / 1024, gs = Math.max(0.6, p.gsz * k), lk = pl.leak, R = rng(pl.seed + 11);
    var NT = 128, noise = new Float32Array(NT * NT); for (var n = 0; n < noise.length; n++) noise[n] = R() + R() * 0.5 - 0.75;
    for (var yy = 0; yy < h; yy++) {
      var vy = (yy + 0.5) / h;
      for (var xx = 0; xx < w; xx++) {
        var i = (yy * w + xx) * 4, vx = (xx + 0.5) / w;
        var r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
        var qx = (vx - 0.5) * asp, qy = vy - 0.5, rr = Math.sqrt(qx * qx + qy * qy) / nrm;
        if (p.flash > 0) { var dx = (vx - pl.fx) * asp, dy = vy - pl.fy, f = Math.exp(-(dx * dx + dy * dy) / 0.22), m = (1 + p.flash * 0.75 * f) * (1 - p.flash * 0.45 * (1 - f)); r *= m; g *= m; b *= m; }
        if (bd) { var l0 = (bd[i] * 0.3 + bd[i + 1] * 0.59 + bd[i + 2] * 0.11) / 255, t0 = Math.max(0, Math.min(1, (l0 - 0.55) / 0.45)); t0 = t0 * t0 * (3 - 2 * t0) * p.hal * 1.4; r += p.halc[0] * t0; g += p.halc[1] * t0; b += p.halc[2] * t0; }
        var lu = r * 0.299 + g * 0.587 + b * 0.114; r = lu + (r - lu) * p.sat; g = lu + (g - lu) * p.sat; b = lu + (b - lu) * p.sat;
        if (p.bw) { r = g = b = r * p.bw[0] + g * p.bw[1] + b * p.bw[2]; }
        r = T[Math.max(0, Math.min(255, Math.round(r * 255))) * 4] / 255; g = T[Math.max(0, Math.min(255, Math.round(g * 255))) * 4 + 1] / 255; b = T[Math.max(0, Math.min(255, Math.round(b * 255))) * 4 + 2] / 255;
        var t1 = Math.max(0, Math.min(1, (rr - 0.38) / 0.7)), vg = 1 - p.vig * t1 * t1 * (3 - 2 * t1); r *= vg; g *= vg; b *= vg;
        if (lk) { var ex = (vx - lk.x) / lk.rx, ey = (vy - lk.y) / lk.ry, lf = Math.exp(-(ex * ex + ey * ey)) * lk.s; r = 1 - (1 - r) * (1 - Math.min(1, lk.c[0] * lf)); g = 1 - (1 - g) * (1 - Math.min(1, lk.c[1] * lf)); b = 1 - (1 - b) * (1 - Math.min(1, lk.c[2] * lf)); }
        if (p.grain > 0) { var gn = noise[((Math.floor(yy / gs) % NT) * NT) + (Math.floor(xx / gs) % NT)], y2 = r * 0.299 + g * 0.587 + b * 0.114, gw = (0.55 + 0.9 * y2 * (1 - y2) * 2) * p.grain * 2.2 * gn; r += gw; g += gw; b += gw; }
        d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255;
      }
    }
    x.putImageData(im, 0, 0);
    return out;
  }

  /* ---------- date stamp: orange 7-segment digits ('26 11 08 / '98 11 08), bottom right ---------- */
  var SEG = { "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg" };
  function stamp(cv, at, mode) {
    var x = cv.getContext("2d"), w = cv.width, h = cv.height, d = new Date(at || Date.now());
    var yy = mode === "98" ? "98" : String(d.getFullYear()).slice(-2);
    var txt = "'" + yy + " " + ("0" + (d.getMonth() + 1)).slice(-2) + " " + ("0" + d.getDate()).slice(-2);
    var H = Math.max(10, Math.round(Math.min(w, h) * 0.042)), W = H * 0.52, T = Math.max(1.5, H * 0.13), gap = H * 0.2;
    var total = 0; for (var i = 0; i < txt.length; i++) total += txt[i] === " " ? W * 0.6 : txt[i] === "'" ? W * 0.35 : W + gap;
    var ox = w - Math.round(w * 0.05) - total, oy = h - Math.round(h * 0.05) - H;
    function seg(px, py, s) {
      var hw = W, hh = H / 2;
      var R = { a: [px, py, hw, T], b: [px + hw - T, py, T, hh], c: [px + hw - T, py + hh, T, hh], d: [px, py + H - T, hw, T],
        e: [px, py + hh, T, hh], f: [px, py, T, hh], g: [px, py + hh - T / 2, hw, T] }[s];
      x.fillRect(R[0] + T * 0.15, R[1] + T * 0.15, R[2] - T * 0.3, R[3] - T * 0.3);
    }
    // Crisp digits on a small canvas, then a cheap glow (the same digits drawn 1/4 size and back up). No shadowBlur: slow on phones.
    var pad = Math.ceil(H * 0.6), S = document.createElement("canvas"); S.width = Math.ceil(total + pad * 2); S.height = Math.ceil(H + pad * 2);
    var sx = S.getContext("2d"), main = x; x = sx; x.fillStyle = "rgb(255,150,60)";
    var cx = pad;
    for (var j = 0; j < txt.length; j++) {
      var ch = txt[j];
      if (ch === " ") { cx += W * 0.6; continue; }
      if (ch === "'") { x.fillRect(cx, pad, T, H * 0.3); cx += W * 0.35; continue; }
      oy = pad; (SEG[ch] || "").split("").forEach(function (s2) { seg(cx, pad, s2); });
      cx += W + gap;
    }
    var gs = document.createElement("canvas"); gs.width = Math.max(1, Math.round(S.width / 5)); gs.height = Math.max(1, Math.round(S.height / 5));
    var gx = gs.getContext("2d"); gx.imageSmoothingEnabled = true; gx.drawImage(S, 0, 0, gs.width, gs.height);
    main.save(); main.globalCompositeOperation = "lighter"; main.imageSmoothingEnabled = true;
    var dx = ox - pad, dy = h - Math.round(h * 0.05) - H - pad;
    main.globalAlpha = 0.9; main.drawImage(gs, dx, dy, S.width, S.height);
    main.globalAlpha = 0.85; main.drawImage(S, dx, dy);
    main.restore();
    S.width = S.height = gs.width = gs.height = 0;
  }

  /* ---------- public render ---------- */
  function render(src, id, o) {
    o = o || {};
    var sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
    if (!sw || !sh) throw new Error("size");
    var k = Math.min(1, (o.max || MAX_SIDE) / Math.max(sw, sh)), w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    var base = src;
    if (k < 1 || !(src instanceof HTMLCanvasElement)) {
      base = document.createElement("canvas"); base.width = w; base.height = h;
      var bx = base.getContext("2d"); bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = "high"; bx.drawImage(src, 0, 0, w, h);
    }
    id = BY[id] ? id : DEFAULT;
    var pl = plan(id, w, h, o.seed != null ? o.seed : Math.floor(Math.random() * 1e9));
    var out = null, how = "gl";
    if (!o.cpu) { try { out = renderGL(base, w, h, id, pl); } catch (e) { out = null; } }
    if (!out) { out = render2D(base, w, h, id, pl); how = "2d"; }
    if (pl.p.stamp && o.stamp !== false) stamp(out, o.at, pl.p.stamp);
    if (base !== src) base.width = base.height = 0;
    out._how = how;
    return out;
  }
  function toBlob(c, q) { return new Promise(function (res) { c.toBlob(res, "image/jpeg", q); }); }
  function encode(c) {
    var q = 0.8, tries = 0, cur = c;
    function round() {
      return toBlob(cur, q).then(function (b) {
        tries++;
        if (!b) throw new Error("encode");
        if (b.size <= TARGET || tries >= 10) {
          if (b.size > HARD_MAX) throw new Error("too_big");
          return { blob: b, w: cur.width, h: cur.height, q: q, tries: tries };
        }
        if (q > 0.5) q = Math.round((q - 0.08) * 100) / 100;
        else { var n = document.createElement("canvas"); n.width = Math.round(cur.width * 0.85); n.height = Math.round(cur.height * 0.85); n.getContext("2d").drawImage(cur, 0, 0, n.width, n.height); if (cur !== c) cur.width = cur.height = 0; cur = n; q = 0.66; }
        return round();
      });
    }
    return round();
  }
  // Plain JPEG (no film): long side ≤ max, the same size rules. For FILMCAM.capture without a film.
  function toJpeg(src, max) {
    var sw = src.width, sh = src.height, k = Math.min(1, (max || MAX_SIDE) / Math.max(sw, sh)), c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
    var x = c.getContext("2d"); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, c.width, c.height);
    return encode(c).then(function (r) { c.width = c.height = 0; return r; });
  }
  function decode(blob) {
    if (window.createImageBitmap) return createImageBitmap(blob)["catch"](function () { return imgDecode(blob); });
    return imgDecode(blob);
  }
  function imgDecode(blob) {
    return new Promise(function (res, rej) { var u = URL.createObjectURL(blob), im = new Image(); im.onload = function () { URL.revokeObjectURL(u); res(im); }; im.onerror = function () { URL.revokeObjectURL(u); rej(new Error("decode")); }; im.src = u; });
  }
  var last = null;
  function develop(input, id, o) {
    o = o || {};
    var t0 = performance.now(), plain = input && input.blob ? input : null;
    var srcP = input instanceof HTMLCanvasElement ? Promise.resolve(input) : decode(plain ? plain.blob : input);
    return srcP.then(function (src) {
      var t1 = performance.now(), c = render(src, id, { at: o.at, seed: o.seed, cpu: o.cpu, max: o.max }), t2 = performance.now();
      try { if (src.close) src.close(); } catch (e) {}
      return encode(c).then(function (r) {
        c.width = c.height = 0;
        r.film = BY[id] ? id : DEFAULT; r.ms = Math.round(performance.now() - t0); r.fxMs = Math.round(t2 - t1); r.how = c._how; r.tries = r.tries || 0;
        last = { film: r.film, ms: r.ms, fxMs: r.fxMs, how: r.how, w: r.w, h: r.h, kb: Math.round(r.blob.size / 1024), q: r.q, tries: r.tries };
        try { if (window.PNLOG && !o.quiet) window.PNLOG.event("cam.fx", { film: r.film, ms: r.ms, fx: r.fxMs, how: r.how, kb: last.kb, tries: r.tries }); } catch (e) {}
        return r;
      });
    })["catch"](function (e) {
      // Never lose the shot over a filter: the plain photo goes up.
      if (plain) return plain;
      if (input instanceof HTMLCanvasElement) {
        var k = Math.min(1, MAX_SIDE / Math.max(input.width, input.height)), n = document.createElement("canvas");
        n.width = Math.round(input.width * k); n.height = Math.round(input.height * k); n.getContext("2d").drawImage(input, 0, 0, n.width, n.height);
        return encode(n);
      }
      throw e;
    });
  }

  /* ---------- sample scenes (procedural; previews + tests) ---------- */
  function sample(w, h, kind) {
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var x = c.getContext("2d"), R = rng(kind === "ute" ? 3 : kind === "natt" ? 5 : 9), s = Math.min(w, h);
    function person(px, py, sc, skin, hair, shirt) {
      x.fillStyle = shirt; x.beginPath(); x.ellipse(px, py + sc * 1.25, sc * 0.95, sc * 0.75, 0, Math.PI, 0); x.fill(); x.fillRect(px - sc * 0.95, py + sc * 1.24, sc * 1.9, sc);
      x.fillStyle = skin; x.beginPath(); x.ellipse(px, py, sc * 0.48, sc * 0.6, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = hair; x.beginPath(); x.ellipse(px, py - sc * 0.28, sc * 0.52, sc * 0.4, 0, Math.PI, 0); x.fill();
      x.fillStyle = "rgba(40,20,15,.75)"; x.beginPath(); x.arc(px - sc * 0.17, py - sc * 0.02, sc * 0.05, 0, 7); x.arc(px + sc * 0.17, py - sc * 0.02, sc * 0.05, 0, 7); x.fill();
      x.strokeStyle = "rgba(120,40,40,.7)"; x.lineWidth = sc * 0.05; x.beginPath(); x.arc(px, py + sc * 0.18, sc * 0.17, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
    }
    var g;
    if (kind === "ute") {   // midsummer evening: sky, lake, forest, red cottage, two friends
      g = x.createLinearGradient(0, 0, 0, h * 0.55); g.addColorStop(0, "#7fb2e0"); g.addColorStop(0.7, "#f3d1a2"); g.addColorStop(1, "#f6b77c"); x.fillStyle = g; x.fillRect(0, 0, w, h * 0.55);
      x.fillStyle = "#fff4cf"; x.beginPath(); x.arc(w * 0.78, h * 0.42, s * 0.06, 0, 7); x.fill();
      g = x.createLinearGradient(0, h * 0.5, 0, h * 0.7); g.addColorStop(0, "#5d8fb3"); g.addColorStop(1, "#2d5674"); x.fillStyle = g; x.fillRect(0, h * 0.52, w, h * 0.2);
      for (var t = 0; t < 26; t++) { var tx = R() * w, th = h * (0.12 + R() * 0.12); x.fillStyle = ["#24502c", "#2f6236", "#1d4325"][t % 3]; x.beginPath(); x.moveTo(tx, h * 0.53 - th); x.lineTo(tx - th * 0.28, h * 0.54); x.lineTo(tx + th * 0.28, h * 0.54); x.fill(); }
      x.fillStyle = "#4f8a3a"; x.fillRect(0, h * 0.7, w, h * 0.3); g = x.createLinearGradient(0, h * 0.7, 0, h); g.addColorStop(0, "rgba(120,170,70,.6)"); g.addColorStop(1, "rgba(40,80,30,.6)"); x.fillStyle = g; x.fillRect(0, h * 0.7, w, h * 0.3);
      x.fillStyle = "#a3271f"; x.fillRect(w * 0.06, h * 0.5, w * 0.22, h * 0.2); x.fillStyle = "#3b2a26"; x.beginPath(); x.moveTo(w * 0.04, h * 0.51); x.lineTo(w * 0.17, h * 0.42); x.lineTo(w * 0.3, h * 0.51); x.fill();
      x.fillStyle = "#f4efe6"; x.fillRect(w * 0.1, h * 0.55, w * 0.05, h * 0.06); x.fillRect(w * 0.2, h * 0.55, w * 0.05, h * 0.06);
      for (var f = 0; f < 60; f++) { x.fillStyle = ["#fff", "#f6e24a", "#c9a0e8"][f % 3]; x.beginPath(); x.arc(R() * w, h * (0.74 + R() * 0.26), s * 0.006, 0, 7); x.fill(); }
      person(w * 0.48, h * 0.62, s * 0.11, "#e8b593", "#c79a52", "#f2f2ee"); person(w * 0.66, h * 0.66, s * 0.1, "#b97b56", "#2b1d16", "#4a7bb7");
    } else if (kind === "natt") {   // night street: lamps, neon sign, wet street, one friend under a lamp
      g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#090d1c"); g.addColorStop(1, "#1b1f2e"); x.fillStyle = g; x.fillRect(0, 0, w, h);
      for (var b2 = 0; b2 < 7; b2++) { var bx = b2 * w / 6 - w * 0.05, bh2 = h * (0.35 + R() * 0.25); x.fillStyle = ["#1d2233", "#232a3e", "#191d2b"][b2 % 3]; x.fillRect(bx, h * 0.7 - bh2, w / 6 + 2, bh2);
        for (var wi = 0; wi < 8; wi++) if (R() < 0.45) { x.fillStyle = R() < 0.5 ? "#f7c46c" : "#9ec3f0"; x.fillRect(bx + w * 0.02 + (wi % 2) * w * 0.07, h * 0.7 - bh2 + h * 0.04 + Math.floor(wi / 2) * h * 0.07, w * 0.035, h * 0.035); } }
      x.fillStyle = "#2a2d36"; x.fillRect(0, h * 0.7, w, h * 0.3);
      for (var l = 0; l < 3; l++) { var lx = w * (0.15 + l * 0.35); x.fillStyle = "#555"; x.fillRect(lx - 2, h * 0.3, 4, h * 0.4); g = x.createRadialGradient(lx, h * 0.3, 1, lx, h * 0.3, s * 0.22); g.addColorStop(0, "rgba(255,226,160,1)"); g.addColorStop(0.15, "rgba(255,190,100,.55)"); g.addColorStop(1, "rgba(255,160,60,0)"); x.fillStyle = g; x.fillRect(lx - s * 0.25, h * 0.3 - s * 0.25, s * 0.5, s * 0.5);
        g = x.createRadialGradient(lx, h * 0.85, 1, lx, h * 0.85, s * 0.18); g.addColorStop(0, "rgba(255,200,120,.45)"); g.addColorStop(1, "rgba(255,200,120,0)"); x.fillStyle = g; x.fillRect(lx - s * 0.2, h * 0.7, s * 0.4, h * 0.3); }
      x.save(); x.shadowColor = "#ff3fa0"; x.shadowBlur = s * 0.04; x.strokeStyle = "#ff6ec0"; x.lineWidth = s * 0.012; x.strokeRect(w * 0.58, h * 0.2, w * 0.3, h * 0.09); x.shadowColor = "#3ff0ff"; x.strokeStyle = "#7ff6ff"; x.beginPath(); x.moveTo(w * 0.62, h * 0.245); x.lineTo(w * 0.84, h * 0.245); x.stroke(); x.restore();
      person(w * 0.47, h * 0.6, s * 0.12, "#d9a382", "#3a2618", "#7b2d3a");
    } else {   // indoor evening (default): warm room, string lights with bokeh, table with a candle, three friends
      g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#2a1810"); g.addColorStop(1, "#4a2c1a"); x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.fillStyle = "#5b3a24"; for (var p2 = 0; p2 < 9; p2++) x.fillRect(p2 * w / 8, 0, 3, h * 0.7);
      for (var k2 = 0; k2 < 22; k2++) { var kx = (k2 + 0.5) * w / 22, ky = h * (0.12 + 0.05 * Math.sin(k2 * 0.7)); g = x.createRadialGradient(kx, ky, 0, kx, ky, s * 0.05); g.addColorStop(0, "rgba(255,236,180,1)"); g.addColorStop(0.25, "rgba(255,190,90,.7)"); g.addColorStop(1, "rgba(255,150,50,0)"); x.fillStyle = g; x.fillRect(kx - s * 0.06, ky - s * 0.06, s * 0.12, s * 0.12); }
      for (var o2 = 0; o2 < 14; o2++) { x.fillStyle = "rgba(255," + (150 + Math.floor(R() * 80)) + ",90," + (0.12 + R() * 0.15) + ")"; x.beginPath(); x.arc(R() * w, h * (0.2 + R() * 0.35), s * (0.03 + R() * 0.05), 0, 7); x.fill(); }
      person(w * 0.25, h * 0.5, s * 0.12, "#f0c09e", "#e2c27a", "#3f6f5a"); person(w * 0.52, h * 0.46, s * 0.13, "#c98b63", "#1e1410", "#d9b44a"); person(w * 0.78, h * 0.52, s * 0.115, "#8d5a3b", "#120c0a", "#b43a3a");
      x.fillStyle = "#6e4426"; x.fillRect(0, h * 0.74, w, h * 0.26); x.fillStyle = "#83542f"; x.fillRect(0, h * 0.74, w, h * 0.025);
      x.fillStyle = "#efe6d6"; x.fillRect(w * 0.47, h * 0.66, w * 0.03, h * 0.08);
      g = x.createRadialGradient(w * 0.485, h * 0.64, 0, w * 0.485, h * 0.64, s * 0.12); g.addColorStop(0, "rgba(255,240,190,1)"); g.addColorStop(0.15, "rgba(255,180,80,.6)"); g.addColorStop(1, "rgba(255,140,40,0)"); x.fillStyle = g; x.fillRect(w * 0.35, h * 0.5, w * 0.3, h * 0.28);
      x.fillStyle = "#3d5f9a"; x.fillRect(w * 0.15, h * 0.7, w * 0.08, h * 0.05); x.fillStyle = "#e9e1cf"; x.fillRect(w * 0.7, h * 0.69, w * 0.1, h * 0.06);
    }
    return c;
  }

  /* ---------- the night's film per group ---------- */
  var rolls = {};
  function setRoll(gid, film) { if (gid) rolls[gid] = BY[film] ? film : DEFAULT; }
  function rollOf(gid) { return (gid && rolls[gid]) || DEFAULT; }

  /* ---------- saving: names, EXIF strip, ZIP, method ---------- */
  function ascii(s) {
    s = String(s || "");
    try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return s.replace(/[æÆ]/g, "ae").replace(/[øØ]/g, "o").replace(/[^A-Za-z0-9]+/g, "").slice(0, 24);
  }
  function fileName(evening, group, i) {
    var d = String(evening || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { var t = new Date(); d = t.getFullYear() + "-" + ("0" + (t.getMonth() + 1)).slice(-2) + "-" + ("0" + t.getDate()).slice(-2); }
    return "PintsNow_" + d + "_" + (ascii(group) || "Gang") + "_" + ("0" + i).slice(-2) + ".jpg";
  }
  // Removes APP1 (EXIF / XMP, may hold GPS), APP3–APP13 and COM segments. Keeps APP0 (JFIF), APP2 (ICC colour profile) and APP14 (Adobe).
  function stripJpeg(u8) {
    if (!u8 || u8.length < 4 || u8[0] !== 0xFF || u8[1] !== 0xD8) return u8;
    var out = [u8.subarray(0, 2)], i = 2;
    while (i + 4 <= u8.length && u8[i] === 0xFF) {
      var m = u8[i + 1];
      if (m === 0xDA) break;   // start of scan: the rest is image data
      var len = (u8[i + 2] << 8) | u8[i + 3];
      if (len < 2 || i + 2 + len > u8.length) return u8;
      var keep = !(m === 0xE1 || (m >= 0xE3 && m <= 0xED) || m === 0xFE);
      if (keep) out.push(u8.subarray(i, i + 2 + len));
      i += 2 + len;
    }
    out.push(u8.subarray(i));
    var n = 0; out.forEach(function (a) { n += a.length; });
    var r = new Uint8Array(n), o = 0; out.forEach(function (a) { r.set(a, o); o += a.length; });
    return r;
  }
  var CRC = null;
  function crc32(u8) {
    if (!CRC) { CRC = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
    var x = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) x = CRC[(x ^ u8[i]) & 255] ^ (x >>> 8);
    return (x ^ 0xFFFFFFFF) >>> 0;
  }
  // files: [{name, data: Uint8Array}] → Blob (application/zip). "Stored" (JPEG is compressed already), UTF-8 names.
  function zip(files, when) {
    var d = when || new Date(), dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF,
      dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    var parts = [], central = [], off = 0, enc = new TextEncoder();
    function h(n) { return new DataView(new ArrayBuffer(n)); }
    files.forEach(function (f) {
      var nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length, L = h(30);
      L.setUint32(0, 0x04034b50, true); L.setUint16(4, 20, true); L.setUint16(6, 0x0800, true); L.setUint16(8, 0, true); L.setUint16(10, dt, true); L.setUint16(12, dd, true);
      L.setUint32(14, crc, true); L.setUint32(18, sz, true); L.setUint32(22, sz, true); L.setUint16(26, nm.length, true); L.setUint16(28, 0, true);
      parts.push(L.buffer, nm, f.data);
      var C = h(46);
      C.setUint32(0, 0x02014b50, true); C.setUint16(4, 20, true); C.setUint16(6, 20, true); C.setUint16(8, 0x0800, true); C.setUint16(10, 0, true); C.setUint16(12, dt, true); C.setUint16(14, dd, true);
      C.setUint32(16, crc, true); C.setUint32(20, sz, true); C.setUint32(24, sz, true); C.setUint16(28, nm.length, true); C.setUint16(30, 0, true); C.setUint16(32, 0, true);
      C.setUint16(34, 0, true); C.setUint16(36, 0, true); C.setUint32(38, 0, true); C.setUint32(42, off, true);
      central.push(C.buffer, nm);
      off += 30 + nm.length + sz;
    });
    var cs = 0; central.forEach(function (p) { cs += p.byteLength; });
    var E = h(22); E.setUint32(0, 0x06054b50, true); E.setUint16(8, files.length, true); E.setUint16(10, files.length, true); E.setUint32(12, cs, true); E.setUint32(16, off, true);
    return new Blob(parts.concat(central, [E.buffer]), { type: "application/zip" });
  }
  function plat() {
    var ua = navigator.userAgent || "";
    var ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    return { ios: ios, android: /Android/i.test(ua), mobile: ios || /Android|Mobi/i.test(ua) };
  }
  function canShareFiles(files) {
    try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: files })); } catch (e) { return false; }
  }
  // iPhone/iPad: the share sheet ("Spara N bilder" → Bilder). Android: plain downloads (Chrome puts them in Download/,
  // Galleriet and Google Foto show that folder; the share sheet has no sure "save" target). Computer: one ZIP.
  function saveMethod(files) {
    var P = plat();
    if (P.ios && canShareFiles(files)) return "share";
    if (P.mobile) return "files";
    return files.length > 1 ? "zip" : "files";
  }
  var SHARE_MAX = 10;   // more files per share call fail on some phones (photoprism #3974): the rest on the next tap
  function download(blob, nm) {
    var u = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = u; a.download = nm; a.rel = "noopener"; a.style.display = "none"; document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(u); }, 60e3);
  }
  // files: [{name, blob}] (already stripped). Returns Promise<{method, n, rest}>. Call it straight from the tap (share needs it).
  function save(files, method, zipName) {
    method = method || saveMethod(files.map(function (f) { return new File([f.blob], f.name, { type: "image/jpeg" }); }));
    if (method === "share") {
      var batch = files.slice(0, SHARE_MAX), fl = batch.map(function (f) { return new File([f.blob], f.name, { type: "image/jpeg" }); });
      return navigator.share({ files: fl }).then(function () { return { method: "share", n: batch.length, rest: files.slice(batch.length) }; },
        function (e) { if (e && e.name === "AbortError") return { method: "cancel", n: 0, rest: files }; throw e; });
    }
    if (method === "zip") {
      return Promise.all(files.map(function (f) { return f.blob.arrayBuffer().then(function (b) { return { name: f.name, data: new Uint8Array(b) }; }); }))
        .then(function (arr) { download(zip(arr), zipName || "PintsNow.zip"); return { method: "zip", n: files.length, rest: [] }; });
    }
    files.forEach(function (f, i) { setTimeout(function () { download(f.blob, f.name); }, i * 350); });
    return Promise.resolve({ method: files.length > 1 ? "files" : "single", n: files.length, rest: [] });
  }

  window.FILMFX = {
    STOCKS: STOCKS, DEFAULT: DEFAULT, get: get, name: name, line: line, has: function (id) { return !!BY[id]; },
    render: render, develop: develop, toJpeg: toJpeg, sample: sample, stamp: stamp,
    setRoll: setRoll, rollOf: rollOf,
    fileName: fileName, stripJpeg: stripJpeg, zip: zip, crc32: crc32, saveMethod: saveMethod, canShareFiles: canShareFiles, save: save, SHARE_MAX: SHARE_MAX,
    last: function () { return last; }, gl: function () { return !!glInit(); }
  };

  // Stubs for other modules (stable API even if filmcam.js / film.js load later or lazily): FILMCAM.capture and
  // FILM.albumExtra work from the first call. The real modules replace these objects when they run.
  function whenReal(name, test) {
    return new Promise(function (res, rej) {
      var n = 0;
      (function wait() {
        if (test()) { res(); return; }
        if (n === 0 && !document.querySelector('script[src*="js/' + name + '.js"]')) {
          var s = document.createElement("script"); s.src = "./js/" + name + ".js"; s.defer = true; s.onerror = function () { rej(new Error("load")); }; document.head.appendChild(s);
        }
        if (++n > 100) { rej(new Error("load")); return; }
        setTimeout(wait, 100);
      })();
    });
  }
  if (!window.FILMCAM) window.FILMCAM = { _stub: true, capture: function (o) { return whenReal("filmcam", function () { return window.FILMCAM && !window.FILMCAM._stub; }).then(function () { return window.FILMCAM.capture(o); }); } };
  window.FILM_EXTRAS = window.FILM_EXTRAS || [];
  if (!window.FILM) window.FILM = { _stub: true, albumExtra: function (fn) { var a = window.FILM_EXTRAS; if (a.indexOf(fn) < 0) a.push(fn); return function () { var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }; } };
})();
