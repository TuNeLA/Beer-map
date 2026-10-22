/* Öl Nu — 🤝 VÄNNER 2 (friends2; CONTRACT "🤝 VÄNNER 2", migrations 0154–0156).
   Owner: "Let me remove friends even if they came from a group, and stop adding group people automatically –
   give me a button to add them as a friend in the group list."
   1. Group sharing is no longer friendship. 0154 turned today's group-mates into real friendships once; from now
      on only accepted friendships are friends (Vänner tab, friend-only find share). Group features stay on groups.
   2. ➕ Lägg till vän on every member row in Medlemmar (social.js showStatus → FRIENDS2.statusRow) and on every row
      of the 🟢 NU person sheet (hitta.js nowSheet → FRIENDS2.nowRow). State from group_friend_states (0155):
      "✓ Vän" · "⏳ Skickad" · "✅ Acceptera" (they asked me; friend_request accepts at once) · ➕ Lägg till vän.
      Sends the normal friend_request(p_group_id, p_k) + push {event:"friend"}; the other person answers in 🔔 Inkorg.
   3. Vänner rows: "⋯" (near.js friendRow → FRIENDS2.menu) or a long-press (FRIENDS2.decorate) → "🗑️ Ta bort vän"
      → confirm → friend_remove. No notice to the other person. They do not come back by themselves (shared group or not).
   Hooks (app.js mods): init. Public: statusRow(g, m, row), nowRow(g, p, li), menu(li, f, onChange),
   decorate(li, f, onChange), ownsAdd(), states(gid, force). Missing RPC (old server) → the buttons hide. */
