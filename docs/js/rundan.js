/* Öl Nu — RUNDAN (CONTRACT "RUNDAN"; migrations 0116–0118): 💸 Kvällens nota + Swisha tillbaka, 🎲 Vem bjuder?, 🚕 Taxi hem + Dela taxin.
   window.RUNDAN, through app.js mods(): init, groupItem (ONE tile "rnd-gi" on the group page), settingsSheet (📱 Swish number row).
   social.js calls RUNDAN.chatOpen(g, ctx) (ctx = {list, input, alive}): chat rows whose msg id belongs to an expense get a
   card (who has paid, "📱 Swisha Anton 72 kr", number + amount + 📋 Kopiera fallback, ✅ Betalt / ✅ Fått).
   extras.js showTaxi() calls RUNDAN.taxiSheet(body): 🏠 Taxi hem (home from js/homezone.js, phone only), Uber with
   drop-off = home, local taxi numbers from js/taxi-data.js, 🚕 Dela taxin (= an expense of kind "taxi").
   Patterns copied from the Steven ("Even Steven") app: one running group tab instead of single debts, "Vem betalade?",
   unequal splits, "Gör upp" (settle up), "paid outside the app" that the receiver confirms, Swish to settle.
   Fewest payments ("Gör upp"): greedy biggest debtor → biggest creditor (Splitwise "simplify debts"), done here in the client.
   Swish links are not documented by Swish: https://app.swish.nu/1/p/sw/?sw=…&amt=…&cur=SEK&msg=… (main) and
   swish://payment?data=… (second); the number + amount + 📋 Kopiera are always shown too. No money passes through Öl Nu.
   A missing RPC (old database, PGRST202) = everything hides, no error. In-app only: no push. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = false, cache = {}, view = null;
  var SWISH_KEY = "olnu.rndSwishAsk";
  function sv() { return !I || I.lang !== "en"; }
  function pick(a) { return a && a.length ? a[Math.floor(Math.random() * a.length)] : ""; }
  function fmt(s) { var a = arguments; return String(s).replace(/\{(\d)\}/g, function (m, i) { var v = a[+i + 1]; return v == null ? "" : String(v); }); }

  /* ---------- Texts (sv dalmål + military, "ä"; English fallback) ---------- */
  var S = {
    sv: {
      tile: "💸 Kvällens nota", tileSpin: "🎲", even: "kvitt", plus: "+{0} kr", minus: "−{0} kr",
      notaTitle: "💸 Kvällens nota · {0}", back: "‹ Tillbaka",
      iPaid: "💸 Jag bjöd på en runda", spin: "🎲 Vem bjuder?", other: "➕ Annan utgift",
      balH: "Saldo i gruppen", balNone: "Alla ä kvitt. Rent mjöl i påsen! 🤝", balPlus: "får {0} kr", balMinus: "ska betala {0} kr",
      settleH: "🤝 Gör upp", settleInfo: "{0} betalningar räcker för att alla ska bli kvitt.", settleOne: "En betalning räcker för att alla ska bli kvitt.",
      pendH: "⏳ Väntar på dig", pendLine: "{0} säger att hen betalat {1} kr", got: "✅ Fått", notGot: "❌ Fick inget",
      recentH: "Senaste", recentNone: "Inga utgifter än. Bjud på en runda så börjar notan!", cancel: "Stryk", cancelled: "struken",
      cashGot: "💵 Fick kontant", iSwished: "✅ Jag har betalat", undo: "Ångra",
      swishH: "📱 Mitt Swish-nummer", swishNone: "📱 Mitt Swish-nummer: inte sparat ›", swishRow: "📱 Mitt Swish-nummer: {0} ›",
      swishInfo: "Sparas en gång på servern. Syns bara för folk i dina grupper, så de kan swisha dig tillbaka.",
      swishPh: "07x-xxx xx xx", save: "💾 Spara", clear: "Ta bort numret", swishOk: "📱 Swish-numret ä sparat. Nu kan gänget betala tillbaka.",
      swishGone: "Swish-numret ä borttaget.", swishBad: "Skriv ett svenskt mobilnummer: 07x-xxx xx xx.",
      addTitle: { round: "💸 Jag bjöd på en runda", taxi: "🚕 Dela taxin", other: "🧾 Annan utgift" },
      kRound: "🍺 Runda", kTaxi: "🚕 Taxi", kOther: "🧾 Annat",
      whoPaid: "Vem betalade?", me: "Jag", who: { round: "Vilka drack?", taxi: "Vilka åkte med?", other: "Vilka var med?" },
      outTag: "ute", all: "Alla", none: "Ingen",
      mode: "Hur delar vi?", mPer: "Per person", mTot: "Totalt, dela lika", mUneq: "Olika belopp",
      perL: "Kronor per person", totL: "Totalt (kr)", inclMe: "Betalaren ä med och delar", myPart: "Betalarens egen del (kr)",
      itemsL: "Antal öl (valfritt)", whatL: "Vad? (valfritt)", whatPh: { round: "Rundan", taxi: "Taxin hem", other: "Pizza, inträde …" },
      prev: "{0} · {1}", prevPer: "{0} kr var", prevTot: "{0} kr totalt", prevEach: "{0} swishar {1}",
      send: "📤 Skicka till chatten", needWho: "Välj minst en kompis.", needAmt: "Skriv ett belopp.", tooMuch: "Delarna blir mer än totalen.",
      needSwish: "Spara ditt Swish-nummer först, annars vet int' gänget vart pengarna ska.",
      card: { pay: "📱 Swisha {0} {1} kr", alt: "Öppnas int' Swish? Prova här", copy: "📋 Kopiera", paid: "✅ Betalt",
        noSwish: "{0} har int' sparat Swish-nummer. Fråga efter numret.", waitConf: "⏳ Väntar på att {0} bekräftar.", conf: "✅ {0} har fått pengarna.",
        waitFor: "Väntar på: {0}", allPaid: "✅ Alla har betalat. Snyggt jobbat, soldater!", by: "{0} betalade", you: "du" },
      spinTitle: "🎲 Vem bjuder?", spinWho: "Vilka ä med i snurren?", fair: "⚖️ Rättvis", fairInfo: "De som bjudit minst på sistone får större chans.",
      spinGo: "🎲 SNURRA!", spinNeed: "Minst två måste vara med.", again: "🔁 Snurra igen", toChat: "💬 Till chatten", iPaidNow: "💸 Lägg in rundan",
      odds: "{0} %",
      errs: { not_member: "Du ä int' med i gruppen längre.", slow_down: "Lugna ner dig, korpral! Vänta en liten stund.",
        invalid_split: "Det där gick int' ihop. Kolla beloppen.", invalid_member: "Någon har lämnat gruppen. Ladda om.",
        invalid_amount: "Fel belopp.", expense_not_found: "Den utgiften finns int' längre.", payment_not_found: "Betalningen finns int' längre.",
        not_yours: "Det får bara den det gäller göra.", too_late: "För sent att ändra.", invalid_swish: "Skriv ett svenskt mobilnummer: 07x-xxx xx xx.",
        invalid_spin: "Minst två måste vara med.", fail: "Det gick int'. Försök igen." },
      dist: "Hem: {0} fågelvägen", taxiH: "🏠 Taxi hem", taxiSave: "🏠 Spara hemadress", taxiSaveInfo: "Sparas bara på din telefon. Samma som 🏠 Hemzon i ⚙️.",
      uberHome: "🚗 Uber hem", bolt: "⚡ Bolt", boltInfo: "Bolt: skriv in Hem i appen.", moreTaxi: "Fler taxibolag nära", split: "🚕 Dela taxin",
      pickGroup: "Vilken grupp delar taxin?", taxiNoGroup: "Gå med i en grupp först, så kan ni dela taxin.", changeHome: "Ändra hem",
      uberNote: "Uber finns bara i en del städer. I Dalarna: ring den lokala taxin."
    },
    en: {
      tile: "💸 Tonight's tab", tileSpin: "🎲", even: "even", plus: "+{0} kr", minus: "−{0} kr",
      notaTitle: "💸 Tonight's tab · {0}", back: "‹ Back",
      iPaid: "💸 I bought a round", spin: "🎲 Who's buying?", other: "➕ Other expense",
      balH: "Group balance", balNone: "Everyone is even. 🤝", balPlus: "gets {0} kr", balMinus: "owes {0} kr",
      settleH: "🤝 Settle up", settleInfo: "{0} payments settle everything.", settleOne: "One payment settles everything.",
      pendH: "⏳ Waiting for you", pendLine: "{0} says they paid {1} kr", got: "✅ Got it", notGot: "❌ Didn't get it",
      recentH: "Recent", recentNone: "No expenses yet. Buy a round to start the tab!", cancel: "Remove", cancelled: "removed",
      cashGot: "💵 Got cash", iSwished: "✅ I've paid", undo: "Undo",
      swishH: "📱 My Swish number", swishNone: "📱 My Swish number: not set ›", swishRow: "📱 My Swish number: {0} ›",
      swishInfo: "Saved once on the server. Only people in your groups see it, so they can pay you back.",
      swishPh: "07x-xxx xx xx", save: "💾 Save", clear: "Remove number", swishOk: "📱 Swish number saved.",
      swishGone: "Swish number removed.", swishBad: "Type a Swedish mobile number: 07x-xxx xx xx.",
      addTitle: { round: "💸 I bought a round", taxi: "🚕 Split the taxi", other: "🧾 Other expense" },
      kRound: "🍺 Round", kTaxi: "🚕 Taxi", kOther: "🧾 Other",
      whoPaid: "Who paid?", me: "Me", who: { round: "Who drank?", taxi: "Who rode along?", other: "Who was in?" },
      outTag: "out", all: "All", none: "None",
      mode: "How do we split?", mPer: "Per person", mTot: "Total, split evenly", mUneq: "Different amounts",
      perL: "Kronor per person", totL: "Total (kr)", inclMe: "The payer shares too", myPart: "Payer's own part (kr)",
      itemsL: "Number of beers (optional)", whatL: "What? (optional)", whatPh: { round: "The round", taxi: "Taxi home", other: "Pizza, entry …" },
      prev: "{0} · {1}", prevPer: "{0} kr each", prevTot: "{0} kr total", prevEach: "{0} pay {1}",
      send: "📤 Send to the chat", needWho: "Pick at least one friend.", needAmt: "Type an amount.", tooMuch: "The parts add up to more than the total.",
      needSwish: "Save your Swish number first, so the gang knows where to send it.",
      card: { pay: "📱 Swish {0} {1} kr", alt: "Swish didn't open? Try this", copy: "📋 Copy", paid: "✅ Paid",
        noSwish: "{0} has no Swish number saved. Ask for it.", waitConf: "⏳ Waiting for {0} to confirm.", conf: "✅ {0} got the money.",
        waitFor: "Waiting for: {0}", allPaid: "✅ Everyone has paid.", by: "{0} paid", you: "you" },
      spinTitle: "🎲 Who's buying?", spinWho: "Who is in the spin?", fair: "⚖️ Fair", fairInfo: "People who bought fewer rounds lately get a bigger chance.",
      spinGo: "🎲 SPIN!", spinNeed: "At least two must be in.", again: "🔁 Spin again", toChat: "💬 To the chat", iPaidNow: "💸 Add the round",
      odds: "{0} %",
      errs: { not_member: "You are not in the group any more.", slow_down: "Easy! Wait a moment.", invalid_split: "That doesn't add up. Check the amounts.",
        invalid_member: "Someone left the group. Reload.", invalid_amount: "Wrong amount.", expense_not_found: "That expense is gone.",
        payment_not_found: "That payment is gone.", not_yours: "Only the person it concerns can do that.", too_late: "Too late to change.",
        invalid_swish: "Type a Swedish mobile number: 07x-xxx xx xx.", invalid_spin: "At least two must be in.", fail: "That didn't work. Try again." },
      dist: "Home: {0} as the crow flies", taxiH: "🏠 Taxi home", taxiSave: "🏠 Save home address", taxiSaveInfo: "Kept on this phone only. Same as 🏠 Home zone in ⚙️.",
      uberHome: "🚗 Uber home", bolt: "⚡ Bolt", boltInfo: "Bolt: type Home in the app.", moreTaxi: "More taxi firms nearby", split: "🚕 Split the taxi",
      pickGroup: "Which group splits the taxi?", taxiNoGroup: "Join a group first, then you can split the taxi.", changeHome: "Change home",
      uberNote: "Uber only runs in some cities. In Dalarna: call the local taxi."
    }
  };
  // Dalmål lines. {n} = the winner's name (the server puts it in). Keep the ORDER, add at the end.
  var SPIN_LINES = [
    "{n} bjuder på nästa runda! Ödet har talat, soldat.", "Tärningen ä kastad: {n} langar fram plånboken!",
    "{n}! Högkvarteret har beslutat. Till baren, marsch!", "Det blev {n}. Int' mycke å säga om dä – bjud nu!",
    "{n} drog nitlotten. Eller vinstlotten, beroende på hur man ser det.", "Uppdrag tilldelat: {n} köper rundan. Utför!",
    "{n} bjuder! Hä ä bara å gilla läget.", "Snurran stannade på {n}. Dalahästen ljuger aldrig.",
    "{n} – fram med Swishen! Gänget ä törstigt.", "Order från ovan: {n} står för nästa omgång.",
    "{n} bjuder, och vi andra skålar för {n}! 🍻", "Lotten föll på {n}. Ingen överklagan, ingen nåd.",
    "{n} ä kvällens sponsor. Applåder, tack!", "Det ä {n} som bjuder. Det hörde vi allihopa.",
    "Generalen pekar på {n}. Lyd order!", "{n}! Ölguden har valt dig. Bär det med stolthet.",
    "{n} bjuder. Int' gnälla, bara betala.", "Nästa runda ä på {n}. Hä ä bestämt.",
    "Kanonen ä laddad och siktet på {n}. Pang – du bjuder!", "{n} fick äran. Bartendern väntar redan."
  ];
  var FAIR_LINES = ["⚖️ Rättvis snurr, och lotten föll på {n}. Bjud nu, soldat!",
    "⚖️ Rättvisan har talat: {n} bjuder. Kvittot går till historien.", "⚖️ Vägd och klar: {n} står för nästa runda!",
    "⚖️ Den rättvisa snurren pekar på {n}. Int' gnälla, bara bjuda."];
  var POST_TOASTS = ["💸 Rundan ä registrerad. Nu kan gänget swisha tillbaka!", "💸 Notan ä uppdaterad. Ingen slipper undan, soldat.",
    "💸 Inskrivet i krigsdagboken. Gänget får en Swish-knapp.", "💸 Klart! Pengarna hittar hem till dig.",
    "💸 Snyggt bjudit! Nu får de andra göra rätt för sig.", "💸 Rundan ä loggad. Ölguden ser allt."];
  var PAID_TOASTS = ["✅ Betalt! Hedersknyffel.", "✅ Skulden ä betald. Du ä en sann kamrat.", "✅ Klart! Nu kan du se {0} i ögonen igen.",
    "✅ Pengarna ä på väg. Det ä så man gör i Dalarna.", "✅ Betalt och klart. Inget mer gnäll om dä."];
  var GOT_TOASTS = ["✅ Bekräftat. Kassan stämmer!", "✅ Fått! Notan blir lättare.", "✅ Pengarna ä hemma. Bra jobbat, gänget."];
  var SPIN_TOASTS_EN = ["{n} is buying the next round!", "The wheel has spoken: {n} buys!"];
  function T(k) { var o = S[sv() ? "sv" : "en"]; return o[k] != null ? o[k] : S.sv[k]; }
  function TC(k) { var o = T("card"); return o[k] != null ? o[k] : S.sv.card[k]; }
  function errText(e) {
    var c = U.errCode ? U.errCode(e) : "", m = T("errs");
    return m[c] || S.sv.errs[c] || m.fail;
  }

  /* ---------- Server ---------- */
  function call(name, params) {
    if (!A || !A.LIVE || off) return Promise.resolve({ data: null, error: { message: "off" }, off: true });
    return A.rpc(name, params).then(function (r) {
      if (r.error && U.missing(r.error)) { off = true; r.off = true; }
      return r;
    });
  }
  function load(g, force) {
    var c = cache[g.id];
    if (!force && c && Date.now() - c.at < 4000) return Promise.resolve(c.d);
    return call("rnd_group", { p_group_id: g.id }).then(function (r) {
      if (r.error) return c ? c.d : null;
      var d = A.parseData(r.data);
      cache[g.id] = { at: Date.now(), d: d };
      return d;
    });
  }
  function on() { return !!(A && A.LIVE && !off); }

  /* ---------- Helpers ---------- */
  function el(tag, attrs, kids) { return A.el(tag, attrs, kids); }
  function bt(label, cls, fn) { return A.btn(label, cls, fn); }
  function kr(n) { return String(Math.round(n)); }
  function prettyNum(n) { n = String(n || ""); return /^07\d{8}$/.test(n) ? n.slice(0, 3) + "-" + n.slice(3, 6) + " " + n.slice(6, 8) + " " + n.slice(8) : n; }
  function normSwish(s) {
    var v = String(s || "").replace(/[\s\-().]/g, "");
    if (/^\+46/.test(v)) v = "0" + v.slice(3); else if (/^0046/.test(v)) v = "0" + v.slice(4);
    if (v === "") return "";
    return /^07\d{8}$/.test(v) ? v : null;
  }
  function swishMsg(what) { return ("Öl Nu · " + (what || "Rundan")).slice(0, 50); }
  // Undocumented Swish links (research 2026-10-22, gist from Sep 2026). Decimal point, not comma.
  function swishHttps(num, amt, msg) {
    return "https://app.swish.nu/1/p/sw/?sw=" + encodeURIComponent(num) + "&amt=" + (+amt).toFixed(2) + "&cur=SEK&msg=" + encodeURIComponent(msg);
  }
  function swishApp(num, amt, msg) {
    return "swish://payment?data=" + encodeURIComponent(JSON.stringify({ version: 1, payee: { value: num }, amount: { value: +amt }, message: { value: msg, editable: true } }));
  }
  function copy(s) { try { A.copyText(String(s)); } catch (e) {} }
  function haptic(n) { try { if (window.FX && window.FX.haptic) window.FX.haptic(n || 10); else if (window.FX && window.FX.vibrate) window.FX.vibrate(n || 10); } catch (e) {} }
  function reduced() { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function memberOf(d, k) { var m = null; (d.members || []).forEach(function (x) { if (x.k === k) m = x; }); return m; }
  function meOf(d) { return memberOf(d, d.me) || { k: d.me, name: A.getName(), is_me: true }; }
  // A new sheet starts at the top (the group page may have been scrolled down to reach the tile).
  function top(body) { setTimeout(function () { try { body.scrollTop = 0; if (body.parentNode) body.parentNode.scrollTop = 0; } catch (e) {} }, 0); }
  function nameList(a) {
    if (a.length <= 1) return a.join("");
    return a.slice(0, -1).join(", ") + (sv() ? " och " : " and ") + a[a.length - 1];
  }

  // Fewest payments: biggest debtor pays biggest creditor, repeat (deterministic, same on every phone).
  function settle(members) {
    var cr = [], db = [];
    (members || []).forEach(function (m) {
      var n = m.net | 0;
      if (n > 0) cr.push({ k: m.k, name: m.name, is_me: m.is_me, swish: m.swish, v: n });
      else if (n < 0) db.push({ k: m.k, name: m.name, is_me: m.is_me, v: -n });
    });
    var by = function (a, b) { return b.v - a.v || (a.k < b.k ? -1 : 1); };
    var out = [], guard = 0;
    while (cr.length && db.length && guard++ < 100) {
      cr.sort(by); db.sort(by);
      var c = cr[0], d = db[0], x = Math.min(c.v, d.v);
      out.push({ from: d, to: c, amount: x });
      c.v -= x; d.v -= x;
      if (!c.v) cr.shift();
      if (!d.v) db.shift();
    }
    return out;
  }

  /* ---------- Swish pay block (used by chat cards and Gör upp) ---------- */
  function payBlock(to, amount, what, onPaid) {
    var box = el("div", { class: "rnd-pay" });
    if (to.swish) {
      var msg = swishMsg(what);
      box.appendChild(el("a", { class: "btn btn-green btn-small rnd-swish", href: swishHttps(to.swish, amount, msg), target: "_blank", rel: "noopener noreferrer",
        text: fmt(TC("pay"), to.name, kr(amount)), onclick: function () { haptic(12); } }));
      var fb = el("div", { class: "rnd-fb" }, [
        el("span", { class: "rnd-num", text: prettyNum(to.swish) + " · " + kr(amount) + " kr" }),
        el("button", { type: "button", class: "rnd-link", text: TC("copy"), onclick: function (e) { e.stopPropagation(); copy(to.swish); } }),
        el("a", { class: "rnd-link", href: swishApp(to.swish, amount, msg), text: TC("alt") })
      ]);
      box.appendChild(fb);
    } else {
      box.appendChild(el("p", { class: "rnd-note", text: fmt(TC("noSwish"), to.name) }));
    }
    if (onPaid) box.appendChild(bt(TC("paid"), "btn-small rnd-paid", function (e) { if (e) e.stopPropagation(); onPaid(this); }));
    return box;
  }
  function paidToast(name) { A.toast(fmt(pick(sv() ? PAID_TOASTS : ["✅ Paid!"]), name || "")); try { if (window.FX && window.FX.vibrate) window.FX.vibrate(20); } catch (e) {} }
  function payShare(g, e, btnEl) {
    if (btnEl) btnEl.disabled = true;
    return call("rnd_pay", { p_group_id: g.id, p_to: e.payer, p_amount: myShare(e).amount, p_expense_id: e.id }).then(function (r) {
      if (btnEl) btnEl.disabled = false;
      if (r.error) { A.toast(errText(r.error), { err: true }); return false; }
      paidToast(e.payer_name); return true;
    });
  }
  function myShare(e) { var s = null; (e.shares || []).forEach(function (x) { if (x.is_me) s = x; }); return s; }
  function payment(action, id, then) {
    return call("rnd_payment", { p_payment_id: id, p_action: action }).then(function (r) {
      if (r.error) { A.toast(errText(r.error), { err: true }); return; }
      if (action === "confirm") A.toast(pick(sv() ? GOT_TOASTS : ["✅ Confirmed."]));
      if (then) then();
    });
  }

  /* ---------- Chat cards ---------- */
  function cardFor(g, d, e, rerender) {
    var box = el("div", { class: "rnd-card" + (e.cancelled ? " off" : "") });
    if (e.cancelled) { box.appendChild(el("p", { class: "rnd-note", text: "🚫 " + T("cancelled") })); return box; }
    var chips = el("div", { class: "rnd-chips" });
    (e.shares || []).forEach(function (s) {
      chips.appendChild(el("span", { class: "rnd-chip" + (s.paid ? " ok" : ""), text: (s.is_me ? TC("you") : s.name) + " " + s.amount + " kr" + (s.paid ? (s.confirmed ? " ✅" : " ⏳") : "") }));
    });
    box.appendChild(chips);
    var mine = myShare(e);
    if (mine && !mine.paid) {
      box.appendChild(payBlock({ name: e.payer_name, swish: e.payer_swish }, mine.amount, e.what, function (b) {
        payShare(g, e, b).then(function (ok) { if (ok) rerender(true); });
      }));
    } else if (mine && mine.paid) {
      box.appendChild(el("p", { class: "rnd-note", text: mine.confirmed ? fmt(TC("conf"), e.payer_name) : fmt(TC("waitConf"), e.payer_name) }));
    }
    if (e.payer_me) {
      var wait = (e.shares || []).filter(function (s) { return !s.paid; }).map(function (s) { return s.name; });
      var pend = (e.shares || []).filter(function (s) { return s.paid && !s.confirmed && s.pay_id; });
      if (!wait.length && !pend.length) box.appendChild(el("p", { class: "rnd-note ok", text: TC("allPaid") }));
      else if (wait.length) box.appendChild(el("p", { class: "rnd-note", text: fmt(TC("waitFor"), nameList(wait)) }));
      pend.forEach(function (s) {
        box.appendChild(el("div", { class: "rnd-conf" }, [el("span", { text: fmt(T("pendLine"), s.name, s.amount) }),
          bt(T("got"), "btn-small btn-green", function () { payment("confirm", s.pay_id, function () { rerender(true); }); }),
          bt(T("notGot"), "btn-small", function () { payment("reject", s.pay_id, function () { rerender(true); }); })]));
      });
    }
    return box;
  }
  function chatOpen(g, ctx) {
    if (!on() || !g || !g.id || g.ev || !ctx || !ctx.list) return;
    var list = ctx.list, sig = {}, timer = null, busy = false;
    function candidates() { return list.querySelectorAll("li.chat-msg[data-mid]"); }
    function hasCand() {
      var c = candidates();
      for (var i = 0; i < c.length; i++) { var b = c[i].querySelector(".cm-body"); if (b && /^(💸|🚕|🧾) /.test(b.textContent || "")) return true; }
      return false;
    }
    function paint(d) {
      if (!d) return;
      var byMsg = {};
      (d.expenses || []).forEach(function (e) { if (e.msg_id) byMsg[String(e.msg_id)] = e; });
      var c = candidates();
      for (var i = 0; i < c.length; i++) {
        var li = c[i], e = byMsg[li.getAttribute("data-mid")];
        if (!e) continue;
        var s = JSON.stringify(e);
        if (sig[e.id] === s && li.querySelector(".rnd-card")) continue;
        sig[e.id] = s;
        var old = li.querySelector(".rnd-card"); if (old) old.remove();
        li.classList.add("rnd-msg");
        var body = li.querySelector(".cm-body"), card = cardFor(g, d, e, refresh);
        if (body && body.nextSibling) li.insertBefore(card, body.nextSibling); else li.appendChild(card);
      }
    }
    function refresh(force) {
      if (!ctx.alive || !ctx.alive()) { clearInterval(timer); return; }
      if (busy || document.visibilityState === "hidden") return;
      if (!force && !hasCand()) return;
      busy = true;
      load(g, !!force).then(function (d) { busy = false; if (ctx.alive()) paint(d); }, function () { busy = false; });
    }
    // The first messages arrive a moment after open; the list changes → paint from the cache, fetch when needed.
    var mo = null;
    try {
      mo = new MutationObserver(function () {
        if (!ctx.alive()) { mo.disconnect(); return; }
        var c = cache[g.id]; if (c) paint(c.d);
        if (hasCand() && (!c || Date.now() - c.at > 6000)) refresh(false);
      });
      mo.observe(list, { childList: true });
    } catch (e) {}
    setTimeout(function () { refresh(false); }, 900);
    timer = setInterval(function () {
      var quiet = Date.now() - (window.OLNU_CHAT_AT || 0) > 60000;
      if (!quiet || Math.random() < 0.34) refresh(true);
    }, 8000);
  }

  /* ---------- Group page tile ---------- */
  function groupItem(g, wrap) {
    if (!on() || !g || !g.id || g.ev) return;
    var st = el("span", { class: "rnd-gs" });
    var b = el("button", { type: "button", class: "btn btn-small btn-block rnd-gbtn" }, [el("span", { class: "rnd-gl", text: T("tile") }), st]);
    b.addEventListener("click", function () { openNota(g); });
    var tile = el("div", { class: "rnd-gi" }, [b]);
    wrap.appendChild(tile);
    load(g, false).then(function (d) {
      if (!d) { if (off) tile.remove(); return; }
      var me = meOf(d), n = me.net | 0, pend = (d.payments || []).filter(function (p) { return p.can_confirm; }).length;
      st.textContent = (n > 0 ? fmt(T("plus"), n) : n < 0 ? fmt(T("minus"), -n) : T("even")) + (pend ? " · ⏳ " + pend : "");
      if (n < 0 || pend) b.classList.add("rnd-due");
    });
  }

  /* ---------- 💸 Kvällens nota sheet ---------- */
  function openNota(g) {
    A.openSheet(fmt(T("notaTitle"), g.name || ""), function (body) {
      var root = el("div", { class: "rnd" });
      top(body);
      body.appendChild(el("div", { class: "row", style: "margin-bottom:8px" }, [bt(T("back"), "btn-small", function () { A.showGroups(); })]));
      body.appendChild(root);
      root.appendChild(el("p", { class: "muted", text: "…" }));
      var timer = null, last = "";
      view = { g: g, root: root };
      function alive() { return document.body.contains(root); }
      function draw(d) {
        var s = JSON.stringify(d); if (s === last) return; last = s;
        root.innerHTML = "";
        if (!d) { root.appendChild(el("p", { class: "muted", text: T("errs").fail })); return; }
        // Actions
        root.appendChild(el("div", { class: "rnd-acts" }, [bt(T("iPaid"), "btn-amber btn-block", function () { openAdd(g, "round"); })]));
        root.appendChild(el("div", { class: "rnd-acts two" }, [bt(T("spin"), "btn-small", function () { openSpin(g); }),
          bt(T("other"), "btn-small", function () { openAdd(g, "other"); })]));
        // Waiting for me (payments to confirm)
        var pend = (d.payments || []).filter(function (p) { return p.can_confirm; });
        if (pend.length) {
          root.appendChild(el("h4", { class: "rnd-h", text: T("pendH") }));
          pend.forEach(function (p) {
            root.appendChild(el("div", { class: "rnd-conf" }, [el("span", { text: fmt(T("pendLine"), p.from_name, p.amount) }),
              bt(T("got"), "btn-small btn-green", function () { payment("confirm", p.id, refresh); }),
              bt(T("notGot"), "btn-small", function () { payment("reject", p.id, refresh); })]));
          });
        }
        // Balance
        root.appendChild(el("h4", { class: "rnd-h", text: T("balH") }));
        var nz = (d.members || []).filter(function (m) { return (m.net | 0) !== 0; });
        if (!nz.length) root.appendChild(el("p", { class: "rnd-note ok", text: T("balNone") }));
        else {
          var ul = el("ul", { class: "rnd-bal" });
          nz.sort(function (a, b) { return b.net - a.net; }).forEach(function (m) {
            ul.appendChild(el("li", { class: m.net > 0 ? "plus" : "minus" }, [el("span", { class: "rnd-bn", text: m.is_me ? T("me") : m.name }),
              el("span", { class: "rnd-bv", text: m.net > 0 ? fmt(T("balPlus"), m.net) : fmt(T("balMinus"), -m.net) })]));
          });
          root.appendChild(ul);
          // Settle up
          var tr = settle(d.members);
          root.appendChild(el("h4", { class: "rnd-h", text: T("settleH") }));
          root.appendChild(el("p", { class: "rnd-note", text: tr.length === 1 ? T("settleOne") : fmt(T("settleInfo"), tr.length) }));
          tr.forEach(function (x) {
            var li = el("div", { class: "rnd-tr" + (x.from.is_me || x.to.is_me ? " mine" : "") }, [
              el("div", { class: "rnd-trl", text: (x.from.is_me ? T("me") : x.from.name) + " → " + (x.to.is_me ? T("me") : x.to.name) + " · " + x.amount + " kr" })]);
            if (x.from.is_me) {
              li.appendChild(payBlock(x.to, x.amount, sv() ? "Gör upp" : "Settle up", function (b) {
                b.disabled = true;
                call("rnd_pay", { p_group_id: g.id, p_to: x.to.k, p_amount: x.amount }).then(function (r) {
                  b.disabled = false;
                  if (r.error) { A.toast(errText(r.error), { err: true }); return; }
                  paidToast(x.to.name); refresh();
                });
              }));
            } else if (x.to.is_me) {
              li.appendChild(el("div", { class: "rnd-row" }, [bt(T("cashGot"), "btn-small", function () {
                call("rnd_pay", { p_group_id: g.id, p_to: d.me, p_from: x.from.k, p_amount: x.amount }).then(function (r) {
                  if (r.error) { A.toast(errText(r.error), { err: true }); return; }
                  A.toast(pick(sv() ? GOT_TOASTS : ["✅ Confirmed."])); refresh();
                });
              })]));
            }
            root.appendChild(li);
          });
        }
        // My payments that can still be taken back
        (d.payments || []).filter(function (p) { return p.can_undo && p.from_me; }).slice(0, 3).forEach(function (p) {
          root.appendChild(el("div", { class: "rnd-conf quiet" }, [el("span", { text: "✅ " + p.amount + " kr → " + p.to_name + (p.confirmed ? "" : " ⏳") }),
            bt(T("undo"), "btn-small btn-ghost", function () { payment("undo", p.id, refresh); })]));
        });
        // Recent expenses
        root.appendChild(el("h4", { class: "rnd-h", text: T("recentH") }));
        var ex = (d.expenses || []).slice(0, 10);
        if (!ex.length) root.appendChild(el("p", { class: "rnd-note", text: T("recentNone") }));
        ex.forEach(function (e) {
          var ico = e.kind === "taxi" ? "🚕" : e.kind === "round" ? "💸" : "🧾";
          var paid = (e.shares || []).filter(function (s) { return s.paid; }).length;
          var row = el("div", { class: "rnd-ex" + (e.cancelled ? " off" : "") }, [
            el("span", { class: "rnd-ext", text: ico + " " + (e.payer_me ? T("me") : e.payer_name) + " · " + (e.items ? e.items + (sv() ? " öl" : " beers") : e.what) +
              " · " + e.total + " kr" + (e.cancelled ? " · " + T("cancelled") : " · " + paid + "/" + (e.shares || []).length + " ✅") })]);
          if (e.can_cancel) row.appendChild(el("button", { type: "button", class: "rnd-link", text: T("cancel"), onclick: function () {
            call("rnd_cancel", { p_expense_id: e.id }).then(function (r) { if (r.error) A.toast(errText(r.error), { err: true }); refresh(); });
          } }));
          root.appendChild(row);
        });
        // My Swish number
        root.appendChild(swishRow(d.my_swish, function () { openNota(g); }));
      }
      function refresh() { load(g, true).then(function (d) { if (alive()) draw(d); }); }
      var c = cache[g.id]; if (c) draw(c.d);
      refresh();
      timer = setInterval(function () {
        if (!alive()) { clearInterval(timer); return; }
        if (document.visibilityState === "hidden" || (document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName))) return;
        refresh();
      }, 10000);
    });
  }

  /* ---------- 📱 Swish number ---------- */
  function swishRow(num, back) {
    return el("div", { class: "row rnd-swrow", style: "margin-top:12px" }, [bt(num ? fmt(T("swishRow"), prettyNum(num)) : T("swishNone"), "btn-small btn-block", function () { openSwish(num, back); })]);
  }
  function swishInput(num) {
    return el("input", { class: "inp rnd-swinp", type: "tel", inputmode: "tel", maxlength: "16", autocomplete: "tel", placeholder: T("swishPh"), value: num ? prettyNum(num) : "", "aria-label": T("swishH") });
  }
  function saveSwish(v) {
    var n = normSwish(v);
    if (n === null) { A.toast(T("swishBad"), { err: true }); return Promise.resolve(false); }
    return call("rnd_set_swish", { p_number: n }).then(function (r) {
      if (r.error) { A.toast(errText(r.error), { err: true }); return false; }
      Object.keys(cache).forEach(function (k) { cache[k].at = 0; });
      A.toast(n ? T("swishOk") : T("swishGone"));
      return true;
    });
  }
  function openSwish(num, back) {
    A.openSheet(T("swishH"), function (body) {
      body.appendChild(el("p", { class: "muted", style: "margin-top:0", text: T("swishInfo") }));
      var inp = swishInput(num);
      body.appendChild(inp);
      body.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [bt(T("save"), "btn-amber btn-block", function () {
        saveSwish(inp.value).then(function (ok) { if (ok) { if (back) back(); else A.closeSheet(); } });
      })]));
      if (num) body.appendChild(el("div", { class: "row", style: "margin-top:6px" }, [bt(T("clear"), "btn-small btn-ghost", function () {
        saveSwish("").then(function (ok) { if (ok) { if (back) back(); else A.closeSheet(); } });
      })]));
      setTimeout(function () { try { inp.focus(); } catch (e) {} }, 80);
    });
  }

  /* ---------- ➕ Add an expense (round / taxi / other) ---------- */
  function openAdd(g, kind, opt) {
    opt = opt || {};
    load(g, true).then(function (d) {
      if (!d) { A.toast(T("errs").fail, { err: true }); return; }
      var st = { kind: kind || "round", payer: d.me, mode: kind === "taxi" ? "tot" : "per", incl: true, sel: {}, uneq: {}, items: 0 };
      (d.members || []).forEach(function (m) { if (m.out && !m.is_me && st.kind !== "taxi") st.sel[m.k] = true; });
      (opt.sel || []).forEach(function (k) { st.sel[k] = true; });
      A.openSheet(T("addTitle")[st.kind] || T("addTitle").round, function (body) {
        var root = el("div", { class: "rnd rnd-add" });
        top(body);
        body.appendChild(el("div", { class: "row", style: "margin-bottom:8px" }, [bt(T("back"), "btn-small", function () { if (opt.back) opt.back(); else openNota(g); })]));
        body.appendChild(root);
        // Kind
        var kinds = el("div", { class: "rnd-seg", role: "radiogroup" });
        [["round", T("kRound")], ["taxi", T("kTaxi")], ["other", T("kOther")]].forEach(function (x) {
          var b = el("button", { type: "button", class: "rnd-segb", role: "radio", "aria-checked": String(st.kind === x[0]), text: x[1] });
          b.addEventListener("click", function () { st.kind = x[0]; if (x[0] === "taxi") st.mode = "tot"; paintAll(); });
          kinds.appendChild(b);
        });
        root.appendChild(kinds);
        // Who paid
        root.appendChild(el("label", { class: "rnd-l", for: "rnd-payer", text: T("whoPaid") }));
        var sel = el("select", { class: "inp rnd-sel", id: "rnd-payer" });
        var me = meOf(d);
        sel.appendChild(el("option", { value: me.k, text: T("me") + " (" + (me.name || A.getName()) + ")" }));
        (d.members || []).forEach(function (m) { if (!m.is_me) sel.appendChild(el("option", { value: m.k, text: m.name })); });
        sel.addEventListener("change", function () { st.payer = sel.value; delete st.sel[st.payer]; if (st.payer !== d.me && st.kind !== "taxi") st.sel[d.me] = true; paintAll(); });
        root.appendChild(sel);
        // Who was in
        var whoL = el("div", { class: "rnd-l rnd-whoh" });
        var who = el("div", { class: "rnd-who" });
        root.appendChild(whoL); root.appendChild(who);
        // Split mode
        root.appendChild(el("div", { class: "rnd-l", text: T("mode") }));
        var modes = el("div", { class: "rnd-seg", role: "radiogroup" });
        [["per", T("mPer")], ["tot", T("mTot")], ["uneq", T("mUneq")]].forEach(function (x) {
          var b = el("button", { type: "button", class: "rnd-segb", role: "radio", "data-m": x[0], text: x[1] });
          b.addEventListener("click", function () { st.mode = x[0]; paintAll(); });
          modes.appendChild(b);
        });
        root.appendChild(modes);
        var amtBox = el("div", { class: "rnd-amt" });
        root.appendChild(amtBox);
        var amt = el("input", { class: "inp rnd-num-inp", type: "number", inputmode: "numeric", min: "1", max: "50000", step: "1", id: "rnd-amt", value: opt.amount ? String(opt.amount) : "" });
        var amtL = el("label", { class: "rnd-l", for: "rnd-amt" });
        var incl = el("input", { type: "checkbox", id: "rnd-incl" }); incl.checked = true;
        var inclL = el("label", { class: "rnd-check" }, [incl, el("span", { text: T("inclMe") })]);
        var myPart = el("input", { class: "inp rnd-num-inp", type: "number", inputmode: "numeric", min: "0", max: "50000", step: "1", id: "rnd-mine", value: "0" });
        var myPartL = el("label", { class: "rnd-l", for: "rnd-mine", text: T("myPart") });
        var uneqBox = el("div", { class: "rnd-uneq" });
        amt.addEventListener("input", paintPrev); incl.addEventListener("change", paintPrev); myPart.addEventListener("input", paintPrev);
        // Items + what
        var itemsWrap = el("div", { class: "rnd-items" });
        var items = el("input", { class: "inp rnd-num-inp", type: "number", inputmode: "numeric", min: "0", max: "99", step: "1", id: "rnd-items", value: "" });
        itemsWrap.appendChild(el("label", { class: "rnd-l", for: "rnd-items", text: T("itemsL") })); itemsWrap.appendChild(items);
        items.addEventListener("input", paintPrev);
        root.appendChild(itemsWrap);
        var whatL = el("label", { class: "rnd-l", for: "rnd-what", text: T("whatL") });
        var what = el("input", { class: "inp", id: "rnd-what", maxlength: "40", value: opt.what || "" });
        what.addEventListener("input", paintPrev);
        root.appendChild(whatL); root.appendChild(what);
        // My Swish number (first use)
        var swBox = el("div", { class: "rnd-swfirst" });
        var swInp = swishInput(d.my_swish);
        swBox.appendChild(el("label", { class: "rnd-l", text: T("swishH") })); swBox.appendChild(swInp);
        swBox.appendChild(el("p", { class: "rnd-note", text: T("swishInfo") }));
        root.appendChild(swBox);
        var prev = el("div", { class: "rnd-prev", "aria-live": "polite" });
        root.appendChild(prev);
        var send = bt(T("send"), "btn-amber btn-block rnd-send", go);
        root.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [send]));

        function people() { return (d.members || []).filter(function (m) { return st.sel[m.k] && m.k !== st.payer; }); }
        function paintWho() {
          whoL.innerHTML = "";
          whoL.appendChild(el("span", { text: T("who")[st.kind] || T("who").round }));
          var allB = el("button", { type: "button", class: "rnd-link", text: T("all") });
          allB.addEventListener("click", function () { (d.members || []).forEach(function (m) { if (m.k !== st.payer) st.sel[m.k] = true; }); paintAll(); });
          var noneB = el("button", { type: "button", class: "rnd-link", text: T("none") });
          noneB.addEventListener("click", function () { st.sel = {}; paintAll(); });
          whoL.appendChild(allB); whoL.appendChild(noneB);
          who.innerHTML = "";
          (d.members || []).forEach(function (m) {
            if (m.k === st.payer) return;
            var b = el("button", { type: "button", class: "rnd-pp" + (st.sel[m.k] ? " on" : ""), "aria-pressed": String(!!st.sel[m.k]) }, [
              el("span", { text: (st.sel[m.k] ? "✓ " : "") + (m.is_me ? T("me") : m.name) }),
              m.out ? el("small", { class: "rnd-out", text: "● " + T("outTag") }) : null]);
            b.addEventListener("click", function () { if (st.sel[m.k]) delete st.sel[m.k]; else st.sel[m.k] = true; paintAll(); });
            who.appendChild(b);
          });
        }
        function paintAmt() {
          amtBox.innerHTML = ""; uneqBox.innerHTML = "";
          if (st.mode === "uneq") {
            people().forEach(function (m) {
              var i = el("input", { class: "inp rnd-num-inp", type: "number", inputmode: "numeric", min: "1", max: "50000", step: "1", value: st.uneq[m.k] ? String(st.uneq[m.k]) : "", "aria-label": m.name });
              i.addEventListener("input", function () { st.uneq[m.k] = Math.max(0, Math.round(+i.value || 0)); paintPrev(); });
              uneqBox.appendChild(el("label", { class: "rnd-urow" }, [el("span", { text: m.is_me ? T("me") : m.name }), i, el("span", { class: "muted", text: "kr" })]));
            });
            amtBox.appendChild(uneqBox);
            amtBox.appendChild(myPartL); amtBox.appendChild(myPart);
          } else {
            amtL.textContent = st.mode === "per" ? T("perL") : T("totL");
            amtBox.appendChild(amtL); amtBox.appendChild(amt);
            if (st.mode === "tot") amtBox.appendChild(inclL);
          }
        }
        // shares [{k, amount}] + total, or an error key
        function calc() {
          var ps = people(), n = ps.length, a = Math.round(+amt.value || 0);
          if (!n) return { err: "needWho" };
          if (st.mode === "per") {
            if (a < 1) return { err: "needAmt" };
            return { total: a * (n + 1), shares: ps.map(function (m) { return { k: m.k, amount: a, name: m.name }; }), per: a };
          }
          if (st.mode === "tot") {
            if (a < 1) return { err: "needAmt" };
            var parts = n + (incl.checked ? 1 : 0), base = Math.floor(a / parts), rest = a - base * parts;
            if (base < 1) return { err: "needAmt" };
            // incl: the payer keeps the öre-rest; else the first ones pay 1 kr more each
            var sh = ps.map(function (m, i) { return { k: m.k, name: m.name, amount: base + (!incl.checked && i < rest ? 1 : 0) }; });
            return { total: a, shares: sh, per: (!incl.checked && rest) ? null : base };
          }
          var sum = 0, bad = false;
          var sh2 = ps.map(function (m) { var v = st.uneq[m.k] | 0; if (v < 1) bad = true; sum += v; return { k: m.k, name: m.name, amount: v }; });
          if (bad) return { err: "needAmt" };
          var mineP = Math.max(0, Math.round(+myPart.value || 0)), same = sh2.every(function (s) { return s.amount === sh2[0].amount; });
          return { total: sum + mineP, shares: sh2, per: same ? sh2[0].amount : null };
        }
        function payerName() { var m = memberOf(d, st.payer); return m ? (m.is_me ? (m.name || A.getName()) : m.name) : A.getName(); }
        function paintPrev() {
          var c = calc(); prev.innerHTML = "";
          if (c.err) { prev.appendChild(el("p", { class: "rnd-note", text: T(c.err) })); send.disabled = true; return; }
          if (c.total > 50000) { prev.appendChild(el("p", { class: "rnd-note", text: T("tooMuch") })); send.disabled = true; return; }
          send.disabled = false;
          var it = Math.round(+items.value || 0), head;
          if (st.kind === "round") head = "💸 " + fmt(sv() ? "{0} bjöd på {1}" : "{0} bought {1}", payerName(), it > 0 ? it + (sv() ? " öl" : " beers") : (what.value.trim() || (sv() ? "en runda" : "a round")).toLowerCase());
          else if (st.kind === "taxi") head = "🚕 " + fmt(sv() ? "{0} tog taxin" : "{0} paid the taxi", payerName());
          else head = "🧾 " + fmt(sv() ? "{0} betalade {1}" : "{0} paid {1}", payerName(), what.value.trim() || (sv() ? "notan" : "the bill"));
          prev.appendChild(el("p", { class: "rnd-prevh", text: fmt(T("prev"), head, c.per != null ? fmt(T("prevPer"), c.per) : fmt(T("prevTot"), c.total)) }));
          prev.appendChild(el("p", { class: "rnd-note", text: c.shares.map(function (s) { return (s.k === d.me ? T("me") : s.name) + " " + s.amount + " kr"; }).join(" · ") }));
        }
        function paintAll() {
          kinds.querySelectorAll(".rnd-segb").forEach(function (b, i) { b.setAttribute("aria-checked", String(["round", "taxi", "other"][i] === st.kind)); });
          modes.querySelectorAll(".rnd-segb").forEach(function (b) { b.setAttribute("aria-checked", String(b.getAttribute("data-m") === st.mode)); });
          itemsWrap.hidden = st.kind !== "round";
          what.placeholder = T("whatPh")[st.kind] || "";
          swBox.hidden = !(st.payer === d.me && !d.my_swish && !(meOf(d).swish));
          try { document.getElementById("sheet-title").textContent = T("addTitle")[st.kind]; } catch (e) {}
          paintWho(); paintAmt(); paintPrev();
        }
        function go() {
          var c = calc();
          if (c.err) { A.toast(T(c.err), { err: true }); return; }
          var pre = Promise.resolve(true);
          if (!swBox.hidden) {
            if (!normSwish(swInp.value)) { A.toast(normSwish(swInp.value) === "" ? T("needSwish") : T("swishBad"), { err: true }); return; }
            pre = saveSwish(swInp.value);
          }
          send.disabled = true;
          pre.then(function (ok) {
            if (!ok) { send.disabled = false; return; }
            return call("rnd_add", { p_group_id: g.id, p_kind: st.kind, p_payer: st.payer === d.me ? null : st.payer, p_total: c.total,
              p_shares: c.shares.map(function (s) { return { k: s.k, amount: s.amount }; }), p_items: st.kind === "round" ? Math.round(+items.value || 0) : 0,
              p_what: what.value.trim() || null }).then(function (r) {
              send.disabled = false;
              if (r.error) { A.toast(errText(r.error), { err: true }); return; }
              haptic(20);
              A.toast(pick(sv() ? POST_TOASTS : ["💸 Saved. The gang can pay you back now."]), { ms: 4000 });
              if (cache[g.id]) cache[g.id].at = 0;
              try { A.invoke("notify-group", { event: "msg", group_id: g.id }); } catch (e) {}
              if (window.SOCIAL && window.SOCIAL.openChat) window.SOCIAL.openChat(g); else openNota(g);
            });
          });
        }
        paintAll();
      });
    });
  }

  /* ---------- 🎲 Vem bjuder? ---------- */
  function openSpin(g) {
    load(g, true).then(function (d) {
      if (!d) { A.toast(T("errs").fail, { err: true }); return; }
      var ms = d.members || [], sel = {}, outN = ms.filter(function (m) { return m.out; }).length;
      ms.forEach(function (m) { if (outN >= 2 ? m.out : true) sel[m.k] = true; });
      var fair = false;
      try { fair = U.ls.get("olnu.rndFair", "0") === "1"; } catch (e) {}
      A.openSheet(T("spinTitle"), function (body) {
        var root = el("div", { class: "rnd rnd-spin" });
        top(body);
        body.appendChild(el("div", { class: "row", style: "margin-bottom:8px" }, [bt(T("back"), "btn-small", function () { openNota(g); })]));
        body.appendChild(root);
        var stage = el("div", { class: "rnd-stage", "aria-live": "polite" });
        var reel = el("div", { class: "rnd-reel" });
        stage.appendChild(el("div", { class: "rnd-win" }, [reel]));
        root.appendChild(stage);
        var result = el("div", { class: "rnd-result" });
        root.appendChild(result);
        root.appendChild(el("div", { class: "rnd-l", text: T("spinWho") }));
        var who = el("div", { class: "rnd-who" });
        root.appendChild(who);
        var fcb = el("input", { type: "checkbox", id: "rnd-fair" }); fcb.checked = fair;
        root.appendChild(el("label", { class: "rnd-check" }, [fcb, el("span", { text: T("fair") })]));
        var fairNote = el("p", { class: "rnd-note", text: T("fairInfo") });
        root.appendChild(fairNote);
        fcb.addEventListener("change", function () { fair = fcb.checked; try { U.ls.set("olnu.rndFair", fair ? "1" : "0"); } catch (e) {} paint(); });
        var go = bt(T("spinGo"), "btn-amber btn-block rnd-go", spin);
        root.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [go]));
        function chosen() { return ms.filter(function (m) { return sel[m.k]; }); }
        function odds() {
          var c = chosen(), w = c.map(function (m) { return fair ? 1 / (1 + (m.paid_n | 0)) : 1; }), s = w.reduce(function (a, b) { return a + b; }, 0) || 1, o = {};
          c.forEach(function (m, i) { o[m.k] = Math.round(100 * w[i] / s); });
          return o;
        }
        function paint() {
          var o = odds();
          who.innerHTML = "";
          ms.forEach(function (m) {
            var b = el("button", { type: "button", class: "rnd-pp" + (sel[m.k] ? " on" : ""), "aria-pressed": String(!!sel[m.k]) }, [
              el("span", { text: (sel[m.k] ? "✓ " : "") + (m.is_me ? T("me") : m.name) }),
              sel[m.k] && fair ? el("small", { class: "rnd-odds", text: fmt(T("odds"), o[m.k]) }) : m.out ? el("small", { class: "rnd-out", text: "● " + T("outTag") }) : null]);
            b.addEventListener("click", function () { if (sel[m.k]) delete sel[m.k]; else sel[m.k] = true; paint(); });
            who.appendChild(b);
          });
          fairNote.hidden = !fair;
          var c = chosen();
          go.disabled = c.length < 2;
          if (!reel.__spun) { reel.innerHTML = ""; reel.appendChild(el("div", { class: "rnd-cell", text: c.length < 2 ? T("spinNeed") : "🎲 " + c.map(function (m) { return m.name; }).join(" · ") })); }
        }
        function spin() {
          var c = chosen();
          if (c.length < 2) { A.toast(T("spinNeed"), { err: true }); return; }
          go.disabled = true; result.innerHTML = ""; haptic(15);
          var line = pick(fair ? FAIR_LINES : SPIN_LINES);
          call("rnd_spin", { p_group_id: g.id, p_keys: c.map(function (m) { return m.k; }), p_fair: fair, p_line: line }).then(function (r) {
            if (r.error) { go.disabled = false; A.toast(errText(r.error), { err: true }); return; }
            var x = A.parseData(r.data);
            animate(c, x, function () {
              go.disabled = false; go.textContent = T("again");
              var txt = String(x.body || "").replace(/^🎲\s*/, "");
              result.appendChild(el("p", { class: "rnd-line", text: sv() ? txt : fmt(pick(SPIN_TOASTS_EN), x.winner_name) }));
              var acts = el("div", { class: "rnd-acts two" });
              if (x.winner_me) acts.appendChild(bt(T("iPaidNow"), "btn-small btn-green", function () { openAdd(g, "round", { back: function () { openSpin(g); }, sel: c.filter(function (m) { return !m.is_me; }).map(function (m) { return m.k; }) }); }));
              acts.appendChild(bt(T("toChat"), "btn-small", function () { if (window.SOCIAL && window.SOCIAL.openChat) window.SOCIAL.openChat(g); }));
              result.appendChild(acts);
              try { if (window.FX && window.FX.vibrate) window.FX.vibrate([30, 60, 30]); } catch (e) {}
            });
          });
        }
        // Slot reel: names slide by (motion, no flashing) and stop on the winner; then ONE calm pulse (1 Hz, 2 times).
        function animate(c, x, done) {
          reel.__spun = true;
          var names = c.map(function (m) { return m.name; }), win = x.winner_name;
          reel.innerHTML = "";
          var seq = [], laps = reduced() ? 0 : 5;
          for (var l = 0; l < laps; l++) names.forEach(function (n) { seq.push(n); });
          seq.push(win);
          seq.forEach(function (n) { reel.appendChild(el("div", { class: "rnd-cell", text: n })); });
          var cellH = 56;
          stage.classList.remove("hit");
          if (reduced()) { reel.style.transform = "translateY(0)"; finish(); return; }
          reel.style.transition = "none"; reel.style.transform = "translateY(0)";
          void reel.offsetHeight;
          reel.style.transition = "transform 3.2s cubic-bezier(.12,.6,.18,1)";
          reel.style.transform = "translateY(" + (-(seq.length - 1) * cellH) + "px)";
          var fired = false;
          reel.addEventListener("transitionend", function te(ev) {
            if (ev.target !== reel || ev.propertyName !== "transform") return;
            reel.removeEventListener("transitionend", te); if (!fired) { fired = true; finish(); }
          });
          setTimeout(function () { if (!fired) { fired = true; finish(); } }, 3600);
          function finish() {
            // keep only the winner cell so the stage is calm
            reel.style.transition = "none"; reel.style.transform = "translateY(0)"; reel.innerHTML = "";
            reel.appendChild(el("div", { class: "rnd-cell win", text: "🍺 " + win }));
            stage.classList.add("hit");
            done();
          }
        }
        paint();
      });
    });
  }

  /* ---------- 🚕 Taxi hem (extras.js showTaxi → taxiSheet) ---------- */
  // Bolt cities in Sweden (bento.travel, 2026-10-22). No public Bolt deep link: the button opens Bolt, you type "Hem".
  var BOLT = [[57.72, 12.94], [59.62, 17.08], [59.37, 16.51], [57.71, 11.97], [56.05, 12.69], [56.03, 14.16], [58.41, 15.62], [55.70, 13.19],
    [55.60, 13.00], [58.59, 16.18], [59.27, 15.21], [59.20, 17.63], [59.33, 18.07], [55.38, 13.16], [59.86, 17.64], [59.61, 16.55]];
  function pos() { var c = null; try { c = (A.lastLoc && A.lastLoc()) || A.center(); } catch (e) {} return c && isFinite(c.lat) && isFinite(c.lng) ? c : null; }
  function home() { try { return window.HOMEZONE && window.HOMEZONE.home ? window.HOMEZONE.home() : null; } catch (e) { return null; } }
  function nearTaxis(c, max) {
    var data = window.TAXI_DATA, seen = {}, out = [];
    if (!data || !data.towns || !c) return out;
    data.towns.map(function (x) { return { x: x, d: U.haversine(c.lat, c.lng, x.lat, x.lng) }; })
      .filter(function (o) { return o.d <= 60000; }).sort(function (a, b) { return a.d - b.d; })
      .forEach(function (o) { if (out.length < max && !seen[o.x.tel]) { seen[o.x.tel] = 1; out.push(o.x); } });
    if (data.fallback && !seen[data.fallback.tel] && out.length < max + 1) out.push(data.fallback);
    return out;
  }
  function uberHome(h) {
    return "https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=" + (+h.lat).toFixed(5) + "&dropoff[longitude]=" + (+h.lng).toFixed(5) +
      "&dropoff[nickname]=" + encodeURIComponent(sv() ? "Hem" : "Home");
  }
  var homeWait = null;
  function saveHome() {
    if (!window.HOMEZONE || !window.HOMEZONE.open) return;
    window.HOMEZONE.open();
    clearInterval(homeWait);
    var until = Date.now() + 180000, was = !!home();
    homeWait = setInterval(function () {
      if (Date.now() > until) { clearInterval(homeWait); return; }
      if (A.sheetOpen && A.sheetOpen()) return;
      clearInterval(homeWait);
      if (home() && !was) { var tb = document.getElementById("btn-taxi"); if (tb) tb.click(); }
    }, 500);
  }
  function taxiSheet(body) {
    if (!A) return;
    var c = pos(), h = home();
    var box = el("section", { class: "rnd rnd-taxi" });
    box.appendChild(el("h3", { text: T("taxiH") }));
    try { var hfN = window.HEMFOLJ && window.HEMFOLJ.taxiNode ? window.HEMFOLJ.taxiNode() : null; if (hfN) box.appendChild(hfN); } catch (e) {}
    if (!h) {
      box.appendChild(bt(T("taxiSave"), "btn-block", saveHome));
      box.appendChild(el("p", { class: "rnd-note", text: T("taxiSaveInfo") }));
    } else {
      if (c) {
        var dm = U.haversine(c.lat, c.lng, h.lat, h.lng);
        box.appendChild(el("p", { class: "rnd-note", text: fmt(T("dist"), dm < 1000 ? Math.round(dm / 10) * 10 + " m" : (dm / 1000).toFixed(1).replace(".", sv() ? "," : ".") + " km") }));
      }
      var row = el("div", { class: "rnd-taxirow" });
      var tx = nearTaxis(c, 3);
      function telA(x, cls) {
        return el("a", { class: "btn taxi-btn rnd-tel" + (cls || ""), href: "tel:" + x.tel }, [el("span", { text: "📞 " + x.name }), el("span", { class: "taxi-num", text: x.text })]);
      }
      if (tx[0]) row.appendChild(telA(tx[0], " btn-amber"));
      row.appendChild(el("a", { class: "btn taxi-btn", href: uberHome(h), target: "_blank", rel: "noopener noreferrer", text: T("uberHome") }));
      if (tx.length > 1) {
        var more = el("details", { class: "rnd-more" }, [el("summary", { text: T("moreTaxi") })]);
        tx.slice(1).forEach(function (x) { more.appendChild(telA(x, "")); });
        row.appendChild(more);
      }
      var nearBolt = c && BOLT.some(function (b) { return U.haversine(c.lat, c.lng, b[0], b[1]) < 40000; });
      if (nearBolt) row.appendChild(el("a", { class: "btn taxi-btn", href: "https://bolt.eu/", target: "_blank", rel: "noopener noreferrer", title: T("boltInfo"), text: T("bolt") }));
      box.appendChild(row);
      if (!nearBolt) box.appendChild(el("p", { class: "rnd-note", text: T("uberNote") }));
      box.appendChild(el("button", { type: "button", class: "rnd-link", text: T("changeHome"), onclick: saveHome }));
    }
    if (on()) box.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [bt(T("split"), "btn-small btn-block", splitTaxi)]));
    body.appendChild(box);
  }
  function splitTaxi() {
    A.rpc("my_groups").then(function (r) {
      var gs = (r && r.data) || [];
      if (r.error || !gs.length) { A.toast(T("taxiNoGroup"), { err: !!r.error }); return; }
      if (gs.length === 1) { openAdd(gs[0], "taxi", { back: function () { var tb = document.getElementById("btn-taxi"); if (tb) tb.click(); } }); return; }
      A.openSheet(T("split"), function (body) {
        body.appendChild(el("p", { class: "rnd-l", text: T("pickGroup") }));
        gs.forEach(function (g) {
          body.appendChild(el("div", { class: "row", style: "margin-top:6px" }, [bt("👥 " + g.name + (g.active_count ? " · ● " + g.active_count : ""), "btn-block", function () {
            openAdd(g, "taxi", { back: splitTaxi });
          })]));
        });
      });
    });
  }

  /* ---------- ⚙️ ---------- */
  function settingsSheet(body) {
    if (!on() || !A.authed || !A.authed()) return;
    var holder = el("div", { class: "rnd-set" });
    body.appendChild(holder);
    // Own number only; no group needed (rnd_me). Hidden until the server answers (old database = no row).
    call("rnd_me").then(function (r) {
      if (r.error || !document.body.contains(holder)) return;
      holder.appendChild(swishRow(A.parseData(r.data).number || null, null));
    });
  }

  window.RUNDAN = {
    init: function (api) { A = api; },
    groupItem: groupItem, chatOpen: chatOpen, taxiSheet: taxiSheet, profileSheet: settingsSheet,   /* 👤 Profil (was settingsSheet) */
    openNota: openNota, openSpin: openSpin, openAdd: openAdd,
    _settle: settle, _swish: { https: swishHttps, app: swishApp, norm: normSwish }
  };
})();
