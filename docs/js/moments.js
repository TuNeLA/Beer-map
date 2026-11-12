/* PintsNow — 🎲 MOMENTS (GM7 + GM4, lane after, owner OK 10 Nov). window.MOMENTS.
   Games come to you at a moment, never from a menu: a one-tap card (HUD chip / push) with the answer buttons on its first
   view. Server: migration 0451 (moments_poll, moment_pick, moment_done, moment_reveal, moment_home_party, moments_report)
   and 0452 (game-start push, Oraklet medal). Everything is behind after_flags.moments (default OFF): with the flag off or
   an old server (missing RPC) this module does nothing at all.
     Kvällens vad   2+ said Ikväll Ja → one bet about the gang (faces or 2–3 options), closes 22:00
     Halvtid        21:00 with 2+ out → one 3-option bet, 60 min
     Uppdrag vid bordet  3+ checked in at the same bar → one group mission, anyone taps Klart
     Hemlig agent   home party (Förfest with 3+, or 3+ close together not at a bar) → mission for the agent, vote at 23:00
   Rules: max 2 moments per person per night (server), ghosts never asked, the predictor wins (Oraklet), never the drinker.
   You see the others' picks after your own pick. Results feed the morning report (after2.js asks reportData()).
   Ways in: the chip in the Ikväll panel (after.js hudChipsHTML / hudClick "mom"), the push /?mom=<id>, groupCard(g) and
   roomCard(g) for the group page (social lane places them), homeParty(g, names) for Förfest. Copy = DIALEKT keys mom.*.
   Hooks ride on window.AFTER (init, onAuthed, onPoll, hudChipsHTML, hudClick). Never breaks the map. */
