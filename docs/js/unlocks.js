/* PintsNow — UNLOCKS (lane unlocks, 13 Nov 2026). Owner: "when I unlock a new hat or shirt a sheet comes up:
   'Du låste upp … · Använd nu / OK'". Data + art: js/unlock-parts.js (PN.unlockData). Server: SQL 0508 / 0509.
   1. Unlock sheet: when an avatar item becomes free to use (an achievement medal, a rank, a medal; NOT a season that just
      started), one sheet: "Du låste upp: <item>", the character wearing it, a small pop (no motion with reduced motion),
      "Använd nu" (AVATAR.equip → set_my_avatar) / "Senare", and "Öppna Garderob". Many at once = one sheet with a picker.
      What is already open is stored per user on this phone (localStorage olnu.unl.v1); the first look only stores
      (no sheet storm on the first run).
   2. When to look: once my_avatar has facts; again when MEDALS.mine() changes (award_medals gave a medal) and after the
      app was hidden ≥ 10 min (then my_avatar is read again). No timer RPC; the check every 15 s is local only.
   3. "Garderob": all 37 achievements with the reward item. Open = the item in colour + "Använd" / "På dig".
      Locked = a dark silhouette + a lock + how to get it + progress (RPC my_unlock_progress, 0508; old server = no bar).
      Opened from the unlock sheet and from a row in Profil → Mitt (added next to "Min uniform").
   No new window.* global: public = PN.unlocks = { open, check, row }. No emoji in this file (PNI icons). */
