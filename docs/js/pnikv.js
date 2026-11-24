/* PintsNow — "Ikväll" status chip (ds35, owner 2026-11-08: "top-left under LIVE is empty; I was used to a control there").
   One chip at the start of the HUD row (top-left, under the LIVE ticker), like the status chip at the leading edge of a map
   chip row (Google Maps: chips row under the search bar, leading first; Apple HIG: controls in the top corners, map stays
   clear). It shows MY status for tonight (icon + word: Ute / Kanske / Hemma, or "Ikväll?") and opens a small menu:
     Ute · Kanske · Hemma (the ONE segmented control) · Jag kör ikväll (switch) · Följ mig hem · Hämta mig · Vilka ska ut?
   No logic of its own: status = PNUI (pnui.js setIkv / ikvall_set), driving = SKJUTS.setDriver, Följ mig hem = HEMFOLJ.open,
   Hämta mig = SKJUTS.openPickup, the list = PNUI.openIkvall. Never over the right rail; the urgent chip ("Kolla till …")
   sits right after it in the same row. Hidden while a sheet is open, in public / demo mode and before sign-in. window.PNIKV. */
(function () {
  "use strict";
  function L(s, e) { return window.I18N && window.I18N.lang === "en" ? e : s; }   // E8: sv / en (the language is fixed per page load)
  var ST = { ute: ["beer", L("Ute", "Out")], kanske: ["help", L("Kanske", "Maybe")], hemma: ["home", L("Hemma", "Home")] };
  var chip = null, menu = null, sig = "";
  function W(n) { return window[n] || null; }
  function ic(n, c) { try { return W("PNI") ? W("PNI").svg(n, c || "") : ""; } catch (e) { return ""; } }
  function api() { try { var D = W("PNDS"); return D && D._A ? D._A() : null; } catch (e) { return null; } }
  function live() { var A = api(); try { return !!(A && A.LIVE && (!A.authed || A.authed())); } catch (e) { return false; } }
  function ikv() { try { var P = W("PNUI"); return P && P._ikvRaw ? P._ikvRaw() : null; } catch (e) { return null; } }
  function mine() { var k = ikv(); return k && k.d ? k.d.mine || null : null; }
  function sheetOpen() { var s = document.getElementById("sheet"); return !!(s && !s.hidden); }
  function driving() { try { return !!(W("SKJUTS") && W("SKJUTS").driving && W("SKJUTS").driving()); } catch (e) { return false; } }
  function walk() { try { var m = W("HEMFOLJ") && W("HEMFOLJ")._mine && W("HEMFOLJ")._mine(); return m && m.live ? m : null; } catch (e) { return null; } }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  /* ---------- the chip ---------- */
  function ensureChip() {
    var hl = document.querySelector(".hud-left"); if (!hl) return null;
    if (chip && chip.parentNode === hl) return chip;
    chip = document.getElementById("pn-ikv2") || el("button", "pn-ikv2");
    chip.id = "pn-ikv2"; chip.type = "button"; chip.setAttribute("aria-haspopup", "menu"); chip.setAttribute("aria-expanded", "false");
    chip.addEventListener("click", function (e) { e.stopPropagation(); menu ? close() : open(); });
    hl.insertBefore(chip, hl.firstChild);
    return chip;
  }
  function paint() {
    var c = ensureChip(); if (!c) return;
    var on = live() && !document.body.classList.contains("ba-edit");
    var m = mine(), s = ST[m], drv = driving(), w = !!walk();
    var k = [on, m, drv, w].join("|");
    if (c.hidden !== !on) c.hidden = !on;
    if (k === sig) return; sig = k;
    var word = s ? s[1] : L("Ikväll?", "Tonight?");
    c.className = "pn-ikv2" + (m ? " pn-ikv2-" + m : "");
    c.innerHTML = ic(s ? s[0] : "moon", "pn-ikv2-i") + '<span class="pn-ikv2-t">' + word + "</span>" +
      (drv ? '<span class="pn-ikv2-x" title="' + L("Du kör ikväll", "You drive tonight") + '">' + ic("taxi", "") + "</span>" : "") +
      (w ? '<span class="pn-ikv2-x" title="' + L("Följ mig hem på", "Walk me home on") + '">' + ic("walk", "") + "</span>" : "") + ic("chev-down", "pn-ikv2-c");
    c.setAttribute("aria-label", L("Ikväll: ", "Tonight: ") + (s ? s[1] : L("inte sagt än", "not set yet")) + (drv ? L(", du kör", ", you drive") : "") + (w ? L(", Följ mig hem på", ", Walk me home on") : "") + L(". Öppna menyn", ". Open the menu"));
    if (menu) fill();
  }

  /* ---------- the menu ---------- */
  function row(icon, title, sub, onClick, right) {
    var b = el("button", "pn-ikm-row", ic(icon, "pn-ikm-i") + '<span class="pn-ikm-l"><b>' + title + "</b>" + (sub ? "<small>" + sub + "</small>" : "") + "</span>" + (right || ic("chev-right", "pn-ikm-c")));
    b.type = "button"; b.addEventListener("click", onClick); return b;
  }
  function fill() {
    if (!menu) return;
    var m = mine(), drv = driving(), w = walk();
    menu.innerHTML = "";
    menu.appendChild(el("p", "pn-ikm-h", L("Ikväll", "Tonight")));
    var seg = el("div", "gm-seg pn-ikm-seg"); seg.setAttribute("role", "radiogroup"); seg.setAttribute("aria-label", L("Ikväll", "Tonight"));
    ["ute", "kanske", "hemma"].forEach(function (k) {
      var b = el("button", "pn-ikm-s", ic(ST[k][0], "") + "<span>" + ST[k][1] + "</span>");
      b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(m === k)); b.setAttribute("data-st", k);
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        if (m === k) return;   // ds60: tapping the current answer keeps it (Ikväll? sheet has "Ta bort mitt svar")
        var P = W("PNUI"); if (P && P.setIkv) P.setIkv(k); else if (P && P.openIkvall) { close(); P.openIkvall(); return; }
        sig = ""; paint();
      });
      seg.appendChild(b);
    });
    menu.appendChild(seg);
    var list = el("div", "pn-ikm-list");
    try { if (W("BOLD") && W("BOLD").menuRows) W("BOLD").menuRows(row, close).forEach(function (x) { list.appendChild(x); }); } catch (x) {}   // bold: Hem-läge, Skål!
    try { if (W("GAMES") && W("GAMES").menuRows) W("GAMES").menuRows(row, close).forEach(function (x) { list.appendChild(x); }); } catch (x) {}   // games: Vem fixar nästa?
    if (W("SKJUTS") && W("SKJUTS").setDriver) {
      var sw = '<span class="switch" aria-hidden="true" aria-checked="' + drv + '"></span>';
      var dr = row("taxi", L("Jag kör ikväll", "I drive tonight"), drv ? L("Gänget ser att du kör", "The crew sees that you drive") : L("Visa gänget att du kör", "Show the crew that you drive"), function (e) {
        e.stopPropagation(); var on = !driving(); dr.disabled = true; try { W("SKJUTS").setDriver(on, dr); } catch (x) {}
        setTimeout(function () { dr.disabled = false; sig = ""; paint(); }, 900);
      }, sw);
      dr.setAttribute("role", "switch"); dr.setAttribute("aria-checked", String(drv)); dr.classList.add("pn-ikm-sw");
      list.appendChild(dr);
    }
    if (W("HEMFOLJ") && W("HEMFOLJ").open) list.appendChild(row("home", L("Följ mig hem", "Walk me home"), w ? L("På · ", "On · ") + (w.watching | 0) + L(" följer", " watching") : L("Vänner ser dig hela vägen hem", "Friends see you all the way home"),
      function () { close(); try { W("HEMFOLJ").open({}); } catch (x) {} }));
    if (W("SKJUTS") && W("SKJUTS").openPickup) list.appendChild(row("sos", L("Hämta mig", "Pick me up"), L("Kan nån hämta mig?", "Can someone pick me up?"), function () { close(); try { W("SKJUTS").openPickup({}); } catch (x) {} }));
    if (W("PNUI") && W("PNUI").openIkvall) list.appendChild(row("users", L("Vilka ska ut?", "Who is going out?"), L("Dina vänner och gänget", "Your friends and the crew"), function () { close(); try { W("PNUI").openIkvall(); } catch (x) {} }));
    menu.appendChild(list);
  }
  function place() {
    if (!menu || !chip) return;
    var r = chip.getBoundingClientRect(), rail = document.querySelector(".pn-rail, #btn-more"), rr = rail && rail.getClientRects().length ? rail.getBoundingClientRect() : null;
    var maxR = rr ? rr.left - 8 : innerWidth - 12, w = Math.min(320, maxR - r.left);
    menu.style.left = Math.round(r.left) + "px"; menu.style.top = Math.round(r.bottom + 8) + "px"; menu.style.width = Math.round(w) + "px";
  }
  function open() {
    if (menu || !chip) return;
    menu = el("div", "pn-ikm"); menu.id = "pn-ikm"; menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", L("Ikväll", "Tonight"));
    menu.addEventListener("click", function (e) { e.stopPropagation(); });
    document.body.appendChild(menu); fill(); place();
    chip.setAttribute("aria-expanded", "true");
    setTimeout(function () { document.addEventListener("click", outside, true); document.addEventListener("keydown", esc); addEventListener("resize", place); }, 0);
    var f = menu.querySelector('[aria-checked="true"]') || menu.querySelector("button"); try { if (f && document.activeElement === chip) f.focus({ preventScroll: true }); } catch (x) {}
  }
  function close() {
    if (!menu) return;
    var m = menu; menu = null; m.classList.add("pn-ikm-out"); setTimeout(function () { m.remove(); }, 160);   // own class: .pn-out is the "N ute nu" card style (it made the menu jump while closing)
    if (chip) chip.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", outside, true); document.removeEventListener("keydown", esc); removeEventListener("resize", place);
  }
  function outside(e) { if (menu && !menu.contains(e.target) && !(chip && chip.contains(e.target))) close(); }
  function esc(e) { if (e.key === "Escape") { close(); if (chip) chip.focus(); } }

  function start() {
    paint();
    var keep = function () { paint(); if (menu && sheetOpen()) close(); };   // cheap: reads state, writes on change
    if (window.PN && PN.idle) PN.idle.every(keep, 1000); else setInterval(keep, 1000);   // timers B10: sleeps while the map is out of sight (runs once as a full sheet comes: the menu closes)
    if (window.MutationObserver) new MutationObserver(function () { sig = sig; ensureChip(); }).observe(document.body, { childList: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  // ds39: "Säker hem" for "⋯ Mer på kartan" (pnui openMore): the same two safety tools, as rows
  function safeRows() {
    var hasH = W("HEMFOLJ") && W("HEMFOLJ").open, hasP = W("SKJUTS") && W("SKJUTS").openPickup; if (!hasH && !hasP) return null;
    var f = document.createDocumentFragment(), w = walk();
    f.appendChild(el("h3", "pn-safe-h", L("Säker hem", "Safe home")));
    var list = el("div", "ds-list pn-list pn-safe");
    var mk = function (icon, t, s, fn) { var b = el("button", "ds-row pn-row", '<span class="ds-row-i">' + ic(icon, "") + '</span><span class="ds-row-t"><span>' + t + "</span><small>" + s + '</small></span><span class="ds-chev"></span>');
      b.type = "button"; b.addEventListener("click", function () { var A = api(); try { if (A && A.closeSheet) A.closeSheet(); } catch (e) {} setTimeout(fn, 80); }); list.appendChild(b); };
    if (hasH) mk("home", L("Följ mig hem", "Walk me home"), w ? L("På · ", "On · ") + (w.watching | 0) + L(" följer", " watching") : L("Vänner ser dig hela vägen hem", "Friends see you all the way home"), function () { W("HEMFOLJ").open({}); });
    if (hasP) mk("sos", L("Hämta mig", "Pick me up"), L("Kan nån hämta mig?", "Can someone pick me up?"), function () { W("SKJUTS").openPickup({}); });
    f.appendChild(list); return f;
  }
  window.PNIKV = { open: open, close: close, safeRows: safeRows, paint: function () { sig = ""; paint(); }, _menu: function () { return menu; } };
})();