(function () {
  "use strict";
  var U = window.U;
  var A = null, off = false, on = false, rounds = [], pollAt = 0, busy = false, flagsAt = 0, deep = null, pushEv = false, pend = null;
  var SEEN = "olnu.momSeen", POLL_MS = 60000, FLAGS_MS = 10 * 60000;
  var P = {
    "mom.vad": "Kvällens vad", "mom.halvtid": "Halvtid", "mom.bord": "Uppdrag vid bordet", "mom.agent": "Hemlig agent",
    "mom.chip.vad": "Kvällens vad", "mom.chip.halvtid": "Halvtid", "mom.chip.bord": "Uppdrag", "mom.chip.agent": "Ditt uppdrag", "mom.chip.vote": "Rösta", "mom.chip.reveal": "Avslöja agenten",
    "mom.q.first_home": "Vem går hem först?", "mom.q.last_home": "Vem ä sist kvar på skeppet?", "mom.q.bars": "Hur många krogar blir det för gänget?",
    "mom.q.all_come": "Kommer alla som sa Ja?", "mom.q.skal_n": "Hur många skål får gänget?", "mom.q.first_out": "Vem ä först ute?",
    "mom.q.last_home_t": "När ä sista person hemma?",
    "mom.o.1": "1 krog", "mom.o.2": "2 krogar", "mom.o.3+": "3 eller fler", "mom.o.ja": "Ja", "mom.o.nej": "Nej",
    "mom.o.0_9": "0–9", "mom.o.10_25": "10–25", "mom.o.26": "26 eller fler", "mom.o.f01": "Före 01", "mom.o.01_02": "01–02", "mom.o.e02": "Efter 02",
    "mom.closes": "Stänger {t}", "mom.closed": "Vadet ä stängt", "mom.wait": "Svaret kommer när natten avgör. Morgonrapporten vet.",
    "mom.mine": "Ditt tips: {v}", "mom.picks": "{n} av {m} har tippat", "mom.hidden": "Tippa själv så ser du vad de andra tror.",
    "mom.right": "{names} hade rätt!", "mom.noright": "Ingen hade rätt. Framtiden ä svår.", "mom.answer": "Svar: {v}",
    "mom.none": "Ingen", "mom.you": "Du",
    "mom.toast.vad": ["Kvällens vad: {q}", "Gänget ska ut. Kvällens vad: {q}"],
    "mom.toast.halvtid": "Halvtid! {q}", "mom.toast.bord": "{n} i plutonen på {bar}. Uppdrag!",
    "mom.toast.agent": "Du ä kvällens hemliga agent. Avslöja dig int'!", "mom.toast.vote": "Vem ä agenten? Rösta nu.",
    "mom.toast.reveal": "Du ä värd. Avslöja agenten när du vill.",
    "mom.toast.right": "{names} hade rätt i Kvällens vad!", "mom.answerBtn": "Svara",
    "mom.bord.lead": "{n} i plutonen på {bar}. Ett uppdrag till bordet:", "mom.bord.done": "Klart {t} · {name} tryckte",
    "mom.bord.expired": "Uppdraget gick ut. Nästa gång.", "mom.done": "Klart",
    "mom.ag.you": "Du ä kvällens hemliga agent", "mom.ag.only": "Bara du ser det här. Avslöja dig int'!",
    "mom.ag.doneMe": "Uppdraget ä klart. Håll masken till 23:00.",
    "mom.ag.secret": "En agent finns bland er.", "mom.ag.when": "Avslöjas {t}. Håll ögonen öppna.",
    "mom.ag.reveal": "Avslöja nu", "mom.ag.vote": "Vem ä agenten? En röst var.", "mom.ag.voted": "Röst lagd. {n} av {m} har röstat.",
    "mom.ag.was": "Agenten var {name}!", "mom.ag.mission": "Uppdraget: {m}", "mom.ag.won": "Ingen såg nåt. Agenten vann.",
    "mom.ag.lost": "Avslöjad! {n} av {m} gissade rätt.", "mom.ag.notDone": "Uppdraget blev int' klart. Plutonen vann.",
    "mom.err": "Det gick int' just nu. Försök igen.", "mom.late": "För sent. Vadet ä stängt.",
    "mom.room.party": "Partyspel pågår · {game}", "mom.room.spel": "Spel pågår", "mom.room.sub": "{host} ä värd · {n} med · Hoppa in",
    "mom.rep.vad": "Kvällens vad", "mom.rep.halvtid": "Halvtid", "mom.rep.bord": "Uppdrag vid bordet", "mom.rep.agent": "Hemlig agent",
    "mom.rep.bordDone": "Klart {t} · {name} tryckte", "mom.rep.bordNot": "Uppdraget hann gå ut. Ingen skam."
  };
  var AGENT = ["Få någon att säga \"absolut\" tre gånger.", "Säg \"som min farfar brukade säga…\" och hitta på ett ordspråk. Två gånger.",
    "Nämn en påhittad kompis, \"Gunnar från Grängesberg\", tills någon frågar vem det ä.", "Använd ordet \"logistik\" i tre olika meningar.",
    "Starta en debatt: Kexchoklad eller Japp?", "Få två personer att bråka (snällt) om pizza med ananas.",
    "Säg \"det ä fakta\" efter tre påståenden som int' ä fakta.", "Säg \"som vi sa på lumpen…\" två gånger. Även om du aldrig gjorde lumpen.",
    "Fråga tre personer: \"Vilken superkraft skulle du välja?\"", "Få någon att berätta om sitt första jobb.",
    "Berätta om en dröm du hade i natt. Hitta på den.", "Säg \"på riktigt?\" med stor inlevelse fyra gånger.",
    "Använd tre gammaldags ord: \"minsann\", \"tjusigt\", \"tokstolle\".", "Få någon att berätta ett skämt.",
    "Fråga \"Vad skulle du göra med en miljon?\" och få tre svar.", "Gissa högt vad någon jobbar med om tio år.",
    "Peka på en sak i rummet och hitta på historien bakom den.", "Få någon att säga ditt namn tre gånger.",
    "Få någon att säga \"va?\" tre gånger.", "Hitta på en \"gammal tradition\" i gänget och få någon att tro på den.",
    "Byt plats med någon utan att förklara varför.", "Få alla att titta upp i taket samtidigt.",
    "Få tre personer att ge dig en high five inom tio minuter.", "Få någon att visa ett dansmove.",
    "Starta en tävling: vem står längst på ett ben?", "Lägg en kudde på ett konstigt ställe. Den ska ligga kvar i 15 minuter.",
    "Ge en tumme upp till varje person i rummet.", "Dansa i tio sekunder när nästa låt börjar.",
    "Få någon att byta låt på högtalaren.", "Applådera när någon kommer tillbaka in i rummet. Två gånger.",
    "Få någon att räcka dig något utan att du ber om det rakt ut.", "Lär någon ett handslag du hittar på just nu.",
    "Få två personer att byta plats med varandra.", "Få någon att hämta snacks åt dig.", "Få någon att ta på sig din mössa eller keps.",
    "Ta en gruppbild där alla gör samma min.", "Få alla att räcka upp handen på en fråga du ställer.",
    "Gör en topplista över gängets favoritglass i telefonen.", "Få gänget att bestämma datum för nästa utgång före 23:00.",
    "Få minst tre att sjunga med i samma refräng.", "Starta en runda \"två sanningar och en lögn\".",
    "Få gänget att rösta om kvällens bästa låt.", "Få någon att imitera en känd person.",
    "Få någon att lova att följa med på en promenad imorgon.", "Få alla att säga \"PintsNow\" samtidigt.",
    "Prata med lite djupare röst i tre minuter. Ingen får kommentera.", "Nynna samma låt tre gånger tills någon frågar vilken det ä.",
    "Säg \"intressant\" varje gång någon nämner mat. Fyra gånger.", "Tacka någon väldigt överdrivet för något pyttelitet.",
    "Låtsas få ett viktigt sms och säg \"okej, det ä löst\". Förklara int'.", "Hälsa på någon som om ni int' setts på ett år.",
    "Smyg in ett engelskt ord i varje mening i fem minuter.", "Ge tre personer en komplimang för deras strumpor eller skor.",
    "Ge någon ett snällt råd om något hen int' frågat om.", "Få någon att gissa din favoritfilm. Säg int' att det ä en lek.",
    "Kalla någon \"chefen\" tre gånger tills hen svarar på det.", "Ge någon ett smeknamn och få en annan att använda det.",
    "Nämn din hemort i tre olika samtal.", "Säg \"det här blir en klassiker\" om tre olika saker.",
    "Få någon att fråga dig \"mår du bra?\" (utan att du ser ledsen ut)."];
  var BORD = ["Ta en gruppbild där alla pekar på den som kom sist.", "Hitta på ett namn på gänget för ikväll. Alla måste använda det.",
    "Ta en bild där alla gör sin bästa allvarliga soldatmin.", "Var och en säger en sak den gillar hos personen till höger.",
    "Bestäm gängets låt för kvällen. Alla nynnar refrängen.", "Ta en bild med något rött mitt på bordet.",
    "Hitta på en hemlig hälsning. Alla gör den nästa gång ni ses.", "Var och en berättar sitt pinsammaste ögonblick från skolan eller jobbet.",
    "Rösta fram kvällens bäst klädda. Applåd.", "Bygg det högsta tornet av saker på bordet. Int' glas.",
    "Ta en bild där alla låtsas ha solglasögon.", "Alla säger sitt favoritord just nu. Ett av dem gäller hela kvällen.",
    "Hitta på kvällens motto. Skriv det i gruppchatten.", "Kör en runda två sanningar och en lögn.",
    "Ta en bild där alla gör tummen upp åt kameran samtidigt.", "Bestäm datum för nästa utgång. Skriv in det i chatten.",
    "Var och en härmar en känd person. De andra gissar.", "Ta en selfie med hela gänget. Alla gör segertecken.",
    "Gissa vem i gänget som har flest olästa sms. Kolla.", "Var och en berättar sin bästa kväll någonsin på en mening."];
  AGENT.forEach(function (m, i) { P["mom.ag.m" + (i + 1)] = m; });
  BORD.forEach(function (m, i) { P["mom.bord.m" + (i + 1)] = m; });
  function reg() { try { if (window.DIALEKT && window.DIALEKT.register) { window.DIALEKT.register("sv-neutral", P); return true; } } catch (e) {} return false; }
  if (!reg()) document.addEventListener("DOMContentLoaded", reg);
  function fill(s, v) { return String(s == null ? "" : s).replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] != null ? String(v[k]) : ""; }); }
  function T(k, v) {
    var D = window.DIALEKT;
    if (D && D.t) { var s = D.t(k, v, P[k]); if (s !== k) return s; }
    var x = P[k]; if (Array.isArray(x)) x = x[0];
    return fill(x == null ? k : x, v);
  }
  function esc(s) { return U && U.esc ? U.esc(s) : String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function pni(n, cls) { try { return window.PNI ? window.PNI.svg(n, cls || "") : ""; } catch (e) { return ""; } }
  function missing(e) { try { return U.missing ? U.missing(e) : /PGRST202|42883|does not exist/.test(JSON.stringify(e)); } catch (x) { return false; } }
  function code(e) { try { return U.errCode ? U.errCode(e) : String((e && e.message) || ""); } catch (x) { return ""; } }
  function hm(iso) { var t = Date.parse(iso || ""); if (!isFinite(t)) return ""; try { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t)); } catch (e) { return ""; } }
  function seenGet() { try { return JSON.parse(localStorage.getItem(SEEN) || "{}") || {}; } catch (e) { return {}; } }
  function seenSet(o) { try { localStorage.setItem(SEEN, JSON.stringify(o)); } catch (e) {} }
  function joinNames(n) { return n.length <= 1 ? n.join("") : n.slice(0, -1).join(", ") + " och " + n[n.length - 1]; }
  function faceName(r, k) { return k === r.me ? T("mom.you") : (r.names && r.names[k]) || "?"; }
  function optLabel(r, v) { if (v == null) return T("mom.none"); return /^[0-9a-f]{12}$/.test(v) ? faceName(r, v) : T("mom.o." + v); }
  function isFaces(r) { return (r.opts || []).some(function (o) { return /^[0-9a-f]{12}$/.test(o.v); }); }
  function rightNames(r) {
    return (r.picks || []).filter(function (p) { return p.right; }).map(function (p) { return p.k === r.me ? T("mom.you") : (r.names && r.names[p.k]) || "?"; });
  }
  // the action this round asks of me now ("" = nothing)
  function need(r) {
    if (!r || !r.asked) return "";
    if (r.kind === "vad" || r.kind === "halvtid") return r.phase === "open" && !r.mine ? r.kind : "";
    if (r.kind === "bord") return r.phase === "open" ? "bord" : "";
    if (r.kind === "agent") {
      if (r.agent_me) return r.phase !== "done" && !r.done_at ? "agent" : "";
      if (r.phase === "vote" && !r.mine) return "vote";
      return r.host_me && r.phase === "secret" ? "reveal" : "";   // fixMo N-05: the host (never the agent) can reveal early
    }
    return "";
  }
  // fixMo N-05: rounds that wait for me, the open-ended "reveal" (host, all evening) last
  function needing() { var a = rounds.filter(function (x) { return need(x); }); return a.filter(function (x) { return need(x) !== "reveal"; }).concat(a.filter(function (x) { return need(x) === "reveal"; })); }
  function byId(id) { for (var i = 0; i < rounds.length; i++) if (String(rounds[i].id) === String(id)) return rounds[i]; return null; }

  /* ---------- data ---------- */
  function flagsCheck(force) {
    if (off || !A || !A.rpc) return Promise.resolve(false);
    if (!force && Date.now() - flagsAt < FLAGS_MS) return Promise.resolve(on);
    flagsAt = Date.now();
    return A.rpc("after_flags_get").then(function (r) {
      if (r.error) { if (missing(r.error)) off = true; return false; }
      var d = A.parseData(r.data) || {}, f = d.flags || {};
      on = !!f.moments; pushEv = !!f.push_ev;
      return on;
    }, function () { return false; });
  }
  function poll(force) {
    // I-24: a forced poll (push link /?mom) waits for the poll in flight, so the rounds exist when the card opens.
    if (force && busy && pend && !off && on && A && A.LIVE) return pend;
    if (off || !on || busy || !A || !A.LIVE) return Promise.resolve(null);
    if (!force && Date.now() - pollAt < POLL_MS) return Promise.resolve(null);
    if (document.visibilityState === "hidden") return Promise.resolve(null);
    busy = true; pollAt = Date.now();
    pend = A.rpc("moments_poll").then(function (r) {
      busy = false;
      if (r.error) { if (missing(r.error)) off = true; return null; }
      var d = A.parseData(r.data) || {};
      if (d.on === false) { on = false; rounds = []; A.updateCounts && A.updateCounts(); return d; }
      var old = rounds; rounds = Array.isArray(d.rounds) ? d.rounds : [];
      if ((d.opened | 0) > 0 && (d.push_ev || pushEv) && A.invoke) { try { A.invoke("notify-group", { event: "after_q" }); } catch (e) {} }
      announce(old);
      try { if (A.updateCounts) A.updateCounts(); } catch (e) {}
      repaintCards();
      return d;
    }, function () { busy = false; return null; });
    return pend;
  }
  // one toast per round per need (never over a sheet), one per early answer I bet on
  function announce(old) {
    var seen = seenGet(), dirty = false, sheet = A.sheetOpen && A.sheetOpen();
    rounds.forEach(function (r) {
      var n = need(r), key = r.id + ":" + n;
      if (n && !seen[key] && !sheet) {
        seen[key] = Date.now(); dirty = true;
        var q = r.q ? T("mom.q." + r.q) : "";
        var txt = n === "vad" ? T("mom.toast.vad", { q: q, _seed: r.id }) : n === "halvtid" ? T("mom.toast.halvtid", { q: q })
          : n === "bord" ? T("mom.toast.bord", { n: r.n_who, bar: r.bar_name || "" }) : n === "agent" ? T("mom.toast.agent") : n === "reveal" ? T("mom.toast.reveal") : T("mom.toast.vote");
        A.toast(txt, { ms: 9000, cls: "mo-toast", action: { label: T("mom.answerBtn"), fn: function () { openCard(r.id); } } });
      }
      var prev = null; old.forEach(function (o) { if (o.id === r.id) prev = o; });
      if ((r.kind === "vad" || r.kind === "halvtid") && r.answer && r.mine && !(prev && prev.answer) && !seen[r.id + ":ans"]) {
        seen[r.id + ":ans"] = Date.now(); dirty = true;
        var rn = rightNames(r);
        if (rn.length && !sheet) A.toast(T("mom.toast.right", { names: joinNames(rn) }), { ms: 6000, cls: "mo-toast" });
      }
    });
    var now = Date.now();
    Object.keys(seen).forEach(function (k) { if (now - seen[k] > 2 * 86400000) { delete seen[k]; dirty = true; } });
    if (dirty) seenSet(seen);
  }
  function act(fn, args, el) {
    if (el) el.disabled = true;
    return A.rpc(fn, args).then(function (r) {
      if (el) el.disabled = false;
      if (r.error) {
        var c = code(r.error);
        A.toast(/too_late/.test(c) ? T("mom.late") : T("mom.err"), { err: true });
        poll(true); return null;
      }
      var v = A.parseData(r.data);
      var view = v && v.round ? v.round : v;
      if (view && view.id) {
        var hit = false; rounds = rounds.map(function (x) { if (x.id === view.id) { hit = true; return view; } return x; });
        if (!hit) rounds.push(view);
      }
      try { if (A.updateCounts) A.updateCounts(); } catch (e) {}
      repaintCards();
      return view;
    }, function () { if (el) el.disabled = false; A.toast(T("mom.err"), { err: true }); return null; });
  }

  /* ---------- the card (a sheet) ---------- */
  var openId = null;
  function openCard(id) {
    var r = id != null ? byId(id) : null;
    if (!r) r = needing()[0] || rounds[rounds.length - 1];
    if (!r || !A) return;
    openId = r.id;
    A.openSheet(T("mom." + r.kind), function (body) {
      var box = document.createElement("div");
      box.className = "mo"; box.setAttribute("data-mo", String(r.id));
      body.appendChild(box);
      paint(box, r);
      box.addEventListener("click", onCardClick);
    }, { now: true });
  }
  function repaintCards() {
    Array.prototype.forEach.call(document.querySelectorAll(".mo[data-mo]"), function (box) {
      var r = byId(box.getAttribute("data-mo")); if (r) paint(box, r);
    });
  }
  function onCardClick(e) {
    var b = e.target.closest && e.target.closest("[data-mo-a]"); if (!b || b.disabled) return;
    var box = b.closest(".mo"), id = +box.getAttribute("data-mo"), a = b.getAttribute("data-mo-a"), v = b.getAttribute("data-v");
    if (a === "pick") act("moment_pick", { p_round: id, p_pick: v }, b);
    else if (a === "done") act("moment_done", { p_round: id }, b);
    else if (a === "reveal") act("moment_reveal", { p_round: id }, b);
  }
  function av(r, k) {
    var n = (r.names && r.names[k]) || "?", c = ["--ds-amber", "--ds-green", "--ds-blue", "--ds-red-t", "--ds-amber-t"][parseInt(String(k).slice(0, 6), 16) % 5 | 0];
    return '<span class="mo-av" style="--mo-c:var(' + c + ')" aria-hidden="true">' + esc(String(n).charAt(0).toUpperCase()) + "</span>";
  }
  function paint(box, r) {
    var h = '<div class="mo-kick">' + esc(r.group_name || "") + (r.closes_at && r.phase === "open" && r.kind !== "agent" ? " · " + esc(T("mom.closes", { t: hm(r.closes_at) })) : "") + "</div>";
    if (r.kind === "vad" || r.kind === "halvtid") h += betHTML(r);
    else if (r.kind === "bord") h += bordHTML(r);
    else h += agentHTML(r);
    box.innerHTML = h;
  }
  function optRows(r, opts, mine, pickable) {
    return '<div class="mo-opts' + (isFaces(r) ? "" : " mo-opts-3") + '" role="group">' + opts.map(function (o) {
      var on = mine === o.v, face = /^[0-9a-f]{12}$/.test(o.v);
      var who = (r.picks || []).filter(function (p) { return p.pick === o.v; }).map(function (p) { return faceName(r, p.k); });
      return '<button type="button" class="mo-opt' + (on ? " on" : "") + (r.answer && r.answer.v === o.v ? " right" : "") + '" data-mo-a="pick" data-v="' + esc(o.v) + '"' +
        (pickable ? "" : " disabled") + ' aria-pressed="' + on + '">' + (face ? av(r, o.v) : "") +
        '<span class="mo-ot"><b>' + esc(optLabel(r, o.v)) + "</b>" + (who.length ? "<small>" + esc(who.join(", ")) + "</small>" : "") + "</span>" +
        (on ? pni("check", "mo-ck") : "") + "</button>";
    }).join("") + "</div>";
  }
  function betHTML(r) {
    var open = r.phase === "open", h = '<p class="mo-q">' + esc(T("mom.q." + r.q)) + "</p>";
    h += optRows(r, r.opts || [], r.mine, open);
    if (r.answer) {
      var rn = rightNames(r);
      h += '<p class="mo-res">' + esc(T("mom.answer", { v: optLabel(r, r.answer.v) })) + "</p>" + '<p class="mo-sub">' + esc(rn.length ? T("mom.right", { names: joinNames(rn) }) : T("mom.noright")) + "</p>";
    } else if (!r.mine && open) h += '<p class="mo-sub">' + esc(T("mom.hidden")) + "</p>";
    else h += '<p class="mo-sub">' + esc(T("mom.picks", { n: r.n_picks | 0, m: r.n_who | 0 })) + " · " + esc(open ? T("mom.wait") : T("mom.closed")) + "</p>";
    return h;
  }
  function bordHTML(r) {
    var h = '<p class="mo-sub">' + esc(T("mom.bord.lead", { n: r.n_who, bar: r.bar_name || "" })) + "</p>" +
      '<p class="mo-q">' + esc(T("mom.bord.m" + (r.mission || 1))) + "</p>";
    if (r.done_at) h += '<p class="mo-res">' + pni("check", "pi-lead") + esc(T("mom.bord.done", { t: hm(r.done_at), name: r.done_by || "" })) + "</p>";
    else if (r.phase === "expired") h += '<p class="mo-sub">' + esc(T("mom.bord.expired")) + "</p>";
    else h += '<button type="button" class="mo-btn mo-pri" data-mo-a="done">' + pni("check") + "<span>" + esc(T("mom.done")) + "</span></button>";
    return h;
  }
  function agentHTML(r) {
    var h = "";
    if (r.phase === "done") {
      var a = r.answer || {};
      h += '<p class="mo-q">' + esc(T("mom.ag.was", { name: faceName(r, r.agent_k) })) + "</p>";
      if (r.mission) h += '<p class="mo-sub">' + esc(T("mom.ag.mission", { m: T("mom.ag.m" + r.mission) })) + "</p>";
      h += '<p class="mo-res">' + esc(!a.done ? T("mom.ag.notDone") : a.won ? T("mom.ag.won") : T("mom.ag.lost", { n: a.right | 0, m: a.votes | 0 })) + "</p>";
      return h;
    }
    if (r.agent_me) {
      h += '<p class="mo-q">' + esc(T("mom.ag.you")) + "</p>" + '<p class="mo-mission">' + esc(T("mom.ag.m" + (r.mission || 1))) + "</p>" +
        '<p class="mo-sub">' + esc(T("mom.ag.only")) + " " + esc(T("mom.ag.when", { t: hm(r.reveal_at) })) + "</p>";
      h += r.done_at ? '<p class="mo-res">' + pni("check", "pi-lead") + esc(T("mom.ag.doneMe")) + "</p>"
        : '<button type="button" class="mo-btn mo-pri" data-mo-a="done">' + pni("check") + "<span>" + esc(T("mom.done")) + "</span></button>";
      return h;
    }
    if (r.phase === "vote") {
      var opts = Object.keys(r.names || {}).filter(function (k) { return k !== r.me; }).map(function (k) { return { v: k }; });
      h += '<p class="mo-q">' + esc(T("mom.ag.vote")) + "</p>" + optRows(r, opts, r.mine, !r.mine);
      if (r.mine) h += '<p class="mo-sub">' + esc(T("mom.ag.voted", { n: r.n_picks | 0, m: Math.max(1, (r.n_who | 0) - 1) })) + "</p>";
      return h;
    }
    h += '<p class="mo-q">' + esc(T("mom.ag.secret")) + "</p>" + '<p class="mo-sub">' + esc(T("mom.ag.when", { t: hm(r.reveal_at) })) + "</p>";
    if (r.host_me) h += '<button type="button" class="mo-btn mo-pri" data-mo-a="reveal">' + pni("eye") + "<span>" + esc(T("mom.ag.reveal")) + "</span></button>";
    return h;
  }

  /* ---------- the morning report (after2.js) ---------- */
  function reportData(gid, night) {
    if (off || !A || !gid) return Promise.resolve(null);
    var args = { p_group_id: gid }; if (night) args.p_night = night;
    return A.rpc("moments_report", args).then(function (r) {
      if (r.error) { if (missing(r.error)) off = true; return null; }
      var d = A.parseData(r.data) || {}; return Array.isArray(d.rounds) ? d.rounds : [];
    }, function () { return null; });
  }
  function reportCards(m) {
    var out = [], rs = (m && m.d && m.d.moments) || [];
    rs.forEach(function (r) {
      if ((r.kind === "vad" || r.kind === "halvtid") && r.answer) {
        var rn = rightNames(Object.assign({}, r, { me: "" }));
        out.push({ type: "list", kick: T("mom.rep." + r.kind), sub: T("mom.q." + r.q), icon: "sparkle",
          lines: [T("mom.answer", { v: optLabel(Object.assign({}, r, { me: "" }), r.answer.v) }), rn.length ? T("mom.right", { names: joinNames(rn) }) : T("mom.noright")] });
      } else if (r.kind === "bord") {
        out.push({ type: "list", kick: T("mom.rep.bord"), sub: r.bar_name || "", icon: "users",
          lines: [T("mom.bord.m" + (r.mission || 1)), r.done_at ? T("mom.rep.bordDone", { t: hm(r.done_at), name: r.done_by || "" }) : T("mom.rep.bordNot")] });
      } else if (r.kind === "agent" && r.answer) {
        var a = r.answer, rr = Object.assign({}, r, { me: "" });
        out.push({ type: "list", kick: T("mom.rep.agent"), icon: "eye-off",
          lines: [T("mom.ag.was", { name: faceName(rr, r.agent_k || a.v) }), r.mission ? T("mom.ag.mission", { m: T("mom.ag.m" + r.mission) }) : "",
            !a.done ? T("mom.ag.notDone") : a.won ? T("mom.ag.won") : T("mom.ag.lost", { n: a.right | 0, m: a.votes | 0 })].filter(Boolean) });
      }
    });
    return out;   // fixMo N-07: every moment of the night (max 5 a night: vad, halvtid, 2 bord, agent)
  }

  /* ---------- group page (the social lane places these) ---------- */
  // the moment of this group that waits for me (a row, tap = the card), or null
  function groupCard(g) {
    if (off || !on || !g) return null;
    var r = needing().filter(function (x) { return String(x.group_id) === String(g.id); })[0];
    if (!r) return null;
    var b = document.createElement("button");
    b.type = "button"; b.className = "mo-gcard";
    b.innerHTML = '<span class="mo-gc-i">' + pni(r.kind === "agent" ? "eye-off" : r.kind === "bord" ? "users" : "sparkle") + '</span><span class="mo-gc-x"><b>' + esc(T("mom." + r.kind)) +
      "</b><span>" + esc(r.q ? T("mom.q." + r.q) : r.kind === "bord" ? (r.bar_name || "") : T("mom.chip." + need(r))) + "</span></span>" + pni("chev-right", "mo-chev");
    b.addEventListener("click", function () { openCard(r.id); });
    return b;
  }
  // GM4: "Partyspel pågår · Imposter — Anton ä värd · 3 med · Hoppa in" (a room of this group is live), or null
  function roomCard(g) {
    if (!A || !A.rpc || !g || !g.id) return null;
    var b = document.createElement("button");
    b.type = "button"; b.className = "mo-gcard mo-room"; b.hidden = true;
    A.rpc("party_group", { p_group_id: g.id }).then(function (r) {
      var d = r && !r.error ? A.parseData(r.data) : null, room = d && d.room;
      if (!room) { b.remove(); return; }
      var game = { imposter: "Imposter", survivor: "Östra lägret", hatten: "Namn i hatten", flocken: "Flocken", vagen: "Vågen" }[room.game] || room.code || "";
      b.innerHTML = '<span class="mo-gc-i">' + pni("game") + '</span><span class="mo-gc-x"><b>' + esc(T("mom.room.party", { game: game })) + "</b><span>" +
        esc(T("mom.room.sub", { host: room.host_name || "?", n: room.n | 0 })) + "</span></span>" + pni("chev-right", "mo-chev");
      b.hidden = false;
      b.onclick = function () { if (window.PARTY && window.PARTY.open) window.PARTY.open({ room: room.is_in ? room.id : null, code: room.is_in ? null : room.code, group: { id: g.id, name: g.name || "" } }); };
    }, function () { b.remove(); });
    return b;
  }
  // Förfest started on one phone with these group members ticked (3+ incl. me) → the Hemlig agent moment
  function homeParty(g, names) {
    if (off || !on || !A || !g || !g.id || !names || names.length < 2) return Promise.resolve(null);
    return A.rpc("moment_home_party", { p_group_id: g.id, p_names: names.slice(0, 30) }).then(function (r) {
      if (r.error) { if (missing(r.error)) off = true; return null; }
      var d = A.parseData(r.data) || {};
      if (d.ok) { pollAt = 0; poll(true); }
      return d;
    }, function () { return null; });
  }

  /* ---------- links: /?mom=<id> (moment push), /?mgame=<gid> (spel start push), /?party=<code> while open ---------- */
  function route(url, cold) {
    var q; try { q = new URL(url, location.href).searchParams; } catch (e) { return false; }
    var m = q.get("mom"), g = q.get("mgame"), pc = q.get("party");
    if (m && /^\d{1,18}$/.test(m)) { setTimeout(function () { flagsCheck(true).then(function () { return poll(true); }).then(function () { openCard(+m); }); }, 200); return true; }
    if (g && /^[0-9a-f-]{36}$/i.test(g)) { setTimeout(function () { if (window.SPEL && window.SPEL.play) window.SPEL.play({ id: g, name: "" }); }, 300); return true; }
    if (!cold && pc && window.PARTY && window.PARTY.open) { setTimeout(function () { window.PARTY.open({ code: String(pc).replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase() }); }, 300); return true; }
    return false;
  }
  try {
    var q0 = new URLSearchParams(location.search);
    if (q0.get("mom") || q0.get("mgame")) {
      deep = location.href;
      q0.delete("mom"); q0.delete("mgame");
      var qs = q0.toString(); history.replaceState(history.state, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
    }
  } catch (e) {}
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", function (e) {
    var d = e.data || {}; if (d.type === "olnu-open" && d.url) route(d.url, false);
  });

  window.MOMENTS = {
    off: function () { return off || !on; },
    init: function (api) { A = api; },
    onAuthed: function () {
      flagsCheck(true).then(function (o) {
        if (deep) { var u = deep; deep = null; route(u, true); }
        if (o) setTimeout(function () { poll(true); }, 2500);
      });
    },
    onPoll: function () {
      if (off || !A) return;
      if (!on) { if (Date.now() - flagsAt > FLAGS_MS) flagsCheck(false).then(function (o) { if (o) poll(true); }); return; }
      poll(false);
    },
    chipHTML: function () {
      if (off || !on) return "";
      var r = needing()[0]; if (!r) return "";
      var n = need(r);
      return '<button type="button" class="hx-chip mo-chip" data-hx="mom" data-mo="' + esc(String(r.id)) + '" aria-label="' + esc(T("mom." + r.kind)) + '">' +
        pni(n === "reveal" ? "eye" : n === "agent" || n === "vote" ? "eye-off" : n === "bord" ? "users" : "sparkle", "pi-lead") + esc(T("mom.chip." + n)) + "</button>";
    },
    hudClick: function (el) { openCard(el && el.getAttribute ? el.getAttribute("data-mo") : null); },
    open: openCard, poll: function () { return poll(true); }, reportData: reportData, reportCards: reportCards,
    groupCard: groupCard, roomCard: roomCard, homeParty: homeParty,
    _rounds: function () { return rounds; }, _need: need, _T: T
  };
})();