(function () {
  "use strict";
  var PN = window.PN = window.PN || {};
  var I = window.I18N;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function AV() { var a = window.AVATAR; return a && a.on && a.on() && a.addPart ? a : null; }
  function DATA() { var d = PN.unlockData; if (d) d.ready(); return d; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ic(n) { try { return window.PNI ? window.PNI.svg(n) : ""; } catch (e) { return ""; } }
  function reduced() { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function toast(m, o) { try { PN.toast(m, o || {}); } catch (e) {} }

  var CSS = ".ul-hero{position:relative;height:200px;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:var(--ds-r-3,16px);background:var(--ds-raised,rgba(255,255,255,.06));margin:4px 0 12px}" +
    ".ul-rays{position:absolute;inset:-60%;background:repeating-conic-gradient(from 0deg,var(--ds-amber-soft,rgba(255,194,77,.18)) 0 10deg,transparent 10deg 30deg);animation:ul-spin 14s linear infinite;opacity:.9}" +
    ".ul-av{position:relative;width:150px;height:150px;animation:ul-pop .7s cubic-bezier(.2,1.6,.4,1) both}.ul-av svg{width:100%;height:100%;display:block}" +
    ".ul-sp{position:absolute;width:10px;height:10px;color:var(--ds-amber,#ffc24d);animation:ul-tw 1.6s ease-in-out infinite}.ul-sp svg{width:100%;height:100%}" +
    ".ul-sp.a{left:18%;top:20%}.ul-sp.b{right:20%;top:28%;animation-delay:.5s}.ul-sp.c{left:26%;bottom:16%;animation-delay:1s}.ul-sp.d{right:16%;bottom:22%;animation-delay:.25s}" +
    "@keyframes ul-spin{to{transform:rotate(360deg)}}@keyframes ul-pop{0%{transform:scale(.55);opacity:0}60%{transform:scale(1.08);opacity:1}100%{transform:scale(1)}}" +
    "@keyframes ul-tw{0%,100%{transform:scale(.4);opacity:.2}50%{transform:scale(1.15);opacity:1}}" +
    "@media (prefers-reduced-motion:reduce){.ul-rays,.ul-av,.ul-sp{animation:none!important}.ul-sp{opacity:.8}}" +
    ".ul-name{font-size:var(--ds-fs-22,22px);font-weight:700;text-align:center;margin:0}.ul-tier{display:block;width:max-content;margin:6px auto 0;padding:2px 10px;border-radius:var(--ds-r-pill,99px);font-size:var(--ds-fs-12,12px);font-weight:600;background:var(--ds-amber-soft,rgba(255,194,77,.18));color:var(--ds-amber-t,var(--ds-amber,#ffc24d))}" +
    ".ul-tier.t3{background:var(--ds-blue-soft,rgba(74,163,255,.18));color:var(--ds-blue-t,var(--ds-blue,#4aa3ff))}.ul-tier.t1{background:var(--ds-green-soft,rgba(61,220,132,.16));color:var(--ds-green-t,var(--ds-green,#3ddc84))}" +
    ".ul-why{text-align:center;color:var(--ds-muted,#9aa4b2);margin:8px 0 14px;font-size:var(--ds-fs-14,14px)}" +
    ".ul-pick{display:flex;gap:8px;overflow-x:auto;padding:2px 0 10px;margin-bottom:6px}.ul-pick button{flex:0 0 56px;height:56px;border-radius:var(--ds-r-2,12px);border:2px solid transparent;background:var(--ds-raised,rgba(255,255,255,.06));padding:2px}" +
    ".ul-pick button[aria-pressed=true]{border-color:var(--ds-amber,#ffc24d)}.ul-pick svg{width:100%;height:100%}" +
    ".ul-acts{display:grid;gap:8px}.ul-link{display:block;margin:10px auto 0;background:none;border:0;color:var(--ds-amber-t,var(--ds-amber,#ffc24d));font-weight:600;min-height:44px}" +
    ".ul-sum{margin:0 0 6px;color:var(--ds-muted,#9aa4b2)}.ul-bar{height:6px;border-radius:99px;background:var(--ds-raised,rgba(255,255,255,.08));overflow:hidden}.ul-bar>span{display:block;height:100%;background:var(--ds-amber,#ffc24d)}" +
    ".ul-f{display:flex;gap:6px;margin:12px 0}.ul-f button{min-height:36px;padding:0 12px;border-radius:var(--ds-r-pill,99px);border:1px solid var(--ds-border,rgba(255,255,255,.14));background:none;color:inherit}" +
    ".ul-f button[aria-pressed=true]{background:var(--ds-amber,#ffc24d);color:var(--ds-on-amber,#1a1300);border-color:transparent}" +
    ".ul-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;list-style:none;margin:0;padding:0}" +
    ".ul-card{display:flex;flex-direction:column;gap:4px;padding:10px;border-radius:var(--ds-r-3,16px);background:var(--ds-card,rgba(255,255,255,.05));border:1px solid var(--ds-border,rgba(255,255,255,.1));min-width:0}" +
    ".ul-art{position:relative;height:96px;border-radius:var(--ds-r-2,12px);background:var(--ds-raised,rgba(255,255,255,.06));display:flex;align-items:center;justify-content:center}.ul-art svg{width:88px;height:88px}" +
    ".ul-card.locked .ul-art svg{filter:brightness(0);opacity:.35}.ul-lk{position:absolute;right:6px;top:6px;width:20px;height:20px;color:var(--ds-muted,#9aa4b2)}.ul-lk svg{width:100%;height:100%;filter:none!important;opacity:1!important}" +
    ".ul-it{font-weight:700;font-size:var(--ds-fs-14,14px)}.ul-ach{font-size:var(--ds-fs-12,12px);color:var(--ds-muted,#9aa4b2);display:flex;gap:4px;align-items:center}.ul-ach svg{width:14px;height:14px;flex:0 0 14px}" +
    ".ul-how{font-size:var(--ds-fs-12,12px);line-height:1.35}.ul-pr{font-size:var(--ds-fs-12,12px);color:var(--ds-muted,#9aa4b2)}" +
    ".ul-card .btn{min-height:40px;margin-top:auto}.ul-on{margin-top:auto;text-align:center;font-weight:600;color:var(--ds-green-t,var(--ds-green,#3ddc84));min-height:40px;line-height:40px}";
  var cssDone = false;
  function css() { if (cssDone) return; cssDone = true; var s = document.createElement("style"); s.id = "ul-css"; s.textContent = CSS; document.head.appendChild(s); }

  /* ---------- What is open ---------- */
  function split(k) { var p = k.split(":"); return [p[0], +p[1]]; }
  function catOf(key) { var d = DATA(); if (!d) return null; for (var i = 0; i < d.CAT.length; i++) if (d.CAT[i].reward === key) return d.CAT[i]; return null; }
  // open now, not only because a season window is open (a season start is no "you unlocked")
  function openNoSeason(a, lk, f) {
    if (!lk) return false;
    if (!lk.d) return a.unlocked(lk, f);
    return !!(lk.o && lk.o.some(function (x) { return !x.d && a.unlocked(x, f); }));
  }
  function openKeys(a, f) {
    var out = [];
    Object.keys(a.LOCKS).forEach(function (k) {
      var p = split(k);
      if (!a.NAMES[p[0]] || p[1] > a.MAX[p[0]] || (a.isRetired && a.isRetired(p[0], p[1]))) return;
      if (openNoSeason(a, a.LOCKS[k], f)) out.push(k);
    });
    return out;
  }
  var KEY = "olnu.unl.v1";
  function check() {
    var a = AV(); if (!a || !DATA()) return [];
    var me = a.meRaw(); if (!me || !me.facts) return [];
    var now = openKeys(a, me.facts), st = lsGet(KEY), who = String(me.seed || "");
    if (!st || st.s !== who || !Array.isArray(st.k)) { lsSet(KEY, { s: who, k: now }); return []; }   // first look: store only
    var seen = {}; st.k.forEach(function (k) { seen[k] = 1; });
    var fresh = now.filter(function (k) { return !seen[k]; });
    if (!fresh.length) return [];
    lsSet(KEY, { s: who, k: st.k.concat(fresh) });
    fresh.sort(function (x, y) { var cx = catOf(x), cy = catOf(y); return (cy ? 10 + cy.tier : a.rarity.apply(null, split(y))) - (cx ? 10 + cx.tier : a.rarity.apply(null, split(x))); });
    // calm2 (I-79): the unlock sheet only when idle on the map (never over a sheet or while typing), max one per start; more = a dot
    if (window.CALM && window.CALM.unlock) window.CALM.unlock(function () { showSheet(fresh); }, fresh.length); else showSheet(fresh);
    return fresh;
  }

  /* ---------- Art ---------- */
  var LAYER = { hw: "hat", up: "top", nk: "nk", gl: "glasses", fr: "frame", bg: "bg", hi: "held", mt: "face", sk: "head", ey: "face", fp: "face", er: "earring", fh: "beard", hr: "hairF" };
  function mySpec(a) { var me = a.meRaw() || {}; return me.spec ? JSON.parse(JSON.stringify(me.spec)) : a.defaultSpec(me.seed || "x", (me.facts && me.facts.r) || 1); }
  function wearing(a, key) { var p = split(key), me = a.meRaw(); return !!(me && me.spec && (me.spec[p[0]] | 0) === p[1]); }
  function avatarWith(a, key) { var p = split(key), s = mySpec(a), me = a.meRaw() || {}; s[p[0]] = p[1]; return a.svg(s, { r: (me.facts && me.facts.r) || 1 }); }
  function itemArt(a, key) {   // only the item's own layer (a silhouette when locked)
    var p = split(key), s = { v: 2, sk: 3, fs: 0, uc: 0, bg: 0, hr: 0 }; s[p[0]] = p[1];
    var vb = (a.tileVB && a.tileVB(p[0])) || "0 0 100 100", L0 = null;
    try { L0 = a._layers(s, { vb: vb }); } catch (e) { L0 = null; }
    var x = L0 && L0[LAYER[p[0]] || "hat"];
    return x || a.svg(s, { vb: vb });
  }
  function itemName(a, key) { var p = split(key), n = (a.NAMES[p[0]] || [])[p[1]]; return n ? (sv() ? n[0] : n[1]) : key; }
  function tierOf(a, key) { var c = catOf(key); if (c) return c.tier; var r = a.rarity.apply(null, split(key)); return r >= 3 ? 3 : r >= 2 ? 2 : 1; }
  function why(a, key) {
    var c = catOf(key);
    if (c) return L("Belöning för ", "Reward for ") + (sv() ? c.name[0] : c.name[1]) + ": " + (sv() ? c.how[0] : c.how[1]);
    var t = a.lockText(a.LOCKS[key] || {}); return t.replace(/^Låses upp /, L("Upplåst ", "Unlocked ")).replace(/^Unlocks /, "Unlocked ");
  }

  /* ---------- Use it now ---------- */
  function equip(key, after) {
    var a = AV(); if (!a) return;
    var p = split(key), name = itemName(a, key), tries = 0;
    var go = function () {
      a.equip(p[0], p[1]).then(function (r) {
        if (r && r.ok) { toast(L("Snyggt! Nu har du på dig " + name + ".", "Nice! You are wearing " + name + " now.")); if (after) after(true); return; }
        var code = r && r.code;
        if (code === "slow_down" && tries++ < 1) { setTimeout(go, 2200); return; }
        if (code === "no_spec") { try { PN.closeSheet(); } catch (e) {} a.openEditor(); return; }
        toast(code === "locked" ? L("Den är inte upplåst än.", "It is not unlocked yet.") : code === "invalid_avatar" ? L("Servern känner inte igen den än. Prova senare.", "The server does not know it yet. Try later.")
          : L("Gick inte att spara. Prova igen.", "Could not save. Try again."), { err: true });
        if (after) after(false);
      });
    };
    go();
  }

  /* ---------- The unlock sheet ---------- */
  function spark() { return '<span class="ul-sp a" aria-hidden="true">' + ic("sparkle") + '</span><span class="ul-sp b" aria-hidden="true">' + ic("star") + '</span><span class="ul-sp c" aria-hidden="true">' + ic("star") + '</span><span class="ul-sp d" aria-hidden="true">' + ic("sparkle") + "</span>"; }
  function showSheet(keys, o) {
    var a = AV(); if (!a || !keys.length || !PN.openSheet) return;
    css();
    var sel = keys[0], one = keys.length === 1;
    var title = one ? L("Du låste upp: ", "You unlocked: ") + itemName(a, sel) : L("Du låste upp " + keys.length + " saker", "You unlocked " + keys.length + " things");
    PN.openSheet(title, function (b) {
      b.classList.add("ul-sheet");
      var hero = document.createElement("div"); hero.className = "ul-hero"; b.appendChild(hero);
      var name = document.createElement("h3"); name.className = "ul-name"; b.appendChild(name);
      var tier = document.createElement("span"); tier.className = "ul-tier"; b.appendChild(tier);
      var whyEl = document.createElement("p"); whyEl.className = "ul-why"; b.appendChild(whyEl);
      var paint = function () {
        hero.innerHTML = '<div class="ul-rays" aria-hidden="true"></div><div class="ul-av" role="img" aria-label="' + esc(L("Din karaktär med ", "Your character with ") + itemName(a, sel)) + '">' + avatarWith(a, sel) + "</div>" + spark();
        name.textContent = itemName(a, sel);
        var t = tierOf(a, sel); tier.className = "ul-tier t" + t; tier.textContent = DATA().TIER[t][sv() ? 0 : 1];
        whyEl.textContent = why(a, sel);
        use.textContent = wearing(a, sel) ? L("Du har den på dig", "You are wearing it") : L("Använd nu", "Use now");
        use.disabled = wearing(a, sel);
      };
      if (!one) {
        var pick = document.createElement("div"); pick.className = "ul-pick"; pick.setAttribute("role", "group"); pick.setAttribute("aria-label", L("Välj sak", "Pick an item"));
        keys.forEach(function (k) {
          var t = document.createElement("button"); t.type = "button"; t.setAttribute("data-k", k); t.setAttribute("aria-label", itemName(a, k)); t.setAttribute("aria-pressed", String(k === sel));
          t.innerHTML = itemArt(a, k);
          t.addEventListener("click", function () { sel = k; pick.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === t)); }); paint(); });
          pick.appendChild(t);
        });
        b.appendChild(pick);
      }
      var acts = document.createElement("div"); acts.className = "ul-acts";
      var use = document.createElement("button"); use.type = "button"; use.className = "btn btn-amber btn-block ul-use";
      use.addEventListener("click", function () { use.disabled = true; equip(sel, function (ok) { if (ok) { try { PN.closeSheet(); } catch (e) {} } else use.disabled = false; }); });
      var later = document.createElement("button"); later.type = "button"; later.className = "btn btn-block btn-ghost ul-later"; later.textContent = L("Senare", "Later");
      later.addEventListener("click", function () { try { PN.closeSheet(); } catch (e) {} });
      acts.appendChild(use); acts.appendChild(later); b.appendChild(acts);
      var gl = document.createElement("button"); gl.type = "button"; gl.className = "ul-link"; gl.textContent = L("Öppna Garderob", "Open the wardrobe");
      gl.addEventListener("click", openGarderob); b.appendChild(gl);
      paint();
      if (!reduced()) { try { if (window.FX && window.FX.vibrate) window.FX.vibrate([20, 30, 40]); } catch (e) {} }
    }, o || {});
  }

  /* ---------- Garderob ---------- */
  var prog = null, progAt = 0;
  function loadProgress() {
    if (prog && Date.now() - progAt < 60000) return Promise.resolve(prog);
    if (!PN.rpc || !(PN.s && PN.s.authed)) return Promise.resolve(null);
    return PN.rpc("my_unlock_progress", {}).then(function (r) {
      if (!r || r.error) return null;
      var d = r.data; if (typeof d === "string") { try { d = JSON.parse(d); } catch (e) { d = null; } }
      prog = d && d.c ? d.c : null; progAt = Date.now(); return prog;
    }, function () { return null; });
  }
  function counts(a) {
    var me = a.meRaw(), f = (me && me.facts) || {}, n = 0, d = DATA();
    d.CAT.forEach(function (c) { if (a.usable.apply(null, split(c.reward).concat([f]))) n++; });
    return { open: n, all: d.CAT.length };
  }
  function openGarderob() {
    var a = AV(), d = DATA(); if (!a || !d || !PN.openSheet) return;
    css();
    var filter = "all";
    PN.openSheet(L("Garderob", "Wardrobe"), function (b) {
      b.classList.add("ul-gard");
      var me = a.meRaw(), f = (me && me.facts) || {}, n = counts(a);
      var sum = document.createElement("p"); sum.className = "ul-sum"; sum.textContent = L(n.open + " av " + n.all + " upplåsta. Ingen av dem kräver att du dricker mer.", n.open + " of " + n.all + " unlocked. None of them needs you to drink more.");
      var bar = document.createElement("div"); bar.className = "ul-bar"; bar.innerHTML = '<span style="width:' + Math.round(100 * n.open / Math.max(1, n.all)) + '%"></span>';
      b.appendChild(sum); b.appendChild(bar);
      var fl = document.createElement("div"); fl.className = "ul-f"; fl.setAttribute("role", "group"); fl.setAttribute("aria-label", L("Visa", "Show"));
      [["all", L("Alla", "All")], ["open", L("Upplåsta", "Unlocked")], ["locked", L("Låsta", "Locked")]].forEach(function (x) {
        var t = document.createElement("button"); t.type = "button"; t.textContent = x[1]; t.setAttribute("data-f", x[0]); t.setAttribute("aria-pressed", String(x[0] === filter));
        t.addEventListener("click", function () { filter = x[0]; fl.querySelectorAll("button").forEach(function (y) { y.setAttribute("aria-pressed", String(y === t)); }); paint(); });
        fl.appendChild(t);
      });
      b.appendChild(fl);
      var grid = document.createElement("ul"); grid.className = "ul-grid"; b.appendChild(grid);
      var paint = function () {
        me = a.meRaw(); f = (me && me.facts) || {};
        var list = d.CAT.map(function (c) { var p = split(c.reward); return { c: c, open: a.usable(p[0], p[1], f) }; });
        list.sort(function (x, y) { return (y.open - x.open) || ((prog ? (prog[y.c.key] | 0) / y.c.need : 0) - (prog ? (prog[x.c.key] | 0) / x.c.need : 0)); });
        grid.innerHTML = "";
        list.forEach(function (x) {
          if ((filter === "open" && !x.open) || (filter === "locked" && x.open)) return;
          var c = x.c, li = document.createElement("li"); li.className = "ul-card" + (x.open ? " open" : " locked"); li.setAttribute("data-u", c.id); li.setAttribute("data-k", c.reward);
          var have = prog ? Math.min(c.need, prog[c.key] | 0) : null;
          li.innerHTML = '<div class="ul-art" role="img" aria-label="' + esc(itemName(a, c.reward) + (x.open ? "" : L(" (låst)", " (locked)"))) + '">' + itemArt(a, c.reward) + (x.open ? "" : '<span class="ul-lk" aria-hidden="true">' + ic("lock") + "</span>") + "</div>" +
            '<span class="ul-it">' + esc(itemName(a, c.reward)) + '</span><span class="ul-ach">' + ic(c.icon) + "<span>" + esc(sv() ? c.name[0] : c.name[1]) + " · " + esc(d.TIER[c.tier][sv() ? 0 : 1]) + "</span></span>" +
            (x.open ? "" : '<span class="ul-how">' + esc(sv() ? c.how[0] : c.how[1]) + "</span>" + (have != null ? '<span class="ul-pr">' + have + " / " + c.need + '</span><div class="ul-bar"><span style="width:' + Math.round(100 * have / c.need) + '%"></span></div>' : ""));
          if (x.open) {
            if (wearing(a, c.reward)) { var on = document.createElement("span"); on.className = "ul-on"; on.textContent = L("På dig", "Wearing"); li.appendChild(on); }
            else {
              var u = document.createElement("button"); u.type = "button"; u.className = "btn btn-small ul-use"; u.textContent = L("Använd", "Use");
              u.addEventListener("click", function () { u.disabled = true; equip(c.reward, function () { paint(); }); });
              li.appendChild(u);
            }
          }
          grid.appendChild(li);
        });
      };
      paint();
      loadProgress().then(function (p) { if (p && b.isConnected) paint(); });
    });
  }

  /* ---------- Profil → Mitt: one row next to "Min uniform" (pnui.js builds the list; we add our row when it appears) ---------- */
  function row() {
    var a = AV(), d = DATA(); if (!a || !d) return null;
    var n = counts(a);
    var r = document.createElement("button"); r.type = "button"; r.className = "ds-row pn-row ul-row";
    r.innerHTML = '<span class="ds-row-i">' + ic("sparkle") + '</span><span class="ds-row-t"><span>' + esc(L("Garderob", "Wardrobe")) + "</span><small>" + esc(L(n.open + " av " + n.all + " kläder upplåsta", n.open + " of " + n.all + " clothes unlocked")) + '</small></span><span class="ds-chev"></span>';
    r.addEventListener("click", openGarderob);
    return r;
  }
  function addRow() {
    var list = document.querySelector("#sheet-body .pn-pf .ds-list");
    if (!list || list.querySelector(".ul-row")) return;
    var r = row(); if (!r) return;
    var first = list.firstElementChild;
    if (first && first.nextSibling) list.insertBefore(r, first.nextSibling); else list.appendChild(r);
  }

  /* ---------- When to look ---------- */
  var sig = null, hiddenAt = 0, busy = false;
  function medalSig() { try { var m = window.MEDALS && window.MEDALS.mine(); return m ? Object.keys(m).sort().map(function (k) { return k + (m[k].count | 0); }).join(",") : ""; } catch (e) { return ""; } }
  function refresh() {
    var a = AV(); if (!a || busy) return;
    busy = true;
    a.loadMe(true).then(function () { busy = false; check(); }, function () { busy = false; });
  }
  function tick() {
    if (document.hidden) return;
    var a = AV(); if (!a) return;
    var me = a.meRaw(); if (!me || !me.facts) return;
    var s = medalSig();
    if (sig === null) { sig = s; check(); return; }
    if (s !== sig) { sig = s; refresh(); }
  }
  function start() {
    DATA();
    setInterval(tick, 15000);
    setTimeout(tick, 4000);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > 600000) refresh();
    });
    var body = document.getElementById("sheet-body");
    if (body && window.MutationObserver) new MutationObserver(addRow).observe(body, { childList: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();

  PN.unlocks = { open: openGarderob, check: check, row: row, show: showSheet, _openKeys: function () { var a = AV(), me = a && a.meRaw(); return a && me ? openKeys(a, me.facts || {}) : []; } };
})();