(function () {
  "use strict";
  var I = window.I18N;
  var A = null, off = false, cache = {}, LP_MS = 550;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  var lastPick = {};
  function pick(k, a) { var i = Math.floor(Math.random() * a.length); if (a.length > 1 && i === lastPick[k]) i = (i + 1) % a.length; lastPick[k] = i; return a[i]; }
  function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }); }
  var T = {
    sent: ["🤝 Förfrågan skickad till {n}. Hen svarar i 🔔 Inkorgen.", "🤝 Rekryteringsbrevet till {n} ä postat.", "🤝 {n} har fått din vänförfrågan. Håll ställningarna.",
      "🤝 Brevduvan flög iväg till {n}.", "🤝 Signal skickad till {n}. Inväntar kvittens.", "🤝 {n} får bestämma själv. Förfrågan ä ute."],
    now: ["🤝 Nu ä ni vänner, du och {n}!", "🤝 Alliansen med {n} ä spikad.", "🤝 Vänskapsfördrag undertecknat med {n}.", "🤝 {n} ä din vän nu. Skål på't!"],
    gone: ["🗑️ {n} ä borta ur vänlistan. Inga sura miner.", "🗑️ Klart. {n} ä int' längre i din vänlista.", "🗑️ Avmönstrad: {n}. Hen får ingen avisering.",
      "🗑️ {n} ä struken ur rullorna. Gruppen ä som förut."],
    ask: ["Ta bort {n} ur vänlistan?", "Stryka {n} ur rullorna?", "Avmönstra {n} som vän?"]
  };
  function errOf(e) {
    var m = String((e && (e.message || e.details)) || e || "");
    var c = ["slow_down", "friend_limit", "not_member", "invalid_member", "friend_req_not_found"].filter(function (x) { return m.indexOf(x) >= 0; })[0];
    if (c === "slow_down") return L("Lugn i stormen. Vänta en stund.", "Easy. Wait a while.");
    if (c === "friend_limit") return L("Vänlistan ä full (300).", "Friend list is full (300).");
    if (c === "not_member" || c === "invalid_member") return L("Hen ä int' kvar i gruppen.", "Not in the group any more.");
    if (c === "friend_req_not_found") return L("Dä ä redan borta.", "Already gone.");
    return L("Dä gick int'. Försök igen.", "That did not work.");
  }
  function myName() { try { return (A.getName && A.getName()) || null; } catch (e) { return null; } }
  function push(body) { try { if (A.PUSH_ON && A.invoke) A.invoke("notify-group", body); } catch (e) {} }
  function stop(e) { if (e) { e.stopPropagation(); } }

  /* ---------- group member friend states (0155) ---------- */
  function states(gid, force) {
    if (off || !A || !A.LIVE || !gid) return Promise.resolve(null);
    var c = cache[gid];
    if (!force && c && (c.p || Date.now() - c.at < 20000)) return c.p || Promise.resolve(c.d);
    var p = A.rpc("group_friend_states", { p_group_id: gid }).then(function (r) {
      cache[gid] = { at: Date.now(), d: null };
      if (r.error) { if (window.U && window.U.missing && window.U.missing(r.error)) off = true; return null; }
      var d = A.parseData(r.data) || {}, byK = {}, byName = {};
      (d.states || []).forEach(function (x) { if (x && x.k) { byK[x.k] = x; if (x.name) byName[x.name] = x; } });
      cache[gid].d = { byK: byK, byName: byName };
      return cache[gid].d;
    });
    cache[gid] = { at: Date.now(), p: p };
    return p;
  }
  function setState(gid, k, s) {
    var c = cache[gid]; if (!c || !c.d || !c.d.byK[k]) return;
    c.d.byK[k].s = s;
    document.querySelectorAll('[data-f2k="' + k + '"]').forEach(function (n) { paint(n, gid, c.d.byK[k]); });
  }
  // One control: a button (➕ / ✅ Acceptera) or a quiet chip (✓ Vän / ⏳ Skickad).
  function paint(node, gid, x) {
    node.innerHTML = "";
    var s = x.s || "none";
    if (s === "friend" || s === "out") {
      node.appendChild(A.el("span", { class: "f2-chip" + (s === "friend" ? " ok" : ""), text: s === "friend" ? L("✓ Vän", "✓ Friend") : L("⏳ Skickad", "⏳ Sent") }));
      return;
    }
    var b = A.btn(s === "in" ? L("✅ Acceptera vän", "✅ Accept friend") : L("➕ Lägg till vän", "➕ Add friend"), "btn-small f2-add" + (s === "in" ? " btn-green" : ""), function (e) {
      stop(e); send(gid, x, b);
    });
    b.setAttribute("aria-label", (s === "in" ? L("Acceptera ", "Accept ") : L("Lägg till ", "Add ")) + (x.name || "") + L(" som vän", " as friend"));
    node.appendChild(b);
  }
  function send(gid, x, b) {
    b.disabled = true;
    A.rpc("friend_request", { p_group_id: gid, p_k: x.k, p_name: myName() }).then(function (r) {
      if (r.error) { b.disabled = false; A.toast(errOf(r.error), { err: true, id: "f2" }); return; }
      var d = A.parseData(r.data) || {}, n = d.name || x.name || "";
      if (d.status === "accepted") {
        A.toast(sv() ? fill(pick("now", T.now), { n: n }) : "🤝 You and " + n + " are friends now!", { cls: "skal", id: "f2" });
        setState(gid, x.k, "friend");
      } else {
        A.toast(sv() ? fill(pick("sent", T.sent), { n: n }) : "🤝 Request sent to " + n + ".", { id: "f2" });
        setState(gid, x.k, "out");
        if (!d.already && d.id) push({ event: "friend", friend_id: d.id });
      }
      try { window.FX.vibrate(20); } catch (e) {}
      try { if (window.SUGGEST && window.SUGGEST.refresh) window.SUGGEST.refresh(); } catch (e) {}
    });
  }
  function mount(gid, x, holder) {
    var n = A.el("span", { class: "f2-slot", "data-f2k": x.k });
    holder.appendChild(n);
    paint(n, gid, x);
  }
  // Medlemmar row (social.js showStatus, after AFTER.statusRow).
  function statusRow(g, m, row) {
    if (off || !A || !A.LIVE || !g || !g.id || !m || m.is_me || !m.k || !row) return;
    states(g.id).then(function (d) {
      if (!d || !document.body.contains(row) || row.querySelector(".f2-slot")) return;
      var x = d.byK[m.k]; if (!x) return;
      mount(g.id, x, row.querySelector(".st-main") || row);
    });
  }
  // 🟢 NU person sheet row (hitta.js nowSheet): match by the group display name.
  function nowRow(g, p, li) {
    if (off || !A || !A.LIVE || !g || !g.id || !p || p.me || !p.name || !li) return;
    states(g.id).then(function (d) {
      if (!d || !document.body.contains(li) || li.querySelector(".f2-slot")) return;
      var x = d.byName[p.name]; if (!x) return;
      li.classList.add("f2-nowrow");
      mount(g.id, x, li);
    });
  }

  /* ---------- Vänner row: ⋯ / long-press → 🗑️ Ta bort vän → confirm ---------- */
  function closeMenus(except) {
    document.querySelectorAll(".f2-menu").forEach(function (n) { if (n !== except) n.remove(); });
  }
  function menu(li, f, onChange) {
    if (!A || !li || !f || f.id == null || !li.parentNode) return;
    var nx = li.nextSibling;
    if (nx && nx.classList && nx.classList.contains("f2-menu")) { nx.remove(); return; }
    closeMenus();
    var nm = f.name || L("vännen", "this friend");
    var box = A.el("li", { class: "f2-menu", role: "group", "aria-label": L("Val för ", "Options for ") + nm });
    function first() {
      box.innerHTML = "";
      box.appendChild(A.el("div", { class: "row f2-acts" }, [
        A.btn(L("🗑️ Ta bort vän", "🗑️ Remove friend"), "btn-small f2-rm", function (e) { stop(e); confirm(); }),
        A.btn(L("Stäng", "Close"), "btn-small btn-ghost f2-close", function (e) { stop(e); box.remove(); })]));
    }
    function confirm() {
      box.innerHTML = "";
      box.classList.add("confirm");
      box.appendChild(A.el("p", { class: "f2-q" }, [A.el("b", { text: sv() ? fill(pick("ask", T.ask), { n: nm }) : "Remove " + nm + "?" })]));
      box.appendChild(A.el("p", { class: "muted f2-note", text: L("Hen får ingen avisering. \"Låt vännerna hitta mig\" slutar gälla för hen. Delar ni en grupp syns ni fortfarande där – men hen kommer int' tillbaka i vänlistan av sig själv.",
        "They get no notice. \"Let my friends find me\" stops for them. Shared groups stay as they are – but they do not come back to the list by themselves.") }));
      var yes = A.btn(L("🗑️ Ta bort", "🗑️ Remove"), "btn-small btn-danger f2-yes", function (e) {
        stop(e); yes.disabled = true;
        A.rpc("friend_remove", { p_id: f.id }).then(function (r) {
          if (r.error) { yes.disabled = false; A.toast(errOf(r.error), { err: true, id: "f2" }); return; }
          A.toast(sv() ? fill(pick("gone", T.gone), { n: f.name || "" }) : "Friend removed.", { id: "f2" });
          box.remove();
          li.classList.add("f2-gone");
          cache = {};
          try { if (window.SUGGEST && window.SUGGEST.refresh) window.SUGGEST.refresh(); } catch (e2) {}
          setTimeout(function () { try { li.remove(); } catch (e3) {} if (onChange) onChange(); }, 200);
        });
      });
      box.appendChild(A.el("div", { class: "row" }, [A.btn(L("Avbryt", "Cancel"), "btn-small f2-no", function (e) { stop(e); box.remove(); }), yes]));
      try { yes.focus(); } catch (e) {}
    }
    first();
    li.parentNode.insertBefore(box, li.nextSibling);
  }
  function decorate(li, f, onChange) {
    if (!li || !f || li._f2) return;
    li._f2 = true;
    var tm = 0, sx = 0, sy = 0;
    function cancel() { clearTimeout(tm); tm = 0; }
    li.addEventListener("pointerdown", function (e) {
      if (e.target && e.target.closest && e.target.closest("button")) return;
      sx = e.clientX; sy = e.clientY; cancel();
      tm = setTimeout(function () { tm = 0; try { navigator.vibrate && navigator.vibrate(15); } catch (x) {} menu(li, f, onChange); }, LP_MS);
    });
    li.addEventListener("pointermove", function (e) { if (tm && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) cancel(); });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (t) { li.addEventListener(t, cancel); });
    li.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  window.FRIENDS2 = {
    init: function (api) { A = api; },
    statusRow: function (g, m, row) { try { statusRow(g, m, row); } catch (e) {} },
    nowRow: function (g, p, li) { try { nowRow(g, p, li); } catch (e) {} },
    menu: menu, decorate: decorate,
    ownsAdd: function () { return !off && !!A && !!A.LIVE; },
    states: states, _T: T
  };
})();
