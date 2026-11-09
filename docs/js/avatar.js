/* PintsNow (Öl Nu) — 👤 AVATAR v2 (owner 2026-11-07: "Like Snapchat Bitmoji but our own …"; v2 same day: "MANY more items so
   everyone gets a unique character, and an even better design for all items").
   - Art: one flat SVG drawn in code (viewBox 0 0 100 100, circle). One light from the top left: every big shape gets ONE soft
     highlight rim and ONE shadow tone (cel(); same offsets everywhere). Feature lines 1.7, outlines 1.4. Original art, no assets,
     no brand logos, no team crests, no copied characters.
   - Layers: background · hair (back, cut under a hat) · neck · top + rank mark + mini ribbons · neckwear · hair (in front of the
     shoulders: braids) · ears + earrings · head · cheeks · marks · face paint · nose · eyes · brows · mouth · facial hair · foam ·
     hair (front, cut under a hat) · glasses/mask · headwear · held item + hand · frame ring + rank badge.
   - Small size (≤ 40 px: chat, rows, NU strip): `small` = flat shapes, thicker face lines, no ribbons and no fine marks.
   - Spec (server table `avatars`, ≤ 1 KB): v1 keys {v, sk, fs, ey, br, mt, hr, hc, fh, hw, gl, up, uc, bg, ms, md} keep their
     indexes and meaning (new items are added at the end), plus v2 keys: ec eye colour, ns nose, ck cheeks, fm marks, fp face paint,
     er ears/earrings, nk neckwear, hi held item, fr frame, h2 second hair colour (0 = none, else palette index + 1), ht two-tone style,
     hx / ux / bx "egen färg" for hair / top / background (0 = palette, else 0xRRGGBB + 1). A missing key = 0 = the v1 look.
   - No spec = a default character from `seed`: the v1 fields come from the same random stream as v1 (same look), the v2 fields from
     a second stream (only free items), so everyone is more unique and nobody changes much.
   - Unlocks (LOCKS = SQL olnu_avatar_locks(), 0200): r rank index, m medal, s best weekend streak, b bars in the passport, t towns,
     e events said yes to, g groups, k engångskamera shots, d date window "MM-DD:MM-DD" (Stockholm), o = list of alternatives (any one
     is enough). The item you already wear stays yours (seasonal items too). Rarity is shown (◆ ovanlig … legendarisk). Nothing is
     bought. PREMIUM_LATER marks items that COULD become Premium later (not locked now).
   - RPCs: my_avatar(), set_my_avatar(p_spec), avatars_for(p_group_id | null). Missing RPC (old server) = feature off.
   - Shown in: group chat / event chat / DM (next to each message group, social.js hook chatSeen), Medlemmar
     (statusRow), Vänner rows (friendRow), the group NU strip (faces), the Profil hero (profileAv → opens the editor).
   - Cache per group / friends 60 s; every avatar element has data-avk so a save repaints all of them at once.
   Public: window.AVATAR. Styles: avatar.css. */
(function () {
  "use strict";
  var U = window.U, I = window.I18N;
  var A = null, off = false, me = null, meP = null, uid = 0;
  var groups = {}, friends = null, svgMemo = {}, svgMemoN = 0;
  function sv() { return !I || I.lang !== "en"; }
  function L(s, e) { return sv() ? s : e; }
  function esc(s) { return U.esc(s); }
  function missing(err) {
    try { if (U.missing) return U.missing(err); } catch (e) {}
    var m = String((err && (err.code || "")) + " " + (err && err.message || ""));
    return /PGRST202|42883|does not exist|Could not find the function/i.test(m);
  }
  function codeOf(err) { var m = String((err && err.message) || ""); var x = m.match(/(invalid_avatar|locked|slow_down|not_member|not_authenticated)/); return x ? x[1] : ""; }
  function rpc(name, params) {
    if (!A || !A.rpc) return Promise.resolve({ data: null, error: { message: "no_api" } });
    return A.rpc(name, params).then(function (r) {
      if (r && r.error && missing(r.error)) off = true;
      return r || { data: null, error: { message: "error" } };
    });
  }
  function parse(d) { return A && A.parseData ? A.parseData(d) : (typeof d === "string" ? JSON.parse(d) : d || {}); }

  /* ---------- Palettes (v1 entries first, same order) ---------- */
  var SKIN = ["#f7d9c4", "#efc3a1", "#dca47c", "#c08457", "#9a643f", "#6f4529", "#4b2e1c", "#8fd18a",
    "#fbe7da", "#f3cdb6", "#e8b58f", "#d9a06e", "#c98d5b", "#b0703f", "#a35f3a", "#80492a", "#5c3622", "#3a2217",
    "#7fb3ff", "#b79cff", "#a7bf96", "#eef4fb", "#e8b93a"];
  var HAIRC = ["#1d1a19", "#3b2618", "#6b4426", "#d9b25c", "#b5532a", "#8d8d8d", "#e8e6e1", "#ff6fae", "#4aa3ff",
    "#c4ad80", "#f0e2bd", "#d98c55", "#8a3a1c", "#7a4a2a", "#5a5654", "#14171f", "#3ddc84", "#9a5ae0", "#1fb2a6",
    "#ff8a1f", "#c3c7cf", "#e0302a"];
  var TOPC = ["#2f6fb8", "#c8202a", "#1fa45c", "#f5a623", "#6b2d8f", "#3a4766", "#e8e6e1", "#2b2b2b",
    "#f2c230", "#1d2b53", "#7a1f2b", "#2c5a3a", "#c9b28a", "#e66a9a", "#6fb6e8", "#e8722a", "#6b4426", "#6b6d32", "#b49ae0", "#8fd6b8"];
  var BGC = ["#f5a623", "#1fa45c", "#2f6fb8", "#c8202a", "#6b2d8f", "#1d8a8a", "#34497f", "#d9578f"];
  var EYEC = ["#1a1410", "#5a3a1f", "#7a6a2c", "#3f8a4a", "#3f7fd0", "#7c8a99", "#c98a1d", "#24407a", "#8fd3ff", "#8a5ad6", "#d8262f", "#e8b93a"];

  /* ---------- Catalog: names [sv, en] per slot. Index = the value in the spec. NEVER reorder; add at the end. ---------- */
  var N = {
    sk: [["Ljus", "Light"], ["Ljus 2", "Light 2"], ["Mellan", "Medium"], ["Mellanbrun", "Medium brown"], ["Mörk", "Dark"], ["Mörk 2", "Dark 2"], ["Mörkast", "Deep"], ["Grönis", "Greenie"],
      ["Porslin", "Porcelain"], ["Rosig", "Rosy"], ["Beige", "Beige"], ["Gyllene", "Golden"], ["Oliv", "Olive"], ["Solbränd", "Tan"], ["Kola", "Caramel"], ["Kastanj", "Chestnut"], ["Espresso", "Espresso"], ["Ebenholts", "Ebony"],
      ["Blåis", "Bluey"], ["Lavendel", "Lavender"], ["Zombie", "Zombie"], ["Snögubbe", "Snowman"], ["Guldstaty", "Gold statue"]],
    fs: [["Rund", "Round"], ["Oval", "Oval"], ["Kantig", "Square"], ["Hjärta", "Heart"], ["Lång", "Long"], ["Bred", "Wide"], ["Markerad", "Angular"], ["Mjuk", "Soft"]],
    ey: [["Prickar", "Dots"], ["Glada", "Happy"], ["Stora", "Wide"], ["Sömniga", "Sleepy"], ["Blink", "Wink"], ["Fokus", "Focus"], ["Stjärnor", "Stars"],
      ["Mandel", "Almond"], ["Runda", "Round"], ["Fransar", "Lashes"], ["Pigga", "Bright"], ["Knip", "Squeeze"], ["Hjärtan", "Hearts"], ["Trötta", "Tired"],
      ["Himlar", "Eye roll"], ["Sidoblick", "Side-eye"], ["Glädjetårar", "Happy tears"], ["Snurriga", "Dizzy"], ["Kryss", "X eyes"], ["Glitter", "Sparkle"], ["Laser", "Laser"], ["Kattögon", "Cat eyes"]],
    ec: [["Standard", "Default"], ["Brun", "Brown"], ["Hassel", "Hazel"], ["Grön", "Green"], ["Blå", "Blue"], ["Grå", "Grey"], ["Bärnsten", "Amber"], ["Mörkblå", "Dark blue"],
      ["Isblå", "Ice"], ["Violett", "Violet"], ["Röd", "Red"], ["Guld", "Gold"]],
    br: [["Inga", "None"], ["Raka", "Flat"], ["Höjda", "Raised"], ["Arga", "Angry"], ["Buskiga", "Bushy"],
      ["Tunna bågar", "Thin arch"], ["Tjocka", "Thick"], ["Ledsna", "Sad"], ["Skeptisk", "Skeptic"], ["Monobryn", "Unibrow"], ["Snitt", "Slit"], ["Prickbryn", "Dot brows"],
      ["Mjuka", "Soft"], ["Oroliga", "Worried"], ["Skarpa", "Sharp"]],
    ns: [["Liten", "Small"], ["Prick", "Dot"], ["Knopp", "Button"], ["Spetsig", "Pointy"], ["Bred", "Broad"], ["Romersk", "Roman"], ["Uppnäsa", "Upturned"], ["Lång", "Long"],
      ["Rund", "Round"], ["Clownnäsa", "Clown nose"], ["Rudolf", "Rudolph"], ["Näsring", "Nose ring"]],
    mt: [["Leende", "Smile"], ["Flin", "Grin"], ["Skratt", "Laugh"], ["Rak", "Flat"], ["Snett", "Smirk"], ["Oj", "Oh"], ["Tunga", "Tongue"],
      ["Tandleende", "Toothy"], ["Läppar", "Lips"], ["Röda läppar", "Red lips"], ["Sur", "Grumpy"], ["Puss", "Kiss"], ["Visslar", "Whistle"], ["Bus", "Cheeky"],
      ["Grimas", "Grimace"], ["Glugg", "Gap tooth"], ["Vampyr", "Vampire"], ["Vågig", "Wavy"], ["Tandställning", "Braces"], ["Guldtand", "Gold tooth"], ["Tuggummi", "Bubble gum"], ["Jubel", "Cheer"]],
    ck: [["Lätt rodnad", "Light blush"], ["Ingen", "None"], ["Rosiga", "Rosy"], ["Ölrosor", "Beer glow"], ["Gropar", "Dimples"], ["Dockrosor", "Doll cheeks"], ["Kylbitna", "Frosty"]],
    fm: [["Inga", "None"], ["Fräknar", "Freckles"], ["Massor av fräknar", "Lots of freckles"], ["Skönhetsfläck", "Beauty mark"], ["Ärr i brynet", "Brow scar"], ["Ärr på kinden", "Cheek scar"],
      ["Plåster", "Plaster"], ["Stjärntatuering", "Star tattoo"], ["Hjärttatuering", "Heart tattoo"], ["Svala på halsen", "Neck swallow"], ["Skrattrynkor", "Laugh lines"], ["Dagen efter", "Morning after"]],
    fp: [["Ingen", "None"], ["Flagga på kinden", "Cheek flag"], ["Supporterränder", "Fan stripes"], ["Kamostreck", "Camo stripes"], ["Fältmålning", "Field paint"], ["Glitter", "Glitter"],
      ["Dödskalle", "Skull"], ["Tigerränder", "Tiger stripes"], ["Midsommarblommor", "Midsummer flowers"], ["Snöflingor", "Snowflakes"], ["Regnbåge", "Rainbow"], ["Ölskum", "Beer foam"]],
    er: [["Inga", "None"], ["Stift", "Studs"], ["Små ringar", "Small hoops"], ["Stora ringar", "Big hoops"], ["Pärlor", "Pearls"], ["Dalahästar", "Dala horses"], ["Fjädrar", "Feathers"],
      ["Kapsyler", "Bottle caps"], ["Diamanter", "Diamonds"], ["Pluggar", "Plugs"], ["Alvöron", "Elf ears"], ["Pumpor", "Pumpkins"], ["Ringrad", "Ring row"]],
    hr: [["Flint", "Bald"], ["Snagg", "Buzz"], ["Bena", "Side part"], ["Tofs", "Quiff"], ["Rufsig", "Messy"], ["Långt", "Long"], ["Knut", "Bun"], ["Lockigt", "Curly"], ["Hästsvans", "Ponytail"], ["Mohikan", "Mohawk"], ["Hockeyfrilla", "Mullet"],
      ["Pixie", "Pixie"], ["Page", "Bob"], ["Rak lugg", "Blunt bangs"], ["Långt lockigt", "Long curls"], ["Afro", "Afro"], ["Flätor", "Braids"], ["Dreads", "Locs"], ["Tofsar", "Space buns"],
      ["Bakåtslick", "Slicked back"], ["Kort lockigt", "Short curls"], ["Undercut", "Undercut"], ["Mittbena", "Middle part"], ["Vågigt", "Wavy"], ["Hög hästsvans", "High ponytail"],
      ["Toppknut", "Top knot"], ["Sidofläta", "Side braid"], ["Spikes", "Spikes"], ["Sidorakat", "Side shave"], ["Emolugg", "Swoop"], ["Rader", "Cornrows"], ["Tunnhårig", "Thinning"],
      ["Rockabilly", "Rockabilly"], ["Gardinlugg", "Curtain bangs"]],
    hc: [["Svart", "Black"], ["Mörkbrun", "Dark brown"], ["Brun", "Brown"], ["Blond", "Blond"], ["Röd", "Ginger"], ["Grå", "Grey"], ["Vit", "White"], ["Rosa", "Pink"], ["Blå", "Blue"],
      ["Askblond", "Ash blond"], ["Platina", "Platinum"], ["Jordgubbsblond", "Strawberry blond"], ["Kopparröd", "Auburn"], ["Kastanj", "Chestnut"], ["Salt & peppar", "Salt & pepper"],
      ["Blåsvart", "Blue-black"], ["Grön", "Green"], ["Lila", "Purple"], ["Turkos", "Teal"], ["Neonorange", "Neon orange"], ["Silver", "Silver"], ["Klarröd", "Bright red"]],
    fh: [["Inget", "None"], ["Skäggstubb", "Stubble"], ["Mustasch", "Mustache"], ["Valross", "Walrus"], ["Pipskägg", "Goatee"], ["Helskägg", "Full beard"], ["Hakband", "Chinstrap"], ["Styrmustasch", "Handlebar"], ["Vikingafläta", "Viking braid"],
      ["Blyertsmustasch", "Pencil"], ["Hästsko", "Horseshoe"], ["Hakfläck", "Soul patch"], ["Kort helskägg", "Short beard"], ["Trollkarlsskägg", "Wizard beard"], ["Polisonger", "Mutton chops"],
      ["Spetsskägg", "Van Dyke"], ["Skepparkrans", "Chin curtain"], ["Valross + stubb", "Walrus + stubble"], ["Tomteskägg", "Santa beard"], ["Stubb + mustasch", "Stubble + mustache"],
      ["Ankstjärt", "Ducktail"], ["Dubbelfläta", "Double braid"], ["Hakskägg", "Chin puff"], ["Stort helskägg", "Big beard"], ["Morrhår", "Whiskers"], ["Dalkarlsmustasch", "Dalecarlian"]],
    hw: [["Inget", "None"], ["Keps", "Cap"], ["Keps bak", "Backwards cap"], ["Mössa", "Beanie"], ["Bucket hat", "Bucket hat"], ["Fältmössa", "Field cap"], ["Basker", "Beret"], ["Hjälm", "Helmet"], ["Headset", "Headset"], ["Partyhatt", "Party hat"], ["Vikingahjälm", "Viking helmet"], ["Skärmmössa", "Peaked cap"], ["Tomteluva", "Santa hat"], ["Krona", "Crown"],
      ["Studentmössa", "Student cap"], ["Mössa med tofs", "Bobble hat"], ["Hockeyhjälm", "Hockey helmet"], ["Dalahatt", "Dala hat"], ["Midsommarkrans", "Flower crown"], ["Luciakrona", "Lucia crown"],
      ["Svettband", "Sweatband"], ["Bandana", "Bandana"], ["Fiskarmössa", "Docker beanie"], ["Cowboyhatt", "Cowboy hat"], ["Hatt", "Fedora"], ["Plommonstop", "Bowler"], ["Kaptensmössa", "Captain's cap"],
      ["Sjömansmössa", "Sailor cap"], ["Stålhjälm", "Steel helmet"], ["Pälsmössa", "Fur hat"], ["Flyghjälm", "Flying cap"], ["Pappkrona", "Paper crown"], ["Ölhatt", "Beer hat"], ["Djävulshorn", "Devil horns"],
      ["Häxhatt", "Witch hat"], ["Nyårshatt", "New Year hat"], ["Renhorn", "Antlers"], ["Kattöron", "Cat ears"], ["Truckerkeps", "Trucker cap"], ["Solhatt", "Sun hat"], ["Skidhjälm", "Ski helmet"],
      ["Gloria", "Halo"], ["Blå basker", "Blue beret"], ["Generalsmössa", "General's cap"]],
    gl: [["Inget", "None"], ["Runda", "Round"], ["Fyrkant", "Square"], ["Solglas", "Shades"], ["Skidglas", "Ski goggles"], ["Pilot", "Aviators"], ["Rånarluva", "Balaclava"], ["Partymask", "Party mask"], ["Ögonlapp", "Eye patch"], ["Mörkersikte", "Night vision"], ["Monokel", "Monocle"],
      ["Kattöga", "Cat-eye"], ["Hornbågar", "Browline"], ["Små solglas", "Small shades"], ["Hjärtglas", "Heart glasses"], ["Stjärnglas", "Star glasses"], ["Sportglas", "Sport shield"], ["Halvbågar", "Half rims"],
      ["Stora bågar", "Big frames"], ["3D-glas", "3D glasses"], ["Ölglasögon", "Beer goggles"], ["Mässingsglas", "Brass goggles"], ["Dykmask", "Dive mask"], ["Ögonmask", "Eye mask"], ["Partyglitter", "Party glitter"],
      ["Skyddsmask", "Gas mask"], ["Läsglasögon", "Readers"], ["Glaciärglas", "Glacier glasses"], ["Spegelglas", "Mirror shades"], ["Pixelglas", "Pixel shades"]],
    nk: [["Inget", "None"], ["Halsduk", "Scarf"], ["Slips", "Tie"], ["Fluga", "Bow tie"], ["Kedja", "Chain"], ["Dalahästhänge", "Dala horse pendant"], ["Pärlhalsband", "Pearls"], ["Scouthalsduk", "Neckerchief"],
      ["Supporterhalsduk", "Fan scarf"], ["Hundbrickor", "Dog tags"], ["Kapsylhänge", "Bottle cap pendant"], ["Choker", "Choker"], ["Medalj i band", "Neck medal"], ["Visselpipa", "Whistle"], ["Ljusslinga", "Fairy lights"], ["Guldkedja", "Gold chain"]],
    up: [["T-shirt", "T-shirt"], ["Huvtröja", "Hoodie"], ["Flanell", "Flannel"], ["Matchtröja", "Jersey"], ["Fältjacka", "Field jacket"], ["Officersjacka", "Officer jacket"], ["Generalsrock", "General's coat"], ["Amiralsrock", "Admiral's coat"], ["Smoking", "Tuxedo"],
      ["Hockeytröja", "Hockey jersey"], ["Fotbollströja", "Football shirt"], ["Dalatröja", "Dala sweater"], ["Regnjacka", "Raincoat"], ["Jeansjacka", "Denim jacket"], ["Skinnjacka", "Leather jacket"],
      ["Kavaj", "Blazer"], ["Piké", "Polo shirt"], ["Linne", "Tank top"], ["Randig tröja", "Striped top"], ["Polotröja", "Turtleneck"], ["Dunjacka", "Puffer"], ["Studentoverall", "Student overall"],
      ["Folkdräkt", "Folk costume"], ["Jultröja", "Christmas jumper"], ["Skeletttröja", "Skeleton top"], ["Sjömanskrage", "Sailor top"], ["Splitterkamo", "Splinter camo"], ["Pilotjacka", "Flight jacket"],
      ["Paraduniform", "Dress uniform"], ["Bartenderväst", "Bartender vest"], ["Varselväst", "Hi-vis vest"]],
    uc: [["Blå", "Blue"], ["Röd", "Red"], ["Grön", "Green"], ["Gul", "Amber"], ["Lila", "Purple"], ["Grå", "Slate"], ["Vit", "White"], ["Svart", "Black"],
      ["Citron", "Lemon"], ["Marin", "Navy"], ["Vinröd", "Wine"], ["Skog", "Forest"], ["Sand", "Sand"], ["Rosa", "Pink"], ["Himmel", "Sky"], ["Orange", "Orange"], ["Brun", "Brown"], ["Oliv", "Olive"], ["Syren", "Lilac"], ["Mint", "Mint"]],
    bg: [["Bärnsten", "Amber"], ["Grön", "Green"], ["Blå", "Blue"], ["Röd", "Red"], ["Lila", "Purple"], ["Petrol", "Teal"], ["Natt", "Night"], ["Rosa", "Pink"], ["Kamouflage", "Camo"], ["Eld", "Flame"], ["Norrsken", "Aurora"], ["Guld", "Gold"],
      ["Himmel", "Sky"], ["Solnedgång", "Sunset"], ["Mint", "Mint"], ["Kol", "Charcoal"], ["Egen färg", "Own colour"], ["Ränder", "Stripes"], ["Prickar", "Dots"], ["Rutig duk", "Gingham"],
      ["Dalahästar", "Dala horses"], ["Blågult", "Blue-yellow"], ["Midsommar", "Midsummer"], ["Fjällnorrsken", "Mountain aurora"], ["Stad i natt", "City at night"], ["Krogen", "The pub"], ["Skog", "Forest"],
      ["Röd stuga", "Red cottage"], ["Vinter", "Winter"], ["Valborgsbrasa", "Walpurgis fire"], ["Halloween", "Halloween"], ["Jul", "Christmas"], ["Fyrverkeri", "Fireworks"], ["Skärgård", "Archipelago"],
      ["Konfetti", "Confetti"], ["Disco", "Disco"], ["Kartan", "The map"], ["Rymden", "Space"], ["Ölbubblor", "Beer bubbles"]],
    hi: [["Inget", "Nothing"], ["Stor stark", "Pint"], ["Alkoholfritt", "Alcohol-free"], ["Mobil", "Phone"], ["Flagga", "Flag"], ["Gitarr", "Guitar"], ["Vinglas", "Wine glass"], ["Kaffe", "Coffee"],
      ["Korv med bröd", "Hot dog"], ["Mikrofon", "Microphone"], ["Engångskamera", "Disposable camera"], ["Snapsglas", "Schnapps glass"], ["Pumplykta", "Jack-o'-lantern"], ["Glögg", "Mulled wine"],
      ["Sejdel", "Beer stein"], ["Pokal", "Trophy"], ["Vattenglas", "Water"]],
    fr: [["Ingen", "None"], ["Gradring", "Rank ring"], ["Silver", "Silver"], ["Guld", "Gold"], ["Platina", "Platinum"], ["Diamant", "Diamond"], ["Lagerkrans", "Laurel"], ["Blågul", "Blue-yellow"],
      ["Neon", "Neon"], ["Eldring", "Fire ring"], ["Stjärnring", "Star ring"]],
    ht: [["Toppar", "Tips"], ["Rötter", "Roots"], ["Delat", "Split"], ["Slinga", "Streak"]]
  };
  var SLOTS = ["sk", "fs", "ey", "ec", "br", "ns", "mt", "ck", "fm", "fp", "er", "hr", "hc", "fh", "hw", "gl", "nk", "up", "uc", "bg", "hi", "fr"];
  var MAX = { ms: 1, nl: 1, hx: 16777216, ux: 16777216, bx: 16777216, h2: HAIRC.length, ht: N.ht.length - 1 };
  SLOTS.forEach(function (k) { MAX[k] = N[k].length - 1; });
  var V1KEYS = ["sk", "fs", "ey", "br", "mt", "hr", "hc", "fh", "hw", "gl", "up", "uc", "bg"];
  var V1MAX = { sk: 7, fs: 2, ey: 6, br: 4, mt: 6, hr: 10, hc: 8, fh: 8, hw: 13, gl: 10, up: 8, uc: 7, bg: 11 };

  /* ---------- Unlocks. Same as SQL olnu_avatar_locks() (0200; v1 entries unchanged from 0172). ---------- */
  var HALLO = "10-20:11-08", JUL = "12-01:01-06", MIDS = "06-10:06-30", VALB = "04-20:05-03", NYAR = "12-27:01-06";
  var LOCKS = {
    // v1 (0172) — do not change
    "sk:7": { r: 6 }, "ey:6": { r: 8 }, "mt:6": { m: "radio" },
    "hr:9": { r: 5 }, "hr:10": { b: 5 }, "hc:7": { m: "sr10" }, "hc:8": { s: 3 },
    "fh:7": { r: 7 }, "fh:8": { t: 2 },
    "hw:5": { r: 3 }, "hw:6": { r: 4 }, "hw:7": { r: 6 }, "hw:8": { r: 9 }, "hw:9": { e: 1 }, "hw:10": { t: 3 },
    "hw:11": { r: 12 }, "hw:12": { m: "lucia" }, "hw:13": { m: "kung" },
    "gl:5": { r: 7 }, "gl:6": { r: 5 }, "gl:7": { e: 1 }, "gl:8": { m: "uggla" }, "gl:9": { r: 14 }, "gl:10": { r: 17 },
    "up:3": { m: "sg10" }, "up:4": { r: 4 }, "up:5": { r: 12 }, "up:6": { r: 20 }, "up:7": { r: 25 }, "up:8": { s: 4 },
    "bg:8": { r: 3 }, "bg:9": { s: 2 }, "bg:10": { t: 2 }, "bg:11": { r: 15 },
    // v2 (0200)
    "sk:18": { r: 10 }, "sk:19": { g: 3 }, "sk:20": { d: HALLO }, "sk:21": { d: JUL, o: [{ m: "lucia" }] }, "sk:22": { r: 35 },
    "ey:12": { m: "sr10" }, "ey:17": { m: "krogrunda" }, "ey:18": { d: HALLO }, "ey:19": { e: 3 }, "ey:20": { r: 30 }, "ey:21": { d: HALLO, o: [{ r: 20 }] },
    "ec:8": { s: 2 }, "ec:9": { r: 8 }, "ec:10": { d: HALLO, o: [{ m: "spoke" }] }, "ec:11": { m: "kung" },
    "br:10": { r: 6 },
    "ns:9": { e: 2 }, "ns:10": { d: JUL },
    "mt:16": { d: HALLO }, "mt:19": { b: 15 }, "mt:20": { m: "dagsljus" }, "mt:21": { m: "liga" },
    "fp:3": { r: 5 }, "fp:4": { r: 11 }, "fp:5": { e: 1 }, "fp:6": { d: HALLO }, "fp:8": { d: MIDS, o: [{ m: "midsommar" }] }, "fp:9": { d: JUL, o: [{ m: "lucia" }] }, "fp:11": { m: "m50" },
    "er:5": { m: "faltresa" }, "er:7": { m: "m100" }, "er:8": { r: 25 }, "er:11": { d: HALLO },
    "hr:27": { r: 8 }, "hr:28": { s: 2 }, "hr:32": { b: 10 },
    "hc:16": { g: 2 }, "hc:17": { r: 9 }, "hc:18": { t: 3 }, "hc:19": { d: HALLO, o: [{ r: 16 }] }, "hc:21": { e: 2 },
    "fh:13": { r: 22 }, "fh:18": { d: JUL, o: [{ m: "lucia" }] }, "fh:21": { t: 5 }, "fh:24": { d: HALLO },
    "hw:14": { d: "05-20:06-20", o: [{ d: "04-25:05-02" }, { r: 11 }] }, "hw:16": { g: 2 }, "hw:17": { b: 3 }, "hw:18": { d: MIDS, o: [{ m: "midsommar" }] },
    "hw:19": { d: "12-01:12-20", o: [{ m: "lucia" }] }, "hw:23": { t: 4 }, "hw:25": { s: 3 }, "hw:26": { r: 16 }, "hw:27": { r: 7 }, "hw:28": { r: 8 },
    "hw:29": { d: "11-15:03-15", o: [{ r: 13 }] }, "hw:30": { r: 18 }, "hw:31": { e: 1 }, "hw:32": { m: "m100" }, "hw:33": { d: HALLO }, "hw:34": { d: HALLO },
    "hw:35": { d: NYAR, o: [{ m: "nyar" }] }, "hw:36": { d: JUL }, "hw:37": { e: 2 }, "hw:41": { m: "komhem" }, "hw:42": { r: 15 }, "hw:43": { r: 30 },
    "gl:14": { m: "sg10" }, "gl:15": { e: 3 }, "gl:20": { m: "m50" }, "gl:21": { r: 12 }, "gl:22": { t: 3 }, "gl:23": { m: "spion" }, "gl:24": { d: NYAR, o: [{ m: "nyar" }] },
    "gl:25": { r: 20 }, "gl:28": { r: 10 }, "gl:29": { r: 26 },
    "nk:5": { m: "faltresa" }, "nk:8": { g: 2 }, "nk:9": { r: 6 }, "nk:10": { m: "m10" }, "nk:12": { m: "liga" }, "nk:13": { m: "trumslag" }, "nk:14": { d: JUL }, "nk:15": { r: 24 },
    "up:9": { e: 2 }, "up:11": { b: 8 }, "up:14": { r: 9 }, "up:15": { s: 2 }, "up:21": { g: 3 }, "up:22": { d: MIDS, o: [{ m: "midsommar" }] }, "up:23": { d: JUL, o: [{ m: "lucia" }] },
    "up:24": { d: HALLO }, "up:25": { r: 10 }, "up:26": { r: 8 }, "up:27": { r: 18 }, "up:28": { r: 28 }, "up:29": { b: 20 }, "up:30": { m: "hemvarn" },
    "bg:19": { b: 2 }, "bg:20": { g: 1 }, "bg:22": { d: MIDS, o: [{ m: "midsommar" }] }, "bg:23": { t: 5 }, "bg:24": { m: "n5" }, "bg:25": { b: 3 },
    "bg:29": { d: VALB, o: [{ m: "valborg" }] }, "bg:30": { d: HALLO }, "bg:31": { d: JUL, o: [{ m: "lucia" }] }, "bg:32": { d: NYAR, o: [{ m: "nyar" }] }, "bg:33": { t: 3 },
    "bg:34": { e: 2 }, "bg:35": { m: "n25" }, "bg:36": { b: 15 }, "bg:37": { r: 33 }, "bg:38": { m: "m10" },
    "hi:5": { e: 3 }, "hi:8": { b: 2 }, "hi:9": { m: "signal" }, "hi:10": { k: 1 }, "hi:11": { d: MIDS, o: [{ m: "midsommar" }, { d: "12-15:12-26" }] }, "hi:12": { d: HALLO },
    "hi:13": { d: JUL }, "hi:14": { r: 12 }, "hi:15": { m: "liga" }, "hi:16": { m: "vatten" },
    "fr:2": { r: 11 }, "fr:3": { r: 21 }, "fr:4": { r: 31 }, "fr:5": { r: 40 }, "fr:6": { m: "liga" }, "fr:8": { e: 3 }, "fr:9": { s: 5 }, "fr:10": { m: "n100" }
  };
  /* v3 tiers (feat 2026-11-07, owner: "too much is unlocked; only at glasses some things are locked"): a clear free set per
     category (all real skin tones, face shapes, natural hair colours and natural / cultural hair styles stay free) and 90 more
     items by rank (grad 2 = 5 meriter, 3 = 10, 4 = 18, 5 = 28, 6 = 40). n:1 = new in v3: open for grandfathered users (saved an
     avatar before v3, facts.gf from SQL 0252) and the item you already wear stays yours. Same list as SQL olnu_avatar_locks3() (0251). */
  var LOCKS3 = {
    "ey:11": { r: 2, n: 1 }, "ey:13": { r: 3, n: 1 }, "ey:14": { r: 4, n: 1 }, "ey:15": { r: 5, n: 1 }, "ey:16": { r: 6, n: 1 },
    "br:11": { r: 3, n: 1 }, "br:14": { r: 4, n: 1 },
    "ns:11": { r: 4, n: 1 },
    "mt:11": { r: 2, n: 1 }, "mt:12": { r: 2, n: 1 }, "mt:13": { r: 3, n: 1 }, "mt:14": { r: 3, n: 1 }, "mt:15": { r: 4, n: 1 }, "mt:17": { r: 5, n: 1 }, "mt:18": { r: 4, n: 1 },
    "ck:5": { r: 2, n: 1 }, "ck:6": { r: 3, n: 1 },
    "fm:4": { r: 2, n: 1 }, "fm:5": { r: 3, n: 1 }, "fm:6": { r: 2, n: 1 }, "fm:7": { r: 4, n: 1 }, "fm:8": { r: 4, n: 1 }, "fm:9": { r: 5, n: 1 }, "fm:11": { r: 6, n: 1 },
    "fp:7": { r: 4, n: 1 }, "fp:10": { r: 3, n: 1 },
    "er:6": { r: 3, n: 1 }, "er:9": { r: 4, n: 1 }, "er:10": { r: 5, n: 1 }, "er:12": { r: 3, n: 1 },
    "hr:18": { r: 2, n: 1 }, "hr:19": { r: 2, n: 1 }, "hr:21": { r: 3, n: 1 }, "hr:24": { r: 2, n: 1 }, "hr:25": { r: 3, n: 1 }, "hr:26": { r: 3, n: 1 }, "hr:29": { r: 4, n: 1 }, "hr:33": { r: 2, n: 1 },
    "hc:20": { r: 3, n: 1 },
    "fh:10": { r: 2, n: 1 }, "fh:11": { r: 2, n: 1 }, "fh:14": { r: 3, n: 1 }, "fh:15": { r: 3, n: 1 }, "fh:16": { r: 4, n: 1 }, "fh:17": { r: 4, n: 1 }, "fh:20": { r: 5, n: 1 }, "fh:22": { r: 3, n: 1 }, "fh:23": { r: 5, n: 1 }, "fh:25": { r: 6, n: 1 },
    "hw:15": { r: 2, n: 1 }, "hw:20": { r: 2, n: 1 }, "hw:21": { r: 3, n: 1 }, "hw:22": { r: 2, n: 1 }, "hw:24": { r: 4, n: 1 }, "hw:38": { r: 3, n: 1 }, "hw:39": { r: 3, n: 1 }, "hw:40": { r: 5, n: 1 },
    "gl:11": { r: 2, n: 1 }, "gl:12": { r: 2, n: 1 }, "gl:13": { r: 3, n: 1 }, "gl:16": { r: 4, n: 1 }, "gl:17": { r: 2, n: 1 }, "gl:18": { r: 3, n: 1 }, "gl:19": { r: 5, n: 1 }, "gl:26": { r: 2, n: 1 }, "gl:27": { r: 6, n: 1 },
    "nk:4": { r: 2, n: 1 }, "nk:6": { r: 3, n: 1 }, "nk:7": { r: 2, n: 1 }, "nk:11": { r: 3, n: 1 },
    "up:10": { r: 3, n: 1 }, "up:12": { r: 2, n: 1 }, "up:20": { r: 3, n: 1 },
    "uc:8": { r: 2, n: 1 }, "uc:10": { r: 2, n: 1 }, "uc:14": { r: 2, n: 1 }, "uc:15": { r: 2, n: 1 }, "uc:17": { r: 3, n: 1 }, "uc:18": { r: 3, n: 1 }, "uc:19": { r: 3, n: 1 },
    "bg:16": { r: 4, n: 1 }, "bg:17": { r: 2, n: 1 }, "bg:18": { r: 2, n: 1 }, "bg:21": { r: 3, n: 1 }, "bg:26": { r: 3, n: 1 }, "bg:27": { r: 4, n: 1 }, "bg:28": { r: 5, n: 1 },
    "hi:4": { r: 2, n: 1 }, "hi:6": { r: 3, n: 1 },
    "fr:7": { r: 4, n: 1 }
  };
  Object.keys(LOCKS3).forEach(function (k) { if (!LOCKS[k]) LOCKS[k] = LOCKS3[k]; });
  // Hand-picked rarity (else from the lock: r ≥ 30 → 4, r ≥ 20 → 3, rank ≥ 10 / medal / streak ≥ 3 / bars ≥ 10 → 2, other lock → 1).
  var RARE = { "sk:22": 4, "ey:20": 4, "hw:43": 4, "bg:37": 4, "fr:5": 4, "fr:10": 4, "hw:41": 3, "fh:13": 3, "up:28": 3, "gl:29": 3, "mt:21": 3, "nk:12": 3, "hi:15": 3, "fr:6": 3, "er:8": 3 };
  // Could become Premium-only later (owner's idea). NOT locked now: everyone can use them.
  var PREMIUM_LATER = { "hx": 1, "ux": 1, "bx": 1, "h2": 1, "bg:16": 1, "bg:23": 1, "bg:35": 1, "bg:37": 1, "fr:7": 1, "fr:8": 1, "hi:5": 1, "hi:9": 1, "gl:28": 1, "gl:29": 1,
    "hw:39": 1, "hw:23": 1, "up:14": 1, "up:20": 1, "er:8": 1, "fp:10": 1 };
  var SEASON = {}; SEASON[HALLO] = "🎃"; SEASON[JUL] = "🎄"; SEASON[MIDS] = "🌼"; SEASON[VALB] = "🔥"; SEASON[NYAR] = "🎆";
  SEASON["12-01:12-20"] = "🕯️"; SEASON["05-20:06-20"] = "🎓"; SEASON["11-15:03-15"] = "❄️";
  var HIDDEN_MEDALS = { het: 1, medevac: 1 };
  /* avt01 fit START */
  /* ---------- v4 fit + catalog clean-up (avt 2026-11-08; owner: "a billion skin colours — do we need that many?",
     "is each item unique enough?", "hair must never stick out through a hat"). Research: Unicode emoji use 5 Fitzpatrick-based
     tones + yellow, Mii 6 → 10, Google's Monk Skin Tone scale 10. So: 10 real skin tones, evenly spaced in CIE Lab (min ΔE 8.4,
     light → deep, warm + golden undertones), plus the 6 fun reward tones. Hair colours: 12 natural + 7 fun.
     - RETIRED = items that looked the same as another item in the pixel audit (pair diff at 40 / 120 px). They are hidden in
       the editor and drawn as the kept item. A saved spec keeps its number (the server list is unchanged); the next save
       writes the kept number. Every target is free or has the same lock, so a save never fails with "locked".
     - ORDER = display order (skin light → deep, natural hair colours first).
     - Hats: every hat has a fit type. Cover hats (HCLIP) cut ALL hair (back, mid, front) at the brim line, band hats
       (crowns, wreaths, ears, horns, headset, halo) cut hair at HAIRTOP, and tall parts (bun, mohawk crest, space buns) are
       dropped under any hat ("hat hair"). The balaclava hides hair, ears, earrings and beard. Checked for every hair × hat ×
       face shape by avt-tools/clip.js (hair pixels above the line = 0, bald band under the brim = 0).
     - nl (neckwear layer): 0 = Utanpå (over the top, default), 1 = Instoppad (under the top, only the neck part shows). Only for
       NKL items. Needs SQL 0397 (olnu_avatar_max nl:1); an old server says invalid_avatar → saved without nl. */
  var RETIRED = {
    sk: { 0: 9, 1: 10, 2: 11, 5: 15, 6: 16, 12: 3, 14: 4 },
    hc: { 13: 2, 15: 0, 20: 6 },
    hr: { 11: 2, 25: 6, 33: 22 },
    br: { 10: 1 },
    fh: { 15: 4 },
    gl: { 17: 12 }
  };
  var ORDER = {
    sk: [8, 9, 10, 11, 3, 13, 4, 15, 16, 17, 7, 18, 19, 20, 21, 22],
    hc: [0, 1, 2, 12, 4, 11, 3, 9, 10, 5, 14, 6, 7, 8, 16, 17, 18, 19, 21],
    hr: [0, 1, 2, 19, 21, 3, 32, 4, 27, 9, 28, 29, 10, 12, 23, 22, 13, 5, 14, 7, 20, 15, 30, 17, 16, 26, 6, 18, 8, 24, 31]
  };
  var NKL = { 1: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 12: 1, 15: 1 };   // neckwear that can go under the top
  var HAIRTOP = 15;
  function isRetired(k, i) { return !!(RETIRED[k] && RETIRED[k][i] != null); }
  function visible(k) {
    var out = [], seen = {}, max = MAX[k];
    (ORDER[k] || []).forEach(function (i) { if (i <= max && !seen[i] && !isRetired(k, i)) { seen[i] = 1; out.push(i); } });
    for (var i = 0; i <= max; i++) if (!seen[i] && !isRetired(k, i)) out.push(i);
    return out;
  }
  function migrate(s) {   // in place: retired item → the kept item (also h2 = hair colour index + 1)
    if (!s) return s;
    Object.keys(RETIRED).forEach(function (k) { var v = s[k]; if (typeof v === "number" && RETIRED[k][v] != null) s[k] = RETIRED[k][v]; });
    if (s.h2 && RETIRED.hc[(s.h2 | 0) - 1] != null) s.h2 = RETIRED.hc[(s.h2 | 0) - 1] + 1;
    if (s.nl && !NKL[s.nk | 0]) delete s.nl;
    return s;
  }
  function labOf(hex) {
    var n = parseInt(String(hex).slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(function (x) { x /= 255; return x > 0.04045 ? Math.pow((x + 0.055) / 1.055, 2.4) : x / 12.92; });
    var X = (c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 0.95047, Y = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722, Z = (c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 1.08883;
    var f = function (t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; };
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  }
  function colDist(a, b) { var x = labOf(a), y = labOf(b); return Math.sqrt(Math.pow(x[0] - y[0], 2) + Math.pow(x[1] - y[1], 2) + Math.pow(x[2] - y[2], 2)); }
  // the background colour around the shoulders (for top / background contrast)
  var BGMAIN = ["#f5a623", "#1fa45c", "#2f6fb8", "#c8202a", "#6b2d8f", "#1d8a8a", "#34497f", "#d9578f", "#5b6338", "#ff7a1a", "#0b1638", "#f5c542", "#8fc4f5", "#ff9a5a", "#7fd6b8", "#2b2f36",
    "", "", "", "#f7f3ea", "", "#2f6fb8", "#5cae4e", "#1b2a44", "#161d3e", "#4a2a18", "#2c5a3a", "#3f86c6", "#fbfdff", "#ff7a1a", "#4a1f5a", "#174f38", "#1d2550", "#2f7ac0", "#1d2550", "#2a0f4a", "#efe6d2", "#1a0f3a", "#e8a020"];
  function bgMain(s) { var x = hexOf(s.bx); return BGMAIN[s.bg | 0] || x || ({ 16: "#f5a623", 17: "#2f6fb8", 18: "#c8202a", 20: "#c8202a" })[s.bg | 0] || "#f5a623"; }
  function contrastOk(s) { var t = topMain(migrate(JSON.parse(JSON.stringify(s)))); return !t || colDist(t, bgMain(s)) >= 24; }
  /* "Slumpa" that makes nice looks (owner: "nice combos, not random clashes"): natural colours most of the time, calm faces,
     few extras at once, the top always stands out from the background, beard and brows follow the hair colour. only = one slot
     (the wizard step) or null = everything not kept. keepK = slots the 🎲 must not change. */
  var CALM = { ey: [0, 1, 2, 5, 7, 8, 9, 10, 3], mt: [0, 1, 2, 3, 4, 7, 8, 13], br: [1, 2, 4, 5, 6, 12, 14], ns: [0, 1, 2, 3, 4, 5, 6, 7, 8] };
  var EXTRA_P = { fh: 0.4, hw: 0.35, gl: 0.3, nk: 0.22, er: 0.2, fm: 0.15, fp: 0.06, hi: 0.35, fr: 0.25, ck: 0.5 };
  var REAL_SK = [8, 9, 10, 11, 3, 13, 4, 15, 16, 17], NAT_HC = [0, 1, 2, 12, 4, 11, 3, 9, 10, 5, 14, 6];
  function nice(draft, f, only, keepK) {
    var RR = Math.random, d = draft;
    function can(k, i) { return usable(k, i, f) && !isRetired(k, i); }
    function pick(k, pool) { var ok = (pool || visible(k)).filter(function (i) { return i <= MAX[k] && can(k, i); }); return ok.length ? ok[Math.floor(RR() * ok.length)] : (d[k] | 0); }
    function want(k) { return (!only || only === k) && !(keepK && keepK[k]); }
    if (want("sk")) d.sk = RR() < 0.9 ? pick("sk", REAL_SK) : pick("sk");
    if (want("fs")) d.fs = pick("fs");
    if (want("hr")) d.hr = pick("hr");
    if (want("hc") || only === "hr") { d.hc = RR() < 0.85 ? pick("hc", NAT_HC) : pick("hc"); delete d.hx; if (!only && RR() < 0.1) { d.h2 = 1 + pick("hc", [7, 8, 16, 17, 18, 19, 21]); d.ht = Math.floor(RR() * 4); } else if (!only) { delete d.h2; delete d.ht; } }
    ["ey", "mt", "br", "ns"].forEach(function (k) { if (want(k)) d[k] = RR() < 0.85 ? pick(k, CALM[k]) : pick(k); });
    if (want("ec")) d.ec = RR() < 0.5 ? 0 : pick("ec", [1, 2, 3, 4, 5, 6, 7]);
    Object.keys(EXTRA_P).forEach(function (k) { if (want(k)) d[k] = RR() < (only === k ? 0.85 : EXTRA_P[k]) ? pick(k, visible(k).filter(function (i) { return i > 0 || k === "ck"; })) : (k === "ck" ? 0 : 0); });
    if (!only && d.hw && d.gl && RR() < 0.6) d.gl = 0;   // not everything at once
    if (want("up")) d.up = pick("up");
    if (want("uc") || only === "up") { d.uc = pick("uc"); delete d.ux; }
    if (want("bg")) { d.bg = pick("bg"); delete d.bx; }
    // the top must stand out from the background: change what the user did not just pick
    for (var n = 0; n < 24 && (!only || only === "up" || only === "uc" || only === "bg") && !contrastOk(d); n++) {
      var byBg = only === "bg" || (keepK && keepK.uc) || (n >= 4 && only !== "uc" && only !== "up");   // a fixed-colour top: change the background
      if (byBg) { if (keepK && keepK.bg) break; d.bg = pick("bg"); delete d.bx; } else { d.uc = pick("uc"); delete d.ux; }
    }
    if (d.gl === 6) d.hw = 0;
    migrate(d);
    return d;
  }
  /* avt01 fit END */

  /* ---------- Small helpers ---------- */
  function shade(hex, f) {   // f < 0 darker, f > 0 lighter
    var n = parseInt(String(hex).slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    function c(x) { return Math.max(0, Math.min(255, Math.round(f < 0 ? x * (1 + f) : x + (255 - x) * f))); }
    return "#" + ((1 << 24) | (c(r) << 16) | (c(g) << 8) | c(b)).toString(16).slice(1);
  }
  function mix(a, b, t) { var x = parseInt(String(a).slice(1), 16), y = parseInt(String(b).slice(1), 16); function c(sh) { return Math.round(((x >> sh) & 255) * (1 - t) + ((y >> sh) & 255) * t); } return "#" + ((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1); }
  function lum(hex) { var n = parseInt(String(hex).slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }
  function hexOf(v) { v = (v | 0) - 1; return v < 0 ? null : "#" + (0x1000000 | v).toString(16).slice(1); }
  function valOf(hex) { return parseInt(String(hex).slice(1), 16) + 1; }
  function P(d, fill, x) { return '<path d="' + d + '" fill="' + fill + '"' + (x || "") + "/>"; }
  function S(d, col, w, x) { return '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round"' + (x || "") + "/>"; }
  function C(cx, cy, r, fill, x) { return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fill + '"' + (x || "") + "/>"; }
  function E(cx, cy, rx, ry, fill, x) { return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '"' + (x || "") + "/>"; }
  function R(x, y, w, h, rx, fill, ex) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"' + (rx ? ' rx="' + rx + '"' : "") + ' fill="' + fill + '"' + (ex || "") + "/>"; }
  function f2(n) { return Math.round(n * 100) / 100; }
  function dC(cx, cy, r) { return "M" + f2(cx - r) + "," + f2(cy) + "a" + r + "," + r + " 0 1,0 " + f2(2 * r) + ",0a" + r + "," + r + " 0 1,0 " + f2(-2 * r) + ",0Z"; }
  function dE(cx, cy, rx, ry) { return "M" + f2(cx - rx) + "," + f2(cy) + "a" + rx + "," + ry + " 0 1,0 " + f2(2 * rx) + ",0a" + rx + "," + ry + " 0 1,0 " + f2(-2 * rx) + ",0Z"; }
  function dR(x, y, w, h, r) { r = Math.min(r || 0, w / 2, h / 2); return "M" + f2(x + r) + "," + y + "H" + f2(x + w - r) + "A" + r + "," + r + " 0 0 1 " + f2(x + w) + "," + f2(y + r) + "V" + f2(y + h - r) + "A" + r + "," + r + " 0 0 1 " + f2(x + w - r) + "," + f2(y + h) + "H" + f2(x + r) + "A" + r + "," + r + " 0 0 1 " + x + "," + f2(y + h - r) + "V" + f2(y + r) + "A" + r + "," + r + " 0 0 1 " + f2(x + r) + "," + y + "Z"; }
  function mir(d) {   // mirror a path with absolute commands only (M L C Q H V Z, no arcs) around x = 50
    return d.replace(/([MLCQTSHV])([^MLCQTSHVZ]*)/g, function (all, cmd, args) {
      if (cmd === "V") return all;
      var nums = args.match(/-?\d*\.?\d+/g) || [];
      if (cmd === "H") return "H" + nums.map(function (x) { return f2(100 - x); }).join(" ");
      var out = [];
      for (var i = 0; i < nums.length; i += 2) out.push(f2(100 - nums[i]) + "," + nums[i + 1]);
      return cmd + out.join(" ");
    });
  }
  function star(cx, cy, r, ri) {
    var d = "";
    for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * (ri || 0.45) : r; d += (i ? "L" : "M") + (cx + rr * Math.cos(a)).toFixed(2) + "," + (cy + rr * Math.sin(a)).toFixed(2); }
    return d + "Z";
  }
  function heart(cx, cy, s) { return "M" + cx + "," + f2(cy + s * 0.9) + "C" + f2(cx - s * 1.6) + "," + f2(cy - s * 0.1) + " " + f2(cx - s * 0.9) + "," + f2(cy - s * 1.25) + " " + cx + "," + f2(cy - s * 0.45) + "C" + f2(cx + s * 0.9) + "," + f2(cy - s * 1.25) + " " + f2(cx + s * 1.6) + "," + f2(cy - s * 0.1) + " " + cx + "," + f2(cy + s * 0.9) + "Z"; }
  function hashStr(s) { var h = 2166136261; s = String(s || ""); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { var a = hashStr(seed) || 1; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function clamp(spec, k) { var v = spec && spec[k]; v = typeof v === "number" ? v | 0 : 0; return v < 0 || v > MAX[k] ? 0 : v; }

  /* ---------- Default character (deterministic per seed; only free items) ---------- */
  function defaultSpec(seed, rank) {
    var R1 = rng("av:" + (seed || "x")), pick = function (n) { return Math.floor(R1() * n); };
    // v1 stream: exactly as v1 (same look for everyone without a saved spec)
    var s = { v: 1, sk: pick(7), fs: pick(3), ey: pick(6), br: 1 + pick(4), mt: pick(6), hr: pick(9), hc: pick(7),
      fh: 0, hw: 0, gl: 0, up: pick(3), uc: pick(8), bg: pick(8), ms: 1 };
    if (R1() < 0.42) s.fh = 1 + pick(6);
    if (R1() < 0.3) s.hw = [1, 2, 3, 4][pick(4)];
    if (R1() < 0.2) s.gl = [1, 2, 3][pick(3)];
    rank = rank | 0;
    if (rank >= 12 && R1() < 0.6) s.up = 5; else if (rank >= 4 && R1() < 0.5) s.up = 4;
    // v2 stream: small extra details (free items only)
    var R2 = rng("av2:" + (seed || "x")), p2 = function (n) { return Math.floor(R2() * n); };
    if (R2() < 0.5) s.ns = 1 + p2(8);
    if ((s.ey === 0 || s.ey === 2) && R2() < 0.5) s.ec = 1 + p2(7);
    if (R2() < 0.2) s.fm = [1, 1, 2, 3, 10][p2(5)];
    if (R2() < 0.15) s.er = 1 + p2(3);
    if (R2() < 0.12) s.ck = [2, 4][p2(2)];
    if (R2() < 0.1) s.nk = [1, 4][p2(2)];
    for (var cb = 0; cb < 8 && !contrastOk(s); cb++) s.bg = (s.bg + 3) % 8;   // avt01
    return s;
  }

  /* ---------- Render context (set by svg(); one SVG at a time) ---------- */
  var ID = "__ID__", CN = 0, LITE = false, SWK = 1;
  function nid() { return ID + "q" + (++CN); }
  function fw(w) { return f2(w * SWK); }   // face line width (thicker when small)
  /* One soft highlight rim (top left) + one shadow tone (bottom right) for any shape d. fill can be a colour or an url();
     then o.s / o.h give the shadow / highlight fills. */
  function cel(d, fill, o) {
    o = o || {};
    if (LITE) return P(d, fill, o.x);
    var s = o.s || shade(fill, -(o.k || 0.17)), h = o.h || shade(fill, o.hk || 0.16);
    var w = o.w || [1.8, 1.4], v = o.v || [0.9, 0.9], n = nid();
    return '<clipPath id="' + n + '"><path d="' + d + '"/></clipPath><g' + (o.x || "") + ">" + P(d, s) + '<g clip-path="url(#' + n + ')">' +
      (o.h === false ? "" : P(d, h, ' transform="translate(' + -w[0] + " " + -w[1] + ')"')) +
      '<g transform="translate(' + v[0] + " " + v[1] + ')" clip-path="url(#' + n + ')">' + P(d, fill, ' transform="translate(' + f2(-w[0] - v[0]) + " " + f2(-w[1] - v[1]) + ')"') + "</g></g></g>";
  }
  function grad(id, x1, y1, x2, y2, stops) {   // userSpace linear gradient
    return '<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '">' +
      stops.map(function (s) { return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] != null ? ' stop-opacity="' + s[2] + '"' : "") + "/>"; }).join("") + "</linearGradient>";
  }
  function rgrad(id, cx, cy, r, stops) {
    return '<radialGradient id="' + id + '" gradientUnits="userSpaceOnUse" cx="' + cx + '" cy="' + cy + '" r="' + r + '">' +
      stops.map(function (s) { return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] != null ? ' stop-opacity="' + s[2] + '"' : "") + "/>"; }).join("") + "</radialGradient>";
  }

  /* ---------- Head shapes ---------- */
  var HEAD = [
    dC(50, 45.5, 20.5),
    dE(50, 45, 18.5, 22),
    dR(30, 24.5, 40, 42, 11),
    "M50,66.8 C43.5,66.8 32.5,59.5 30.2,48.5 C28.4,34 37.5,24.6 50,24.6 C62.5,24.6 71.6,34 69.8,48.5 C67.5,59.5 56.5,66.8 50,66.8Z",
    dE(50, 46, 17.6, 23.4),
    dE(50, 46.4, 22.4, 20.2),
    "M50,24.6 C59.5,24.6 66.2,30 68.8,38.5 L70.6,46.5 C70.4,55.5 61.5,65.6 50,67.2 C38.5,65.6 29.6,55.5 29.4,46.5 L31.2,38.5 C33.8,30 40.5,24.6 50,24.6Z",
    "M50,24.6 C61,24.6 67.6,31 68.6,41.5 C70.8,51 68.6,61 58.4,65.4 C53.4,67 46.6,67 41.6,65.4 C31.4,61 29.2,51 31.4,41.5 C32.4,31 39,24.6 50,24.6Z"
  ];
  var EARX = [29.6, 31.8, 30, 30.4, 32.6, 27.8, 29.6, 31.2];
  // hair / hat / beard follow the head: [scale x, scale y, centre y] (null = as drawn). v1 oval = scale(.93 1.05) around y 45.
  var HAIRT = [null, [0.93, 1.05, 45], null, null, [0.88, 1.07, 46], [1.09, 0.98, 46], null, [0.98, 1, 46]];
  var JAWT = [null, null, null, [0.9, 1, 50], [0.86, 1.07, 50], [1.1, 0.97, 50], [0.95, 1.01, 50], [1.04, 1, 50]];
  function tf(t) { return t ? ' transform="translate(50 ' + t[2] + ") scale(" + t[0] + " " + t[1] + ") translate(-50 -" + t[2] + ')"' : ""; }

  /* ---------- Eyes (x 42 / 58, y 46). ec = iris colour (0 = the v1 near-black). ---------- */
  var INK = "#1a1410";
  function eyesSVG(e, ec, skin) {
    var d = INK, ic = EYEC[ec] || INK, col = ec ? ic : d;
    function both(fn) { return fn(42, -1) + fn(58, 1); }
    function iris(x, y, r, dx, dy) {   // coloured iris + pupil + catchlight
      dx = dx || 0; dy = dy || 0;
      if (!ec) return (lum(skin) < 0.3 ? C(f2(x + dx), f2(y + dy), f2(r + 0.8), mix(skin, "#fbfaf7", 0.6)) : "") + C(f2(x + dx), f2(y + dy), r, d) + C(f2(x + dx + r * 0.36), f2(y + dy - r * 0.36), f2(r * 0.3), "#fff");
      return C(f2(x + dx), f2(y + dy), r, ic) + C(f2(x + dx), f2(y + dy), f2(r * 0.52), shade(ic, -0.7)) + C(f2(x + dx + r * 0.38), f2(y + dy - r * 0.38), f2(r * 0.3), "#fff");
    }
    function almond(x, y, w, h, r, dx, dy, lid) {   // white almond, clipped iris, top lash line; lid = how far the lid comes down (0..1)
      var n = nid(), top = f2(y - h * 2.2), bot = f2(y + h * 1.8), sh = "M" + f2(x - w) + "," + y + " Q" + x + "," + top + " " + f2(x + w) + "," + y + " Q" + x + "," + bot + " " + f2(x - w) + "," + y + "Z";
      var ly = lid ? f2(y - h * 1.1 + h * 2 * lid) : 0;
      return '<clipPath id="' + n + '"><path d="' + sh + '"/></clipPath>' + P(sh, "#fbfaf7") + '<g clip-path="url(#' + n + ')">' + iris(x, y + 0.2, r, dx, dy) +
        (lid ? P("M" + (x - w - 1) + "," + (y - h * 3) + " L" + (x + w + 1) + "," + (y - h * 3) + " L" + (x + w + 1) + "," + ly + " L" + (x - w - 1) + "," + ly + "Z", skin) : "") + "</g>" +
        (lid ? S("M" + f2(x - w - 0.3) + "," + f2(Math.min(ly, y)) + " L" + f2(x + w + 0.3) + "," + f2(Math.min(ly, y)), INK, fw(1.3)) : S("M" + f2(x - w - 0.3) + "," + f2(y + 0.2) + " Q" + x + "," + f2(y - h * 2.3) + " " + f2(x + w + 0.3) + "," + f2(y - 0.2), INK, fw(1.4)));
    }
    switch (e) {
      case 1: return both(function (x) { return S("M" + (x - 3) + ",47 Q" + x + ",43 " + (x + 3) + ",47", d, fw(1.8)); });
      case 2: return both(function (x) { return C(x, 46, 3.6, "#fff") + (ec ? C(x + 0.4, 46.4, 2.2, ic) + C(x + 0.4, 46.4, 1.1, shade(ic, -0.7)) : C(x + 0.4, 46.4, 1.9, d)) + C(x + 1.1, 45.6, 0.6, "#fff"); });
      case 3: return both(function (x) { return P("M" + (x - 3.3) + ",45.6 Q" + x + ",49.8 " + (x + 3.3) + ",45.6Z", d) + S("M" + (x - 3.6) + ",45.6 L" + (x + 3.6) + ",45.6", d, fw(1.2)); });
      case 4: return iris(42, 46, 2.3) + S("M55,46.5 Q58,43.5 61,46.5", d, fw(1.8));
      case 5: return both(function (x) { return E(x, 46.4, 2.6, 1.9, col) + (ec ? C(x, 46.4, 0.9, shade(ic, -0.7)) : ""); }) + S("M38.6,43.4 L45,44.6 M61.4,43.4 L55,44.6", d, fw(1.3));
      case 6: return both(function (x) { return P(star(x, 46, 3.6), "#ffc24d", ' stroke="#8a5a00" stroke-width=".5"'); });
      case 7: return both(function (x, sd) { return almond(x, 46.4, 3.6, 2.2, 2.1, 0.2, 0) + S("M" + f2(x + 3.5 * sd) + ",46.2 L" + f2(x + 4.5 * sd) + ",45.3", d, fw(1.1)); });
      case 8: return both(function (x) { return C(x, 46, 3.3, "#fbfaf7") + iris(x, 46.3, 2.1) + S("M" + (x - 3.4) + ",45.4 Q" + x + ",42 " + (x + 3.4) + ",45.4", d, fw(1.3)); });
      case 9: return both(function (x, sd) { return almond(x, 46.4, 3.4, 2.2, 2.1, 0, 0) + S("M" + f2(x + 3.1 * sd) + ",44.8 L" + f2(x + 4.6 * sd) + ",43.6 M" + f2(x + 3.6 * sd) + ",46 L" + f2(x + 5.1 * sd) + ",45.4", d, fw(1)); });
      case 10: return both(function (x) { return E(x, 45.8, 3.1, 3.7, "#fbfaf7") + iris(x, 46.4, 2.4, 0.2, 0) + C(x - 1, 47.6, 0.5, "#fff") + S("M" + (x - 3.2) + ",44.6 Q" + x + ",41.2 " + (x + 3.2) + ",44.6", d, fw(1.4)); });
      case 11: return S("M39.2,43.8 L44.4,46.2 L39.2,48.6 M60.8,43.8 L55.6,46.2 L60.8,48.6", d, fw(1.8));
      case 12: return both(function (x) { return P(heart(x, 46.4, 3.2), "#e8384f") + C(x - 1.2, 45.3, 0.55, "#fff", ' opacity=".8"'); });
      case 13: return both(function (x) { return almond(x, 46.4, 3.4, 2.2, 2.1, 0, 0.5, 0.48) + S("M" + (x - 2.6) + ",49.6 Q" + x + ",51 " + (x + 2.6) + ",49.6", shade(skin, -0.28), fw(0.9)); });
      case 14: return both(function (x) { return C(x, 46, 3.2, "#fbfaf7") + iris(x, 46, 1.8, 0, -1.6) + S("M" + (x - 3.3) + ",45.6 Q" + x + ",42.4 " + (x + 3.3) + ",45.6", d, fw(1.2)); });
      case 15: return both(function (x) { return almond(x, 46.6, 3.6, 2.1, 2.1, 1.6, 0.3, 0.3); });
      case 16: return both(function (x, sd) { return S("M" + (x - 3) + ",47 Q" + x + ",43 " + (x + 3) + ",47", d, fw(1.8)) + P("M" + f2(x + 2.6 * sd) + ",48 C" + f2(x + 3.8 * sd) + ",50 " + f2(x + 4.2 * sd) + ",51.4 " + f2(x + 3 * sd) + ",52.2 C" + f2(x + 1.8 * sd) + ",51.6 " + f2(x + 2 * sd) + ",50 " + f2(x + 2.6 * sd) + ",48Z", "#6fc3ff"); });
      case 17: return both(function (x) { return S("M" + x + ",46 m-.6,0 a.6,.6 0 1,1 1.2,0 a1.4,1.4 0 1,1 -2.6,.2 a2.2,2.2 0 1,1 4.2,-.4 a3,3 0 1,1 -5.6,.6", d, fw(1.1)); });
      case 18: return S("M39.4,43.4 L44.6,48.6 M44.6,43.4 L39.4,48.6 M55.4,43.4 L60.6,48.6 M60.6,43.4 L55.4,48.6", d, fw(1.8));
      case 19: return both(function (x) { return E(x, 45.8, 3.2, 3.8, "#fbfaf7") + C(x, 46.4, 2.6, ec ? ic : "#5b3fb0") + C(x, 46.8, 1.3, "#1a1030") + C(x + 1, 45.2, 0.9, "#fff") + C(x - 1, 47.8, 0.45, "#fff") + P(star(x + 3.6, 42.4, 1.6, 0.3), "#fff7c2") + S("M" + (x - 3.3) + ",44.4 Q" + x + ",41 " + (x + 3.3) + ",44.4", d, fw(1.4)); });
      case 20: return both(function (x) { var n = nid(); return "<defs>" + rgrad(n, x, 46, 6, [[0, "#fff"], [0.25, "#ff3b3b"], [1, "#ff3b3b", 0]]) + "</defs>" + C(x, 46, 6, "url(#" + n + ")") + C(x, 46, 1.6, "#fff"); });
      case 21: return both(function (x) { var n = nid(), sh = "M" + (x - 3.6) + ",46.4 Q" + x + ",42 " + (x + 3.6) + ",45.6 Q" + x + ",50 " + (x - 3.6) + ",46.4Z"; return P(sh, ec ? ic : "#b8d43a") + E(x, 46.1, 0.7, 2.3, "#141414") + C(x + 1, 45, 0.5, "#fff") + S(sh, d, fw(1.1)); });
      default: return both(function (x) { return iris(x, 46, 2.3); });
    }
  }
  function browsSVG(b, col) {
    switch (b) {
      case 1: return S("M38.5,40.5 L45.5,40.5 M54.5,40.5 L61.5,40.5", col, fw(1.6));
      case 2: return S("M38.5,41 Q42,37.5 45.5,40 M54.5,40 Q58,37.5 61.5,41", col, fw(1.6));
      case 3: return S("M38.5,39 L45.5,41.5 M54.5,41.5 L61.5,39", col, fw(1.8));
      case 4: return S("M38,40.6 Q42,38 46,40.2 M54,40.2 Q58,38 62,40.6", col, fw(3));
      case 5: return S("M38.4,41 Q41.8,37.6 45.6,39.6 M54.4,39.6 Q58.2,37.6 61.6,41", col, fw(1.1));
      case 6: return P(dR(38, 38.9, 8, 2.8, 1.4), col) + P(dR(54, 38.9, 8, 2.8, 1.4), col);
      case 7: return S("M38.6,41.4 L45.4,39 M54.6,39 L61.4,41.4", col, fw(1.7));
      case 8: return S("M38.5,40.6 L45.5,40.4 M54.4,39.8 Q57.6,35.4 61.6,38.6", col, fw(1.7));
      case 9: return S("M38,40.8 Q42,38.4 46,40 Q50,41.2 54,40 Q58,38.4 62,40.8", col, fw(2));
      case 10: return S("M38.5,40.5 L41,40.5 M43.4,40.5 L45.5,40.5 M54.5,40.5 L61.5,40.5", col, fw(1.7));
      case 11: return E(41.8, 39.8, 1.9, 1.2, col) + E(58.2, 39.8, 1.9, 1.2, col);
      case 12: return P("M38.2,41.4 Q41.6,37.4 46,39.8 Q41.8,38.9 38.2,41.4Z", col, ' stroke="' + col + '" stroke-width="' + fw(0.9) + '" stroke-linejoin="round"') + P(mir("M38.2,41.4 Q41.6,37.4 46,39.8 Q41.8,38.9 38.2,41.4Z"), col, ' stroke="' + col + '" stroke-width="' + fw(0.9) + '" stroke-linejoin="round"');
      case 13: return S("M38.5,40.6 Q42.6,40.8 45.6,38.4 M54.4,38.4 Q57.4,40.8 61.5,40.6", col, fw(1.6));
      case 14: return P("M37.8,41.2 L44.2,38.4 L46.2,40.2 L44,39.8Z", col, ' stroke="' + col + '" stroke-width="' + fw(0.8) + '" stroke-linejoin="round"') + P(mir("M37.8,41.2 L44.2,38.4 L46.2,40.2 L44,39.8Z"), col, ' stroke="' + col + '" stroke-width="' + fw(0.8) + '" stroke-linejoin="round"');
      default: return "";
    }
  }
  function noseSVG(n, skin) {
    var sh = shade(skin, -0.16), dk = shade(skin, -0.3);
    switch (n) {
      case 1: return E(50, 51.8, 1.5, 1.05, dk, ' opacity=".55"');
      case 2: return S("M47.6,51.8 Q50,55 52.4,51.8", sh, fw(1.4)) + C(48.6, 52.6, 0.5, dk, ' opacity=".6"') + C(51.4, 52.6, 0.5, dk, ' opacity=".6"');
      case 3: return S("M50.6,46.4 L48.4,52.4 L51.2,52.8", sh, fw(1.3));
      case 4: return S("M47.2,51.8 Q47.8,53.6 50,53.4 Q52.2,53.6 52.8,51.8", sh, fw(1.3)) + C(48.6, 52.6, 0.45, dk, ' opacity=".5"') + C(51.4, 52.6, 0.45, dk, ' opacity=".5"');
      case 5: return S("M48.8,45.4 C51.6,48.4 51.8,50.8 51.2,52.6 Q50,53.6 48.4,52.8", sh, fw(1.3));
      case 6: return S("M48,52.8 Q50,51 52,52.8", sh, fw(1.2)) + C(48.9, 53.4, 0.45, dk, ' opacity=".6"') + C(51.1, 53.4, 0.45, dk, ' opacity=".6"');
      case 7: return S("M50,44.6 L50.2,52.4 Q50.4,53.6 51.8,53", sh, fw(1.2));
      case 8: return C(50, 51.8, 2.3, shade(skin, -0.07)) + C(49.2, 51, 0.7, shade(skin, 0.3), ' opacity=".7"');
      case 9: return cel(dC(50, 52, 3.4), "#e8263a", { w: [0.9, 0.7], v: [0.6, 0.6], hk: 0.35 }) + C(48.8, 50.8, 0.9, "#fff", ' opacity=".75"');
      case 10: var g = nid(); return "<defs>" + rgrad(g, 50, 52, 7, [[0, "#ff5a5a", 0.55], [1, "#ff5a5a", 0]]) + "</defs>" + C(50, 52, 7, "url(#" + g + ")") + C(50, 52, 3, "#e8202a") + C(49, 51, 0.9, "#fff", ' opacity=".8"');
      case 11: return P("M48.6,50.4 Q50,53.4 51.6,50.4", sh, ' stroke="' + sh + '" stroke-width=".6"') + '<circle cx="52.4" cy="53.1" r="1.25" fill="none" stroke="#d6a93a" stroke-width=".7"/>';
      default: return P("M48.6,50.4 Q50,53.4 51.6,50.4", sh, ' stroke="' + sh + '" stroke-width=".6"');
    }
  }
  function mouthSVG(m, skin) {
    var d = "#5a1f1a", tg = "#e66a7a", w = fw(1.7);
    switch (m) {
      case 1: return P("M43,55 Q50,62.5 57,55Z", d) + P("M44.4,55.4 L55.6,55.4 L55,57 L45,57Z", "#fff");
      case 2: return P("M42.5,54 Q50,67 57.5,54Z", d) + P("M46,60.5 Q50,57.5 54,60.5 Q50,63.5 46,60.5Z", tg);
      case 3: return S("M45,57 L55,57", d, w);
      case 4: return S("M45,57.5 Q52,59.5 56,54.5", d, w);
      case 5: return E(50, 57.5, 2.6, 3.1, d);
      case 6: return S("M44,56 Q50,60.5 56,56", d, w) + P("M47.4,57.6 L52.6,57.6 L52.6,61 Q50,63.6 47.4,61Z", tg);
      case 7: return P("M42,54.6 Q50,64.6 58,54.6Z", d) + P("M42.8,54.9 L57.2,54.9 Q56.4,57.8 50,58 Q43.6,57.8 42.8,54.9Z", "#fff") + S("M46.5,55.2 L46.6,57.4 M50,55.2 L50,58 M53.5,55.2 L53.4,57.4", "#e3ddd5", 0.5);
      case 8: var lc = mix(shade(skin, -0.2), "#c0505a", 0.5); return P("M43.6,56 Q46.6,53.8 50,55 Q53.4,53.8 56.4,56 Q50,57 43.6,56Z", lc) + P("M43.6,56 Q50,57 56.4,56 Q53.6,60.2 50,60.2 Q46.4,60.2 43.6,56Z", shade(lc, 0.12)) + S("M44.2,56.2 Q50,57.2 55.8,56.2", shade(lc, -0.35), 0.7) + E(51.6, 58.2, 1.4, 0.6, "#fff", ' opacity=".35"');
      case 9: return P("M43.6,56 Q46.6,53.6 50,54.9 Q53.4,53.6 56.4,56 Q50,57 43.6,56Z", "#c8202a") + P("M43.6,56 Q50,57 56.4,56 Q53.6,60.4 50,60.4 Q46.4,60.4 43.6,56Z", "#dc2f3c") + S("M44.2,56.2 Q50,57.2 55.8,56.2", "#7a0f16", 0.7) + E(51.8, 58.3, 1.5, 0.6, "#fff", ' opacity=".45"');
      case 10: return S("M45,58.6 Q50,54.6 55,58.6", d, w);
      case 11: return E(50.6, 57, 2.3, 2.1, "#c2475a") + E(50.6, 57, 0.9, 0.8, "#6a1a26") + E(51.4, 56, 0.8, 0.45, "#fff", ' opacity=".4"');
      case 12: return E(51.4, 57.2, 1.6, 1.9, "#c2475a") + E(51.4, 57.2, 0.7, 0.9, d) + S("M61.4,57.4 L61.4,54 L63.6,53.4 L63.6,56.6", "#3b2b1f", 0.6) + C(60.8, 57.5, 0.8, "#3b2b1f") + C(63, 56.7, 0.8, "#3b2b1f");
      case 13: return S("M44,56 Q50,60.6 56,56", d, w) + P("M47.6,57.7 L49.7,58 L49.6,59.6 Q48.6,60 47.7,59.4Z", "#fff") + P("M50.3,58 L52.4,57.7 L52.3,59.4 Q51.4,60 50.4,59.6Z", "#fff");
      case 14: return P(dR(43.6, 54.8, 12.8, 5.2, 2.2), "#fbfaf7", ' stroke="' + d + '" stroke-width="' + fw(1.2) + '"') + S("M43.8,57.4 L56.2,57.4 M47,55 L47,59.8 M50,55 L50,59.8 M53,55 L53,59.8", d, 0.6);
      case 15: return P("M43,55 Q50,62.5 57,55Z", d) + P("M44.4,55.4 L49.2,55.4 L49,57.2 L45,57.2Z", "#fff") + P("M50.8,55.4 L55.6,55.4 L55,57.2 L51,57.2Z", "#fff");
      case 16: return S("M44,56 Q50,60.5 56,56", d, w) + P("M46.2,57.3 L47.8,57.9 L46.8,60.6Z", "#fff") + P("M53.8,57.3 L52.2,57.9 L53.2,60.6Z", "#fff");
      case 17: return S("M44.2,57.2 Q46.4,55.4 48.4,57 Q50.4,58.6 52.4,57 Q54.4,55.4 56,57.2", d, w);
      case 18: return P("M43,55 Q50,62.5 57,55Z", d) + P("M44.4,55.4 L55.6,55.4 L55,57 L45,57Z", "#fff") + S("M44.8,56.2 L55.2,56.2", "#9aa3ad", 0.8) + C(47, 56.2, 0.45, "#c9d0d6") + C(50, 56.2, 0.45, "#c9d0d6") + C(53, 56.2, 0.45, "#c9d0d6");
      case 19: return P("M43,55 Q50,62.5 57,55Z", d) + P("M44.4,55.4 L55.6,55.4 L55,57 L45,57Z", "#fff") + P("M51.2,55.4 L53.6,55.4 L53.5,57 L51.3,57Z", "#f5c542");
      case 20: return S("M45.6,57.4 Q48,58.6 50,57.6", d, w) + cel(dC(54.2, 56.2, 4.2), "#ff8fc4", { w: [0.9, 0.7], v: [0.6, 0.6], hk: 0.3 }) + E(52.8, 54.6, 1.1, 0.7, "#fff", ' opacity=".65"');
      case 21: return P("M41.5,53.6 Q50,69.5 58.5,53.6Z", d) + P("M42.3,53.9 L57.7,53.9 Q57,56 50,56.2 Q43,56 42.3,53.9Z", "#fff") + P("M45.2,62.2 Q50,58.2 54.8,62.2 Q50,65.8 45.2,62.2Z", tg);
      default: return S("M44,56 Q50,61 56,56", d, w);
    }
  }
  function cheeksSVG(c, skin) {
    var bl = "#ff7b73";
    switch (c) {
      case 1: return "";
      case 2: return E(39.6, 52.4, 3.8, 2.3, bl, ' opacity=".34"') + E(60.4, 52.4, 3.8, 2.3, bl, ' opacity=".34"');
      case 3: return E(39, 52.2, 4.6, 2.9, "#ff5a5a", ' opacity=".5"') + E(61, 52.2, 4.6, 2.9, "#ff5a5a", ' opacity=".5"') + S("M37,51.4 L38.4,52.8 M39.4,51 L40.8,52.4 M59.2,51 L60.6,52.4 M61.6,51.4 L63,52.8", "#fff", 0.5, ' opacity=".6"');
      case 4: return E(40, 52, 3.4, 2, bl, ' opacity=".18"') + E(60, 52, 3.4, 2, bl, ' opacity=".18"') + S("M42.6,56.8 Q42,58 42.8,58.8 M57.4,56.8 Q58,58 57.2,58.8", shade(skin, -0.25), fw(0.8));
      case 5: return C(39.4, 53, 2.4, "#e0505a", ' opacity=".8"') + C(60.6, 53, 2.4, "#e0505a", ' opacity=".8"');
      case 6: return E(39.6, 52, 4, 2.6, "#ff6b7a", ' opacity=".42"') + E(60.4, 52, 4, 2.6, "#ff6b7a", ' opacity=".42"') + C(50, 52.2, 2, "#ff6b7a", ' opacity=".4"') + C(38, 51.2, 0.5, "#fff", ' opacity=".8"') + C(62.4, 50.8, 0.45, "#fff", ' opacity=".8"');
      default: return E(40, 52, 3.4, 2, bl, ' opacity=".18"') + E(60, 52, 3.4, 2, bl, ' opacity=".18"');
    }
  }
  function marksSVG(m, skin) {
    var fk = shade(skin, -0.38), scar = shade(skin, 0.3), tat = "#2a4a7a";
    function dots(list, r) { return list.map(function (p) { return C(p[0], p[1], r, fk, ' opacity=".55"'); }).join(""); }
    switch (m) {
      case 1: return LITE ? "" : dots([[45.6, 50.2], [44, 51.6], [46.4, 52.2], [54.4, 50.2], [56, 51.6], [53.6, 52.2], [42.4, 50.6], [57.6, 50.6]], 0.42);
      case 2: return LITE ? dots([[44, 51.6], [56, 51.6]], 0.5) : dots([[45.6, 50.2], [44, 51.6], [46.4, 52.2], [54.4, 50.2], [56, 51.6], [53.6, 52.2], [42.4, 50.6], [57.6, 50.6], [40.6, 52], [59.4, 52], [41.6, 53.6], [58.4, 53.6],
        [47.6, 49.4], [52.4, 49.4], [43, 53], [57, 53], [39.4, 50.4], [60.6, 50.4], [48.4, 51], [51.6, 51]], 0.4);
      case 3: return C(57.6, 55.4, 0.8, shade(skin, -0.5));
      case 4: return S("M58.6,37.4 L60.4,43.4", scar, fw(1)) + S("M58.4,39.4 L60.4,39 M59,41.6 L61,41.2", scar, 0.5);
      case 5: return S("M60.6,48.6 L64.4,54.6", scar, fw(1.1)) + S("M60.8,50.8 L62.8,49.8 M62,52.6 L64,51.6", scar, 0.55);
      case 6: return '<g transform="rotate(-28 61 52)">' + R(56.6, 50.4, 9, 3.4, 1.2, "#f0cfa4") + R(59.8, 50.4, 2.6, 3.4, 0.4, "#e1b98a") + C(57.8, 51.4, 0.25, "#c79a6a") + C(57.8, 52.6, 0.25, "#c79a6a") + C(64.6, 51.4, 0.25, "#c79a6a") + C(64.6, 52.6, 0.25, "#c79a6a") + "</g>";
      case 7: return P(star(64.4, 49.4, 1.5), tat);
      case 8: return P(heart(62.6, 53.4, 1.2), "#c8202a", ' opacity=".9"');
      case 9: return P("M54.6,70.4 C56,69.2 57.4,69.4 58.6,70.2 C59.4,69.2 60.6,68.8 61.6,69.4 C60.6,69.8 60,70.6 59.8,71.6 C59,72.8 57.2,73 56,72.2 L54.4,73.2 L55,71.6Z", tat);
      case 10: var lc = shade(skin, -0.22); return S("M64.2,45 L66.2,44.2 M64.4,46.8 L66.4,47.2 M35.8,45 L33.8,44.2 M35.6,46.8 L33.6,47.2", lc, fw(0.7)) + S("M44.4,53.8 Q42.8,55.6 43.4,57.8 M55.6,53.8 Q57.2,55.6 56.6,57.8", lc, fw(0.8));
      case 11: var bc = "#7d5a8a"; return S("M39.2,49.6 Q42,51.2 44.8,49.6 M55.2,49.6 Q58,51.2 60.8,49.6", bc, fw(1), ' opacity=".55"') + E(42, 50.4, 3, 1.1, bc, ' opacity=".16"') + E(58, 50.4, 3, 1.1, bc, ' opacity=".16"');
      default: return "";
    }
  }
  function paintSVG(p) {
    var B = "#2f6fb8", Y = "#f5c518";
    switch (p) {
      case 1: return '<g transform="rotate(-8 39 54)">' + R(35.4, 51.8, 7.4, 4.6, 0.6, B) + R(37.4, 51.8, 1.2, 4.6, 0, Y) + R(35.4, 53.5, 7.4, 1.2, 0, Y) + "</g>";
      case 2: return S("M36.6,50.8 L38.6,55.6 M39.6,50.4 L41.6,55.2 M63.4,50.8 L61.4,55.6 M60.4,50.4 L58.4,55.2", B, 1.5) + S("M38.1,50.6 L40.1,55.4 M61.9,50.6 L59.9,55.4", Y, 1.4);
      case 3: return S("M37.4,51 L45.6,51.4 M37.8,53.4 L45,53.6 M54.4,51.4 L62.6,51 M55,53.6 L62.2,53.4", "#1c2414", 1.6, ' opacity=".85"');
      case 4: return '<g opacity=".72">' + P("M31,40 C34,36 40,37 41,40 C40,43 35,44 31,43Z", "#3f4527") + P("M58,48 C62,46 68,47 69,50 C67,54 61,54 58,52Z", "#5b6338") + P("M44,52 C47,51 51,52 51,54 C49,56 45,56 44,54Z", "#3f4527") + P("M33,50 C36,49 39,50 39,52 C37,54 34,54 33,53Z", "#7a6a42") + P("M58,36 C62,34 66,36 66,38 C63,40 60,40 58,38Z", "#7a6a42") + "</g>";
      case 5: var g = ""; [[36.6, 44, "#ffd36b"], [64, 43, "#ff8fc4"], [37.6, 50, "#8fd3ff"], [63, 50.6, "#ffd36b"], [40, 53.6, "#ff8fc4"], [60.6, 54, "#8fd3ff"], [66, 47, "#fff"], [34.4, 47.4, "#fff"]].forEach(function (q, i) { g += i % 3 ? C(q[0], q[1], 0.6, q[2]) : P(star(q[0], q[1], 1.3, 0.35), q[2]); }); return g;
      case 6: return '<g opacity=".92">' + E(42, 46.4, 4.6, 4.2, "#1a1a1a") + E(58, 46.4, 4.6, 4.2, "#1a1a1a") + P("M50,50 L48.4,53.6 L51.6,53.6Z", "#1a1a1a") + S("M43,58.4 L57,58.4", "#1a1a1a", 0.8) + S("M45,57.2 L45,59.6 M47.6,57.2 L47.6,59.6 M50.2,57.2 L50.2,59.6 M52.8,57.2 L52.8,59.6 M55.4,57.2 L55.4,59.6", "#1a1a1a", 0.6) + "</g>";
      case 7: var o = "#ff8a1f"; return S("M30.6,42 L35.6,43.4 M30.4,46 L35,46.4 M31.4,50 L35.4,49.4 M69.4,42 L64.4,43.4 M69.6,46 L65,46.4 M68.6,50 L64.6,49.4", o, 1.7);
      case 8: var fl = ""; [[37.6, 53, "#fff", "#f5c518"], [41.6, 55.4, "#6f9bff", "#fff"], [62.6, 53, "#ff8fc4", "#fff"]].forEach(function (q) { for (var a = 0; a < 5; a++) { var t = a * 1.2566; fl += C(f2(q[0] + 1.3 * Math.cos(t)), f2(q[1] + 1.3 * Math.sin(t)), 1, q[2]); } fl += C(q[0], q[1], 0.75, q[3]); }); return fl + S("M38.6,54.6 Q39.6,56 41,56", "#3c9a4e", 0.6);
      case 9: function flake(x, y, r) { return S("M" + (x - r) + "," + y + " L" + (x + r) + "," + y + " M" + f2(x - r / 2) + "," + f2(y - r * 0.86) + " L" + f2(x + r / 2) + "," + f2(y + r * 0.86) + " M" + f2(x - r / 2) + "," + f2(y + r * 0.86) + " L" + f2(x + r / 2) + "," + f2(y - r * 0.86), "#fff", 0.6); } return flake(38.6, 53, 2) + flake(42.6, 56, 1.2) + flake(62, 53.4, 1.6);
      case 10: return S("M58.6,55.6 A4,4 0 0 1 66.6,55.6", "#e8384f", 0.9) + S("M59.5,55.6 A3.1,3.1 0 0 1 65.7,55.6", "#f5a623", 0.9) + S("M60.4,55.6 A2.2,2.2 0 0 1 64.8,55.6", "#3ddc84", 0.9) + S("M61.3,55.6 A1.3,1.3 0 0 1 63.9,55.6", "#4aa3ff", 0.9);
      default: return "";
    }
  }
  function foamSVG() {   // fp 11: beer foam on the upper lip (drawn over beards)
    return P("M41.2,55.2 C40.4,52.6 43,51.2 44.6,52.4 C45.4,50.6 48.4,50.6 49.4,52 C50.6,50.4 53.6,50.6 54.4,52.4 C56.4,51.2 59.4,52.6 58.6,55.2 C57.8,56.6 56.2,56.4 55.4,55.8 C54.6,57 52.8,57 52,56 C51.2,57.2 48.8,57.2 48,56 C47.2,57 45.4,57 44.6,55.8 C43.8,56.6 41.8,56.6 41.2,55.2Z", "#fbf7ea") + E(46, 53, 1.4, 0.6, "#fff") + C(44.6, 57.8, 0.7, "#fbf7ea") + C(55.6, 57.6, 0.55, "#fbf7ea");
  }
  function earsSVG(fs, skin, er) {
    var sh = shade(skin, -0.14), x1 = EARX[fs] + (fs === 1 ? 2.2 : 0), x2 = 100 - x1;
    if (fs === 1) { x1 = 31.8; x2 = 68.2; }
    var ear = function (x, sd) {
      if (er === 10) return cel("M" + f2(x - 1.4 * sd) + ",43.4 L" + f2(x + 5 * sd) + ",36.2 C" + f2(x + 5.8 * sd) + ",44 " + f2(x + 4.2 * sd) + ",50.4 " + f2(x - 0.8 * sd) + ",51.8Z", sh, { w: [1, 0.8], v: [0.6, 0.6] }) + S("M" + f2(x + 3.4 * sd) + ",40.4 C" + f2(x + 3.6 * sd) + ",45 " + f2(x + 2.6 * sd) + ",48.4 " + f2(x + 0.4 * sd) + ",49.6", shade(skin, -0.3), 0.7);
      return cel(dC(x, 47.5, 4.2), sh, { w: sd < 0 ? [1.2, 1] : [1.6, 1.2] }) + (LITE ? "" : S("M" + f2(x - 1.4 * sd) + ",45.4 C" + f2(x - 2.4 * sd) + ",47 " + f2(x - 1.6 * sd) + ",49.6 " + f2(x - 0.2 * sd) + ",50", shade(skin, -0.32), 0.7));
    };
    return ear(x1, -1) + ear(x2, 1);
  }
  function earringsSVG(er, fs) {
    var x1 = fs === 1 ? 31.8 : EARX[fs], x2 = 100 - x1, y = 51.2, G = "#e9b93a", out = "";
    [[x1, -1], [x2, 1]].forEach(function (q) {
      var x = f2(q[0] - 0.4 * q[1]);
      switch (er) {
        case 1: out += C(x, y, 0.95, G) + C(x - 0.3, y - 0.3, 0.3, "#fff6cc"); break;
        case 2: out += '<circle cx="' + x + '" cy="' + (y + 1.4) + '" r="1.6" fill="none" stroke="' + G + '" stroke-width=".8"/>'; break;
        case 3: out += '<circle cx="' + x + '" cy="' + (y + 3.2) + '" r="3.4" fill="none" stroke="' + G + '" stroke-width="1"/>'; break;
        case 4: out += S("M" + x + "," + y + " L" + x + "," + (y + 1.6), "#d8d2c4", 0.4) + C(x, y + 2.8, 1.35, "#f6f1e6") + C(x - 0.4, y + 2.4, 0.4, "#fff"); break;
        case 5: out += S("M" + x + "," + y + " L" + x + "," + (y + 1.2), G, 0.4) + '<g transform="translate(' + f2(x - 2.4) + " " + f2(y + 1) + ') scale(.32)">' + P(DALA, "#c8202a") + "</g>"; break;
        case 6: out += S("M" + x + "," + y + " L" + x + "," + (y + 1), G, 0.4) + P("M" + x + "," + (y + 1) + " C" + f2(x + 1.8) + "," + (y + 3) + " " + f2(x + 1.4) + "," + (y + 7) + " " + x + "," + (y + 8) + " C" + f2(x - 1.4) + "," + (y + 7) + " " + f2(x - 1.8) + "," + (y + 3) + " " + x + "," + (y + 1) + "Z", "#3aa0a0") + S("M" + x + "," + (y + 1.5) + " L" + x + "," + (y + 8), "#f5f0e6", 0.35); break;
        case 7: out += S("M" + x + "," + y + " L" + x + "," + (y + 1), "#c9c3b5", 0.4) + C(x, y + 2.6, 1.7, "#c9a227") + C(x, y + 2.6, 1.1, "#e8c95a") + '<circle cx="' + x + '" cy="' + (y + 2.6) + '" r="1.7" fill="none" stroke="#a07e1a" stroke-width=".5" stroke-dasharray=".5 .4"/>'; break;
        case 8: out += P("M" + x + "," + (y - 1.4) + " L" + f2(x + 1.3) + "," + y + " L" + x + "," + (y + 1.6) + " L" + f2(x - 1.3) + "," + y + "Z", "#bff3ff", ' stroke="#6fd3ff" stroke-width=".3"') + C(x - 0.4, y - 0.4, 0.3, "#fff"); break;
        case 9: out += C(x, y, 1.6, "#1d1a19") + C(x, y, 0.8, shade("#1d1a19", 0.3)); break;
        case 11: out += S("M" + x + "," + y + " L" + x + "," + (y + 1), G, 0.4) + E(x, y + 2.4, 1.6, 1.3, "#f28a1a") + S("M" + x + "," + (y + 1.1) + " L" + x + "," + (y + 3.6), "#c46a10", 0.3) + R(x - 0.25, y + 0.6, 0.5, 0.7, 0, "#3c8a3a"); break;
        case 12: [0, 1, 2].forEach(function (i) { out += '<circle cx="' + f2(x + q[1] * (0.6 + i * 0.4)) + '" cy="' + f2(45 + i * 2.4) + '" r=".8" fill="none" stroke="#c9ced6" stroke-width=".45"/>'; }); out += '<circle cx="' + x + '" cy="' + (y + 1.2) + '" r="1.3" fill="none" stroke="#c9ced6" stroke-width=".55"/>'; break;
      }
    });
    return out;
  }
  // Dala horse silhouette (original, simplified), drawn in a 15 x 13 box.
  var DALA = "M0.8,5.4 L1.2,3.8 L3,2.8 L3.4,0.4 L4.6,1.6 L5.4,0.4 L6.2,2.4 L7.2,4.8 L13,4.8 C14.6,4.8 15.6,5.8 15.4,7.4 L14.8,9 L14.8,14 L10.8,14 L10.4,11.6 L8.4,11.6 L8,14 L4,14 L4,9.6 C4,8.4 4.4,7.6 5,6.8 L3,5.8 Z";

  /* ---------- Hair. Each style = {b back (behind the head + shoulders), m mid (in front of the shoulders, behind the head),
     f front (over the forehead; cut under a hat), z shaved (thin, see-through), l detail lines (dark tone)} as path data. ---------- */
  var SIDEPART = "M29,46 C27,28 38,19 51,19 C64,19 73,28 71,46 L68.5,46 C67.5,36 62,31 56,30 C48,34 38,33 32.5,36.5 C31.5,39.5 31.5,43 31.5,46Z";
  var BUZZ = "M30,44 C30,28 40,22 50,22 C60,22 70,28 70,44 C66,36 60,32.5 50,32.5 C40,32.5 34,36 30,44Z";
  var SLICK = "M29.8,44 C28.5,26 39,19 50,19 C61,19 71.5,26 70.2,44 C69,37 67,33.5 63.5,32 C58,30.5 42,30.5 36.5,32 C33,33.5 31,37 29.8,44Z";
  var MIDPART = "M29.5,46 C27.5,28 38,19 50,19 C62,19 72.5,28 70.5,46 L68.5,46 C68,38 64,33 58,31.5 C55,31 52,29 50,27 C48,29 45,31 42,31.5 C36,33 32,38 31.5,46Z";
  var LONGB = "M27,40 C27,22 38,17 50,17 C62,17 73,22 73,40 L76,76 L62,74 L62,52 L38,52 L38,74 L24,76Z";
  function circles(list) { return list.map(function (p) { return dC(p[0], p[1], p[2]); }).join(""); }
  function braid(x0, y0, x1, y1, n, r) {   // a braid = a chain of slightly turned ovals
    var d = "", l = "";
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1), x = f2(x0 + (x1 - x0) * t), y = f2(y0 + (y1 - y0) * t), rr = f2(r * (1 - t * 0.25));
      d += dE(x, y, rr, f2(rr * 1.05));
      l += "M" + f2(x - rr * 0.8) + "," + f2(y - rr * 0.2) + " Q" + x + "," + f2(y + rr * 0.5) + " " + f2(x + rr * 0.8) + "," + f2(y - rr * 0.2) + " ";
    }
    return { d: d, l: l };
  }
  function hairStyle(hr) {
    var b, f, l;
    switch (hr) {
      case 1: return { f: BUZZ, o: 0.6 };
      case 2: return { f: SIDEPART, l: "M56,30.2 C55,26 54.6,23 55,20.4" };
      case 3: return { f: SIDEPART + "M33,32 C33,14 52,8 66,16 C60,17 55,22 53,29 C46,31 39,32 33,32Z", l: "M40,22 C46,16 54,14 60,15" };
      case 4: return { f: "M29,44 L30,30 L34,32 L36,21 L41,27 L45,17 L49,25 L54,16 L57,25 L62,19 L63,28 L68,25 L68,34 L71,44 C66,35 60,31 50,31 C40,31 34,35 29,44Z" };
      case 5: return { b: LONGB, f: SIDEPART };
      case 6: return { t: dC(50, 15, 7.5), f: SIDEPART, tl: "M46,12.4 C48,10.6 52,10.6 54,12.6" };
      case 7: return { b: dC(50, 38, 25) + dC(28, 52, 7) + dC(72, 52, 7), f: circles([[33, 34, 6.2], [38, 27, 6.2], [45, 23, 6.2], [52, 22, 6.2], [59, 24, 6.2], [65, 29, 6.2], [69, 36, 6.2], [31, 41, 6.2], [70, 43, 6.2]]), l: "M40,28 C44,25 48,25 50,27 M54,25 C58,24 62,26 63,29" };
      case 8: return { b: "M66,30 C82,30 84,54 76,70 C72,60 70,46 63,40Z", f: SIDEPART, x: [68, 31, 3] };
      case 9: return { t: "M44.5,34 L46,8 L48.5,13 L50,6 L51.5,13 L54,8 L55.5,34Z", z: "M30,44 C30,30 40,24 50,24 C60,24 70,30 70,44 C66,37 60,34 50,34 C40,34 34,37 30,44Z" };
      case 10: return { b: "M31,44 L29,70 C36,76 64,76 71,70 L69,44Z", f: SIDEPART };
      case 11: return { f: "M29.5,45 C27.5,27 38,19.5 51,19.5 C63,19.5 72.5,27 70.5,44 L69,44 C68.5,37 66,33 62,31.5 C56,33.5 48,37.5 38,39.5 C35,40 33,42 31.5,45Z", l: "M60,24 C54,27 46,31 40,35 M64,27 C60,30 56,32 52,34" };
      case 12: return { b: "M27,42 C26,24 38,18 50,18 C62,18 74,24 73,42 L74,60 C74,63.5 71,64.5 67,63.5 L33,63.5 C29,64.5 26,63.5 26,60Z",
        f: "M28,46 C27,27 38,19.5 50,19.5 C62,19.5 73,27 72,46 L73.5,61 C73.5,63 71,63.8 68.5,63 L67.5,46 C67,40 65.5,37 64,36 C58,37.2 42,37.2 36,36 C34.5,37 33,40 32.5,46 L31.5,63 C29,63.8 26.5,63 26.5,61Z", l: "M40,24 C44,22 52,21.6 58,23" };
      case 13: return { b: LONGB, f: "M29,47 C27,27 38,19 50,19 C62,19 73,27 71,47 L68.5,47 C68.5,44 68,41 67,39 L33,39 C32,41 31.5,44 31.5,47Z", l: "M38,39 L38.6,34 M44,39 L44.4,33.4 M50,39 L50,33 M56,39 L55.6,33.4 M62,39 L61.4,34" };
      case 14: return { b: "M26,40 C24,20 40,15 50,15 C60,15 76,20 74,40 C78,46 74,50 77,56 C80,62 75,66 78,72 C80,77 74,80 70,78 L62,74 L62,52 L38,52 L38,74 L30,78 C26,80 20,77 22,72 C25,66 20,62 23,56 C26,50 22,46 26,40Z",
        f: circles([[32.6, 35, 6.6], [38.4, 27.4, 6.6], [45.6, 23, 6.6], [54.4, 23, 6.6], [61.6, 27.4, 6.6], [67.4, 35, 6.6], [30, 43, 5], [70, 43, 5]]), l: "M36,30 C39,28 41,28 43,30 M52,25 C55,24 58,25 59,27 M28,52 C30,55 28,58 30,61 M72,52 C70,55 72,58 70,61" };
      case 15: var ab = [dC(50, 37, 26)]; for (var ai = 0; ai < 16; ai++) { var aa = ai * Math.PI / 8; ab.push(dC(f2(50 + 25.5 * Math.cos(aa)), f2(37 + 25.5 * Math.sin(aa)), 5.2)); }
        var hb2 = [dC(50, 40, 23)]; for (var aj = 0; aj < 16; aj++) { var a2 = aj * Math.PI / 8; hb2.push(dC(f2(50 + 22.5 * Math.cos(a2)), f2(40 + 22.5 * Math.sin(a2)), 4.6)); }
        return { hat: { b: hb2.join("") }, b: ab.join(""), f: BUZZ, l: "M27,30 C28,27 30,26 31,27 M70,26 C72,26 73,28 72,30 M38,14 C40,13 42,13 43,14 M58,13 C60,13 61,14 62,15 M24,44 C24,42 26,41 27,42 M75,42 C76,43 76,45 75,46 M46,18 C47,17 49,17 50,18 M30,20 C31,19 33,19 34,20 M66,19 C67,18 69,18 70,19" };
      case 16: var b1 = braid(29.4, 50, 28.6, 88, 10, 3.6), b2 = braid(70.6, 50, 71.4, 88, 10, 3.6);
        return { f: MIDPART, m: b1.d + b2.d, ml: b1.l + b2.l, b: dC(50, 40, 22), x2: [[28.6, 91]] .concat([[71.4, 91]]) };
      case 17: var lb = dC(50, 38, 22); [22.4, 27.4, 32.4, 62.6, 67.6, 72.6].forEach(function (x, i) { lb += dR(x, 30 + (i % 3) * 2, 5, 44 - (i % 2) * 6, 2.5); });
        return { b: lb, f: "M29.5,45 C27.5,27 38,19 50,19 C62,19 72.5,27 70.5,45 L68,44 C66,36 60,32 50,32 C40,32 34,36 32,44Z" + dR(37, 27, 4.6, 11, 2.3) + dR(44.4, 26, 4.6, 10, 2.3) + dR(51.6, 26, 4.6, 10, 2.3) + dR(58.6, 27, 4.6, 11, 2.3),
        l: "M38,31 L41,31 M45.4,30 L48.4,30 M52.6,30 L55.6,30 M59.6,31 L62.6,31 M40,22 L42,25 M48,20.6 L49,24 M56,21 L55,24.4 M63,24 L61,26.6" };
      case 18: return { f: MIDPART, t: dC(32.6, 22.4, 7) + dC(67.4, 22.4, 7), tl: "M29,21 C30,18 34,17.6 36,20 M64,20 C66,17.6 70,18 71,21" };
      case 19: return { f: SLICK, l: "M35.6,29 C44,26 56,26 64.4,29", sh: "M40,24.4 C45,21.6 55,21.6 60,24.4" };
      case 20: var pts = [], cs; for (var i = 0; i <= 10; i++) { var a = Math.PI * (1.08 + 0.84 * i / 10); pts.push([f2(50 + 20.4 * Math.cos(a)), f2(40 + 17.6 * Math.sin(a)), 4]); }
        pts.push([50, 22.4, 4.4], [42, 24, 4.4], [58, 24, 4.4]);
        return { f: BUZZ + circles(pts) };
      case 21: return { z: BUZZ, f: "M31,36 C30,22 40,16 52,16 C64,16 71,22 70,33 C70,35 68,36 66,35 C60,33 54,33.5 48,35 C42,36.5 36,37 31,36Z", l: "M38,24 C46,20 56,19 64,22 M36,30 C44,27 54,26 62,28" };
      case 22: return { b: "M27,40 C27,22 38,17 50,17 C62,17 73,22 73,40 L76,80 L62,76 L62,52 L38,52 L38,76 L24,80Z",
        f: "M50,22 C44,24 38,28 34,36 C31,42 30.5,52 31.5,62 L27,62 C26,50 26.5,42 28,34 C31,24 40,19 50,19 C60,19 69,24 72,34 C73.5,42 74,50 73,62 L68.5,62 C69.5,52 69,42 66,36 C62,28 56,24 50,22Z", l: "M50,19.4 L50,22.4" };
      case 23: return { b: "M26.5,42 C25,22 38,17 50,17 C62,17 75,22 73.5,42 C75,48 72,52 75,57 C77,62 73,66 70,66 L30,66 C27,66 23,62 25,57 C28,52 25,48 26.5,42Z",
        f: "M29,48 C27,28 38,19.5 50.5,19.5 C63,19.5 73,28 71,48 L68.5,48 C68,40 65,35 60,33 C54,36 48,34 42,37 C37,39.5 33.5,42 31.5,48Z" + "M31.5,46 C29,52 32,56 29.5,61 L27,60 C29,55 26.5,51 28.8,46Z", l: "M44,25 C50,22 58,24 62,28 M27.4,50 C29,53 27.6,56 28.6,58" };
      case 24: return { f: SLICK, b: "M47,22 C50,10 60,6 66,10 C74,16 72,32 76,46 C78,54 74,62 70,64 C71,52 66,40 62,30 C59,24 54,22 50,24Z", l: "M38,25 C44,22 56,22 62,25", x: [50, 20.4, 2.2] };
      case 25: return { f: SLICK, t: dC(50, 16.4, 6), l: "M38,25 C44,22 56,22 62,25", tl: "M46.4,14.6 C48.4,12.6 51.6,12.6 53.6,14.6", tx: [50, 21.6, 1.8] };
      case 26: var b3 = braid(70.4, 50, 73.4, 88, 10, 3.6); return { f: SIDEPART, b: dC(50, 39, 21.5), m: b3.d, ml: b3.l, x2: [[73.4, 91.2]] };
      case 27: return { f: "M29,45 L27,32 L33,34 L31,22 L38,28 L38,15 L44,24 L48,11 L51,23 L56,12 L58,25 L64,15 L64,28 L71,22 L68,34 L74,32 L71,45 C66,35 60,31.5 50,31.5 C40,31.5 34,35 29,45Z" };
      case 28: return { z: "M30,44 C30,30 36,24 44,22.4 L45,33 C38,34 33,37 30,44Z", f: "M38,22 C46,17.5 62,17.5 69,24 C73.5,30 73,44 70.5,58 L67.4,57 C68,48 67,41 64,37.5 C58,36 50,36.5 44,33 C41,30 39,26 38,22Z", l: "M46,24 C54,22 62,24 66,30 M50,30 C56,30 62,32 65,36" };
      case 29: return { b: dC(50, 37, 21), f: "M29.5,44 C28,26 39,18.5 51,18.5 C63,18.5 72,26 70.5,44 L70,52 C68,50 66,46 63,44 C58,42 52,42 46,40 C40,38 36,36 34,36 C32.5,38 31.5,41 31,44Z", l: "M36,27 C46,26 58,30 66,40 M42,22 C52,22 62,28 68,36" };
      case 30: return { f: SLICK, ld: "M36.6,32 C37,26 41,22 46,20.4 M42.4,31 C42.6,25 45.6,21.4 48.6,19.8 M48.6,30.6 L49.6,19.4 M54.6,30.8 C55,25 53.6,21.4 51.6,19.6 M60.4,31.6 C60.4,26 58,22 54,20.2 M65,33.6 C65,28 62.4,23.6 58,21" };
      case 31: return { f: "M29.5,47 C28.5,40 29.5,35 32,32 L34,33 C32.5,37 32,42 32.5,47Z" + mir("M29.5,47 C28.5,40 29.5,35 32,32 L34,33 C32.5,37 32,42 32.5,47Z"), l2: "M44,27.4 C46,25.4 50,24.8 53,25.8 M42,30.4 C46,28 52,27.6 58,29" };
      case 32: return { f: "M30,45 C28,30 34,23 40,21 C38,15 44,9 54,9 C64,9 70,14 68,21 C71,25 72,33 70,45 C68,38 65,34 61,33 C54,32 44,32 38,33 C34,35 31.5,39 30,45Z", l: "M42,20 C44,14 52,12 58,14 C62,15.4 64,18 63,21 M38,26 C46,22 58,22 64,26" };
      case 33: return { b: "M27,42 C26,22 38,17 50,17 C62,17 74,22 73,42 L74.5,64 C70,67 30,67 25.5,64Z",
        f: "M28.5,47 C27,27 38,19.5 50,19.5 C62,19.5 73,27 71.5,47 L69,47 C68,40 64,35.5 58,34.5 C54.5,34 51.5,31.5 50,28.5 C48.5,31.5 45.5,34 42,34.5 C36,35.5 32,40 31,47Z" + "M28.5,46 L31,46 L31.6,64 L27,64Z" + mir("M28.5,46 L31,46 L31.6,64 L27,64Z"), l: "M50,20 L50,28" };
      default: return {};
    }
  }
  function hairFills(s, defs) {   // {b fill, s shadow, h highlight, base hex, dk line hex}
    var base = hexOf(s.hx) || HAIRC[s.hc], o = { b: base, base: base, dk: shade(base, -0.28) };
    var h2 = s.h2 ? HAIRC[(s.h2 | 0) - 1] : null;
    if (!h2) return o;
    var n = nid(), t = s.ht | 0, g = function (id, a, b2) {
      if (t === 0) return grad(id, 0, 24, 0, 68, [[0, a], [0.35, a], [1, b2]]);
      if (t === 1) return grad(id, 0, 14, 0, 44, [[0, b2], [0.5, b2], [1, a]]);
      if (t === 2) return grad(id, 0, 0, 100, 0, [[0, a], [0.5, a], [0.5, b2], [1, b2]]);
      return grad(id, 0, 0, 100, 0, [[0, a], [0.36, a], [0.36, b2], [0.46, b2], [0.46, a], [1, a]]);
    };
    defs.push(g(n + "b", base, h2), g(n + "s", shade(base, -0.17), shade(h2, -0.17)), g(n + "h", shade(base, 0.16), shade(h2, 0.16)));
    return { b: "url(#" + n + "b)", s: "url(#" + n + "s)", h: "url(#" + n + "h)", base: base, dk: shade(base, -0.28), two: true };
  }
  function hairPart(d, F, op) {
    if (!d) return "";
    var o = F.two ? { s: F.s, h: F.h } : {};
    if (op) o.x = ' opacity="' + op + '"';
    return cel(d, F.b, o);
  }

  /* ---------- Facial hair (colour = hair colour; Tomteskägg is always white) ---------- */
  var MUST = "M41,54 C44,50.8 48,51 50,53 C52,51 56,50.8 59,54 C56,56 53,55.2 50,54.6 C47,55.2 44,56 41,54Z";
  var FULLB = "M30,46 C30,65 39,73 50,73 C61,73 70,65 70,46 L66.5,48 C65,58 59,61.2 50,61.2 C41,61.2 35,58 33.5,48Z";
  var STUB = "M31,48 C32,63 40,68.5 50,68.5 C60,68.5 68,63 69,48 C67,58 62,61 58,61 C55,59.8 45,59.8 42,61 C38,61 33,58 31,48Z";
  var STUBM = "M42,53.2 Q50,50.6 58,53.2 L57,54.4 Q50,52.6 43,54.4Z";
  var WALRUS = "M39,53 C43,49 48,50 50,52 C52,50 57,49 61,53 L61.5,59.5 C57.5,56.5 54,56.6 50,56.6 C46,56.6 42.5,56.5 38.5,59.5Z";
  function facialHair(f, col) {
    var B = function (d, c) { return cel(d, c || col, { w: [1.2, 1], v: [0.6, 0.6] }); };
    var stub = P(STUB, col, ' opacity=".35"') + P(STUBM, col, ' opacity=".35"');
    switch (f) {
      case 1: return stub;
      case 2: return B(MUST);
      case 3: return B(WALRUS);
      case 4: return B(MUST) + B("M45.4,61 C46.2,67.5 53.8,67.5 54.6,61 C52.6,62.8 47.4,62.8 45.4,61Z");
      case 5: case 8: return B(FULLB) + B(MUST) + (f === 8 ? B("M47,70 L53,70 L52.2,84 L47.8,84Z") + S("M47.3,74 L52.7,74 M47.5,78 L52.5,78", "#ffc24d", 1) : "");
      case 6: return B("M31,47 C32,64 40,69.5 50,69.5 C60,69.5 68,64 69,47 L67,47 C66,61 59,65.6 50,65.6 C41,65.6 34,61 33,47Z");
      case 7: return B("M38,51 C40,56 46,52.3 50,53.2 C54,52.3 60,56 62,51 C63.6,54.6 60.4,57.6 57,56.4 C54.4,55.4 52,55.4 50,55.4 C48,55.4 45.6,55.4 43,56.4 C39.6,57.6 36.4,54.6 38,51Z");
      case 9: return S("M43.6,54.1 Q50,52.4 56.4,54.1", col, fw(1.1));
      case 10: return B("M40.5,54.5 C44,50.8 48,51 50,53 C52,51 56,50.8 59.5,54.5 L60.5,64 L58,64 L57.5,56.2 C54,55.4 46,55.4 42.5,56.2 L42,64 L39.5,64Z");
      case 11: return B("M48.2,61 L51.8,61 L50,64.6Z");
      case 12: return B("M31,47 C31,62 39,70 50,70 C61,70 69,62 69,47 L66.6,48.5 C65.5,57 59,60.6 50,60.6 C41,60.6 34.5,57 33.4,48.5Z") + B(MUST);
      case 13: return B("M30,46 C30,62 36,74 42,84 C45,89 48,94 50,97 C52,94 55,89 58,84 C64,74 70,62 70,46 L66.5,48 C65,58 59,61.2 50,61.2 C41,61.2 35,58 33.5,48Z") +
        B("M38,55.6 C40,51 46,51 50,53 C54,51 60,51 62,55.6 C60,54.4 56,55 50,55.4 C44,55 40,54.4 38,55.6Z") + S("M44,66 C46,74 48,82 50,90 M56,66 C54,74 52,82 50,90", shade(col, -0.25), 0.7);
      case 14: return B("M30,44 L33.5,44 C34,52 37,56 42,58.5 C40,62 36,62 33,58 C30.5,54 30,49 30,44Z") + B(mir("M30,44 L33.5,44 C34,52 37,56 42,58.5 C40,62 36,62 33,58 C30.5,54 30,49 30,44Z"));
      case 15: return B(MUST) + B("M46,60.6 C47,66 49,69 50,71 C51,69 53,66 54,60.6 C52.6,61.8 47.4,61.8 46,60.6Z");
      case 16: return B("M30.5,46 C31,63 39,71.5 50,71.5 C61,71.5 69,63 69.5,46 L67.2,46 C66.5,60 60,66.2 50,66.2 C40,66.2 33.5,60 32.8,46Z");
      case 17: return stub + B(WALRUS);
      case 18: var W = "#f4f2ec", pts = [[32, 50, 4.4], [33, 57, 5], [37, 63, 5.4], [43, 68, 5.6], [50, 70, 6], [57, 68, 5.6], [63, 63, 5.4], [67, 57, 5], [68, 50, 4.4], [50, 64, 6], [44, 62, 5], [56, 62, 5]];
        return B(pts.map(function (p) { return dC(p[0], p[1], p[2]); }).join(""), W) + B("M39,55 C41,50.4 46,50.6 50,53 C54,50.6 59,50.4 61,55 C58,57.6 54,56.4 50,56 C46,56.4 42,57.6 39,55Z", W) + P("M44.6,57.6 Q50,62 55.4,57.6 Q50,60 44.6,57.6Z", "#5a1f1a");
      case 19: return stub + B(MUST);
      case 20: return B("M30,46 C30,62 37,70 44,74 L50,83 L56,74 C63,70 70,62 70,46 L66.5,48 C65,58 59,61.2 50,61.2 C41,61.2 35,58 33.5,48Z") + B(MUST);
      case 21: return B(FULLB) + B(MUST) + B("M43.4,70 L47.6,70 L47,84 L44,84Z") + B("M52.4,70 L56.6,70 L56,84 L53,84Z") + S("M43.8,76 L47.2,76 M52.8,76 L56.2,76 M44,80.4 L47,80.4 M53,80.4 L56,80.4", "#ffc24d", 1);
      case 22: return B("M44,62.4 C44.5,68 47,70.6 50,70.6 C53,70.6 55.5,68 56,62.4 C53,63.8 47,63.8 44,62.4Z");
      case 23: return B("M28.5,45 C27.5,66 37,79 50,79 C63,79 72.5,66 71.5,45 L67,47.5 C65.5,58 59,61.2 50,61.2 C41,61.2 34.5,58 33,47.5Z") + B(MUST);
      case 24: return S("M37,52.6 L28.6,50.6 M37,54.6 L28.4,55.6 M63,52.6 L71.4,50.6 M63,54.6 L71.6,55.6", "#2b2b2b", 0.7) + E(50, 52, 1.6, 1.1, "#2b2b2b");
      case 25: return B("M40,56 C41,51 46,50.6 50,52.6 C54,50.6 59,51 60,56 C60.5,58.5 59.5,61 58,62 C57.6,59 56,56.6 53,56 C51.6,55.7 48.4,55.7 47,56 C44,56.6 42.4,59 42,62 C40.5,61 39.5,58.5 40,56Z");
      default: return "";
    }
  }

  /* ---------- Headwear. HCLIP = hats that hide the top of the hair: y where the front hair is cut (back hair is cut at 24). ---------- */
  var HCLIP = { 1: 33.5, 2: 33.5, 3: 33.5, 4: 33.5, 5: 33.5, 6: 33.5, 7: 37, 10: 33.5, 11: 33.5, 12: 33.5,
    14: 33.5, 15: 33.5, 16: 37, 17: 32, 21: 34, 22: 31, 23: 31, 24: 33, 25: 33, 26: 33, 27: 32, 28: 37, 29: 33, 30: 31.5, 32: 33.5, 34: 33.5, 38: 33.5, 39: 33, 40: 35, 42: 33.5, 43: 33.5 };   // avt01
  function hatSVG(h, s) {
    var c = hexOf(s.ux) || TOPC[s.uc], dk = shade(c, -0.3), K = function (d, f, o) { return cel(d, f, o); };
    var CAPD = "M29,36 C29,19 40,14.5 50,14.5 C60,14.5 71,19 71,36Z";
    switch (h) {
      case 1: return K(CAPD, c) + P("M27,36 C40,32.6 62,32.6 84,38 C72,41.6 40,40.4 27,38.6Z", dk) + C(50, 15, 1.6, dk) + S("M50,15 L50,35", dk, 0.7, ' opacity=".5"');
      case 2: return K(CAPD, c) + P("M24.6,32.4 C18,32 16,36.6 21,38.4 L31,37Z", dk) + C(50, 15, 1.6, dk) + R(44, 30, 12, 4, 2, dk);
      case 3: return K("M28,36 C28,17 40,12 50,12 C60,12 72,17 72,36Z", c) + K(dR(26.6, 31, 46.8, 8.4, 4), dk, { w: [1, 0.8], v: [0.6, 0.6] }) + S("M34,33 L34,38 M40,33 L40,38 M46,33 L46,38 M52,33 L52,38 M58,33 L58,38 M64,33 L64,38", shade(c, -0.45), 1, ' opacity=".6"');   // avt01: no pompom (that is the bobble hat)
      case 4: return K("M32.4,33 C33,17.4 67,17.4 67.6,33Z", "#c9b78a") + K("M23,36.6 C29,30 71,30 77,36.6 C70,39.4 30,39.4 23,36.6Z", "#b09d6c", { w: [1, 1], v: [0.6, 0.6] }) + R(32.6, 29.6, 34.8, 3.4, 0, "#6f5d34");
      case 5: return K("M29.4,36 L31.6,19.4 C40,17 60,17 68.4,19.4 L70.6,36Z", "#59613a") + P("M28,35 C40,32.6 60,32.6 73,35 L74,39 C60,37 40,37 27,39Z", "#3f4527") + R(46, 24, 8, 5, 1, "#2a2f1a") + C(50, 26.5, 1.2, "#ffc24d");
      case 6: return K("M27.6,35 C22,22 44,13 63,17.4 C76,20.6 78,30 71,35 C60,31.6 40,31.6 27.6,35Z", "#1d4d2b") + R(27, 32.6, 45, 3.6, 1.8, "#13361e") + C(39, 27, 2.6, "#ffc24d") + C(39, 27, 1.1, "#c8202a");
      case 7: return K("M26.6,40 C25.6,19 40,12 50,12 C60,12 74.4,19 73.4,40 L70,41.6 C66,35 34,35 30,41.6Z", "#4f5a33") + C(38, 24, 3, "#3a4224") + C(58, 20, 2.4, "#6b7442") + C(64, 31, 2.6, "#3a4224") + C(46, 32, 2, "#6b7442") + S("M30,41 C32,56 36,62 42,66 M70,41 C68,56 64,62 58,66", "#2a2f1a", 1.2);
      case 8: return S("M29,46 C27,18 73,18 71,46", "#22252b", 3) + K(dR(24, 40, 8, 12, 3.4), "#22252b") + K(dR(68, 40, 8, 12, 3.4), "#22252b") + S("M28,52 C28,60 34,62 42,59", "#22252b", 1.6) + C(42.6, 58.8, 1.8, "#c8202a");
      case 9: return '<g transform="translate(0 3) rotate(14 50 26)">' + K("M39,27 L50,2 L61,27Z", "#ff5c93") + P("M42,20 L58,20 L56,15 L44,15Z", "#ffc24d") + P("M46,10 L54,10 L52.6,6.6 L47.4,6.6Z", "#4aa3ff") + C(50, 2.6, 3, "#ffc24d") + "</g>";
      case 10: return K("M27,38 C26,19 40,13 50,13 C60,13 74,19 73,38Z", "#8a8f99") + R(26, 33, 48, 5.6, 2.6, "#6b4426") + K("M27.6,30 C19,28.4 16.6,20.6 21.4,14.4 C23,19.4 25.4,21.4 30.4,22.4Z", "#f2ead6") + K("M72.4,30 C81,28.4 83.4,20.6 78.6,14.4 C77,19.4 74.6,21.4 69.6,22.4Z", "#f2ead6") + S("M50,13 L50,33", "#6f747d", 1.6) + C(36, 35.8, 0.9, "#ffc24d") + C(64, 35.8, 0.9, "#ffc24d");
      case 11: return K("M24,31 C24,17 76,17 76,31 L70,35 L30,35Z", "#2f3b26") + R(29, 30, 42, 5.6, 0, "#1a2214") + P("M29,35 C38,33 62,33 71,35 C66,40 34,40 29,35Z", "#0f0f0f") + P(star(50, 26, 3.4), "#ffc24d") + S("M30,35.2 L70,35.2", "#ffc24d", 0.8);
      case 12: return K("M28,36 C29,17 50,8 72,13 C82,16 84,26 81,33 C77,25 71,22 66,24 C70,28 72,32 72,36Z", "#c8202a") + K(dR(26, 31.6, 48, 7.2, 3.6), "#f4f4f2", { w: [1, 0.8], v: [0.6, 0.6] }) + K(dC(81, 33.6, 4), "#f4f4f2", { w: [1, 0.8], v: [0.6, 0.6] });
      case 13: return P("M31,32 L30.4,15 L38.4,23.4 L44,11 L50,21.4 L56,11 L61.6,23.4 L69.6,15 L69,32Z", "#f5c542", ' stroke="#a86a00" stroke-width=".8"') + R(31, 28, 38, 4.6, 0, "#e0a92a") + C(50, 30.3, 1.6, "#c8202a") + C(40, 30.3, 1.3, "#2f6fb8") + C(60, 30.3, 1.3, "#1fa45c") + C(44, 11, 1.2, "#fff6cc") + C(56, 11, 1.2, "#fff6cc");
      case 14: return K("M26.6,33.6 C25.4,24 33,16.6 50,16 C67,16.6 74.6,24 73.4,33.6Z", "#f7f6f1", { k: 0.1 }) + R(28, 30.4, 44, 5.4, 1.4, "#15161a") + P("M31,35.6 C40,41.4 60,41.4 69,35.6 L66,35.6 C58,38.4 42,38.4 34,35.6Z", "#0d0e10") + S("M36,37.6 Q50,40 64,37.6", "#5a5e66", 0.6) + C(50, 33.1, 2.5, "#f5c518") + C(50, 33.1, 1.6, "#2f6fb8");
      case 15: return K("M28,36 C28,17 40,12 50,12 C60,12 72,17 72,36Z", c) + R(29, 21, 42, 3, 0, shade(c, 0.45), ' opacity=".9"') + R(28.4, 26.6, 43.2, 2.4, 0, shade(c, 0.45), ' opacity=".9"') + K(dR(26.6, 31, 46.8, 8.4, 4), dk, { w: [1, 0.8], v: [0.6, 0.6] }) + K(dC(50, 9.6, 6.2), shade(c, 0.5), { w: [1.2, 1], v: [0.7, 0.7] }) + S("M46,7 L47,10 M50,5.8 L50,9 M54,7 L53,10 M45.6,11.6 L47.6,12 M54.4,11.6 L52.4,12", shade(c, 0.2), 0.6);
      case 16: return K("M26.5,42 C25.5,20 38,13 50,13 C62,13 74.5,20 73.5,42 L69,42 L68.5,36 C60,33 40,33 31.5,36 L31,42Z", c, { hk: 0.28 }) + K(dR(25, 36, 7, 13, 3), dk) + K(dR(68, 36, 7, 13, 3), dk) + S("M40,17 L41,24 M50,15 L50,22 M60,17 L59,24", dk, 1.2) + P("M31.6,36 C40,33.4 60,33.4 68.4,36 L68.4,38.4 C60,35.6 40,35.6 31.6,38.4Z", shade(c, 0.4)) + S("M28.5,49 C30,58 36,62 44,62.6 M71.5,49 C70,58 64,62 56,62.6", "#22252b", 1.1);
      case 17: return K("M33,31 C33,18 40,14 50,14 C60,14 67,18 67,31Z", "#1d1d22", { hk: 0.12 }) + K(dE(50, 32.4, 24, 4.6), "#15151a", { w: [1, 0.8], v: [0.6, 0.6], hk: 0.14 }) + R(33, 26.4, 34, 4.6, 0, "#c8202a") +
        [36, 41, 46, 51, 56, 61].map(function (x, i) { return P("M" + (x + 1.2) + ",27.4 L" + (x + 2.4) + ",28.7 L" + (x + 1.2) + ",30 L" + x + ",28.7Z", i % 2 ? "#f5c518" : "#2f8a4a"); }).join("") + S("M33,26.4 L67,26.4 M33,31 L67,31", "#f5c518", 0.5);
      case 18: var fl = S("M27.5,34 C33,25.5 67,25.5 72.5,34", "#3c8a3a", 3.2) + S("M30,30 L28,27.4 M36,27.6 L35,24.6 M64,27.6 L65,24.6 M70,30 L72,27.4", "#4fa64a", 1.4);
        [[30, 32, "#fff", "#f5c518"], [36.6, 27.6, "#6f9bff", "#fff"], [43.6, 25.8, "#ff8fc4", "#fff"], [50, 25.2, "#fff", "#f5c518"], [56.4, 25.8, "#f5c518", "#e8722a"], [63.4, 27.6, "#b27bff", "#fff"], [70, 32, "#fff", "#f5c518"]].forEach(function (q) {
          for (var a = 0; a < 6; a++) { var t = a * 1.0472; fl += C(f2(q[0] + 1.9 * Math.cos(t)), f2(q[1] + 1.9 * Math.sin(t)), 1.35, q[2]); } fl += C(q[0], q[1], 1.2, q[3]); });
        return fl;
      case 19: var lc = S("M28.5,33 C35,27.6 65,27.6 71.5,33", "#2f7a3a", 3.6) + [32, 38, 44, 50, 56, 62, 68].map(function (x, i) { return E(x, f2(32.4 - Math.sin((x - 28) / 44 * Math.PI) * 4), 1.6, 0.9, i % 2 ? "#3c9a4e" : "#c8202a"); }).join("");
        [[33, 15.4], [41.4, 13], [50, 12], [58.6, 13], [67, 15.4]].forEach(function (q, i) {
          var x = q[0], top = q[1], bot = f2(31 - Math.sin((x - 28) / 44 * Math.PI) * 3.6), g = nid();
          lc += K(dR(x - 1.7, top, 3.4, bot - top, 0.8), "#fbf8ef", { w: [0.8, 0.6], v: [0.4, 0.4], k: 0.1 }) + "<defs>" + rgrad(g, x, top - 3, 4.4, [[0, "#ffe9a0", 0.9], [1, "#ffcf4d", 0]]) + "</defs>" + C(x, top - 3, 4.4, "url(#" + g + ")") +
            P("M" + x + "," + (top - 5.6) + " C" + (x + 1.6) + "," + (top - 3) + " " + (x + 1.2) + "," + (top - 0.6) + " " + x + "," + (top - 0.4) + " C" + (x - 1.2) + "," + (top - 0.6) + " " + (x - 1.6) + "," + (top - 3) + " " + x + "," + (top - 5.6) + "Z", "#ffb52e") + S("M" + x + "," + (top - 0.4) + " L" + x + "," + (top + 0.6), "#3b2b1f", 0.5);
        });
        return lc;
      case 20: return K("M29.5,35.5 C38,31.5 62,31.5 70.5,35.5 L70.2,40 C62,36 38,36 29.8,40Z", c, { w: [0.8, 0.8], v: [0.5, 0.5] }) + S("M30,37.8 C38,34 62,34 70,37.8", "#fff", 0.9, ' opacity=".85"');
      case 21: return K("M28,38 C27,22 38,15 50,15 C62,15 73,22 72,38 C64,34 36,34 28,38Z", c) + K("M28.6,35.6 L19.6,38.4 L22.4,43.6 L30,38.4Z", dk, { w: [0.8, 0.8], v: [0.5, 0.5] }) + K("M28.6,36 L22,31.6 L19.6,35.8 L27.6,38.6Z", c, { w: [0.8, 0.8], v: [0.5, 0.5] }) +
        [[38, 22], [50, 19], [62, 22], [44, 28], [56, 28], [33, 30], [67, 30]].map(function (q) { return C(q[0], q[1], 1, "#fff", ' opacity=".8"') + C(q[0] + 1.6, q[1] + 1, 0.5, "#fff", ' opacity=".6"'); }).join("");
      case 22: return K("M31,30 C31,17 40,13.5 50,13.5 C60,13.5 69,17 69,30Z", c) + K(dR(30, 24.6, 40, 7.4, 3.4), dk, { w: [1, 0.8], v: [0.6, 0.6] }) + S("M36,26 L36,31 M42,26 L42,31 M48,26 L48,31 M54,26 L54,31 M60,26 L60,31 M66,26 L66,31", shade(c, -0.45), 0.8, ' opacity=".55"');
      case 23: var cb = "#8a5a2b"; return '<g transform="translate(0 -3)">' + K("M35,33.4 C34,18 39,12 44,13 C47,14 49,16.4 50,16.4 C51,16.4 53,14 56,13 C61,12 66,18 65,33.4Z", cb) + K("M14,25 C18,30.2 34,30.4 50,30.2 C66,30.4 82,30.2 86,25 C84,35 68,38.4 50,38 C32,38.4 16,35 14,25Z", shade(cb, -0.12), { w: [1, 1], v: [0.6, 0.6] }) + R(35, 27, 30, 3.4, 0, "#3b2618") + C(39, 28.7, 0.9, "#c9ced6") + "</g>";
      case 24: return K("M33,31 C32,20 38,15 44,15.5 L50,18.4 L56,15.5 C62,15 68,20 67,31Z", "#5a5e66") + K("M21,33 C30,28.6 70,28.6 79,33 C73,37.4 27,37.4 21,33Z", "#4a4e56", { w: [1, 0.8], v: [0.6, 0.6] }) + R(33, 27, 34, 3.6, 0, "#1d1d22") + S("M60,27.4 L60,30.2", "#c8202a", 1.4);
      case 25: return K("M33,32 C33,18 41,13 50,13 C59,13 67,18 67,32Z", "#1b1b1f", { hk: 0.2 }) + K("M27,32.4 C35,29.2 65,29.2 73,32.4 C70,35.6 30,35.6 27,32.4Z", "#121215", { w: [1, 0.8], v: [0.6, 0.6], hk: 0.2 }) + R(33, 28.4, 34, 3.2, 0, "#3a3a40");
      case 26: return K("M24,27.6 C24,18.6 76,18.6 76,27.6 L70.6,32 L29.4,32Z", "#f7f6f1", { k: 0.1 }) + R(29.4, 29, 41.2, 5.6, 0, "#1d2b53") + P("M29,34.4 C38,32.4 62,32.4 71,34.4 C66,39.6 34,39.6 29,34.4Z", "#0d0e10") + S("M31.6,36 C40,38.6 60,38.6 68.4,36", "#e9b93a", 1.6) + S("M31,33.6 C40,31.2 60,31.2 69,33.6", "#e9b93a", 0.9) +
        P("M50,22.4 L50,28.6 M47.6,24 L52.4,24", "#e9b93a") + S("M50,22.4 L50,28.6 M47.8,24 L52.2,24 M46.8,26.6 Q50,30 53.2,26.6", "#e9b93a", 0.9) + S("M33,30.4 Q50,37.4 67,30.4", "#e9b93a", 0.6, ' opacity=".7"');
      case 27: return K("M34,32 C33,21 40,17.6 50,17.6 C60,17.6 67,21 66,32Z", "#f7f6f1", { k: 0.1 }) + K("M27,34 C26.4,28 30,25.6 34,27.6 C42,30.6 58,30.6 66,27.6 C70,25.6 73.6,28 73,34 C64,37.4 36,37.4 27,34Z", "#ebe9e1", { w: [0.8, 0.8], v: [0.5, 0.5], k: 0.1 }) + S("M28.4,31.4 C38,34.6 62,34.6 71.6,31.4", "#d4d1c6", 0.7);
      case 28: var hc = "#7d848c"; return K("M25,41 C24,21 37,12.5 50,12.5 C63,12.5 76,21 75,41 C70,37.5 30,37.5 25,41Z", hc, { hk: 0.3 }) + K("M19.6,45 C21,40.6 25,38.4 30,38 L70,38 C75,38.4 79,40.6 80.4,45 C72,41.6 28,41.6 19.6,45Z", shade(hc, -0.12), { w: [1, 0.8], v: [0.6, 0.6] }) + S("M25.4,40.6 C30,37 70,37 74.6,40.6", shade(hc, -0.3), 1.2) + S("M28,41 C30,55 36,61 43,63.4 M72,41 C70,55 64,61 57,63.4", "#3b3a2a", 1.1) + C(50, 16, 0.9, shade(hc, -0.3));
      case 29: var fur = "#6b5a48"; return K("M29,32 C29,18 71,18 71,32Z", "#3a3f4a") + K(dR(25.6, 26.6, 48.8, 8.4, 4.2), fur, { w: [1, 0.8], v: [0.6, 0.6], hk: 0.22 }) + K("M25,33 L33,33 L33.4,52 C31.4,56.4 26.4,56.4 25,52Z", fur, { w: [1, 0.8], v: [0.6, 0.6] }) + K(mir("M25,33 L33,33 L33.4,52 C31.4,56.4 26.4,56.4 25,52Z"), fur, { w: [1, 0.8], v: [0.6, 0.6] }) +
        S("M28,28.4 L29,30.4 M33,28 L34,30 M38,28 L39,30 M43,28 L44,30 M48,28 L49,30 M53,28 L54,30 M58,28 L59,30 M63,28 L64,30 M68,28.4 L69,30.4", shade(fur, -0.3), 0.6) + C(50, 30.8, 1.8, "#e9b93a");
      case 30: var lt = "#6b4426"; return K("M27,46 C25,22 38,14 50,14 C62,14 75,22 73,46 L68.5,46 C68,36 62,31 50,31 C38,31 32,36 31.5,46Z", lt) + S("M50,14.4 L50,31", shade(lt, -0.3), 0.8) + S("M28.6,49 C30,57 36,61 43,62", "#3b2618", 1.1) +
        R(28, 24, 44, 3.6, 1.6, "#2a1a10") + K(dC(42, 26, 5), "#b07a2a", { w: [0.8, 0.8], v: [0.5, 0.5] }) + K(dC(58, 26, 5), "#b07a2a", { w: [0.8, 0.8], v: [0.5, 0.5] }) + C(42, 26, 3.4, "#7fb6c8") + C(58, 26, 3.4, "#7fb6c8") + C(40.8, 24.8, 1, "#fff", ' opacity=".7"') + C(56.8, 24.8, 1, "#fff", ' opacity=".7"');
      case 31: var pc = "#ff8fc4"; return K("M31,33 L31,20 L37,26 L43,18 L50,25 L57,18 L63,26 L69,20 L69,33Z", pc, { w: [0.8, 0.8], v: [0.5, 0.5] }) + R(31, 27.4, 38, 3, 0, "#4aa3ff") + [35, 41, 47, 53, 59, 65].map(function (x, i) { return C(x, 23.6 + (i % 2) * 1.6, 1, "#fff", ' opacity=".9"'); }).join("") + C(43, 18.6, 1.2, "#ffd36b") + C(57, 18.6, 1.2, "#3ddc84") + C(31, 20, 1, "#4aa3ff") + C(69, 20, 1, "#4aa3ff");
      case 32: var can = "#cfd5dc"; return K("M29,36 C29,19 40,14.5 50,14.5 C60,14.5 71,19 71,36Z", "#f2c230") + P("M27,36 C40,33 60,33 73,36 L73,38.6 C60,35.6 40,35.6 27,38.6Z", "#d9a81e") +
        K(dR(19, 16, 10, 15, 2), can) + K(dR(71, 16, 10, 15, 2), can) + R(19, 20, 10, 5, 0, "#c8202a") + R(71, 20, 10, 5, 0, "#2f6fb8") + S("M24,30 C23,46 30,57 44,58.4 M76,30 C77,46 70,57 56,58.4", "#fbfaf7", 1.1) + S("M24,30 C23,46 30,57 44,58.4 M76,30 C77,46 70,57 56,58.4", "#f5a623", 0.5, ' stroke-dasharray="1.2 1.6"');
      case 33: var dv = "#d8262f"; return S("M28.4,34 C34,25.6 66,25.6 71.6,34", "#1d1d22", 1.6) + K("M33.6,28.6 C29.6,22 29.4,15.6 32.4,9.6 C34.4,15.6 37.6,20 41,24.6Z", dv, { w: [0.8, 0.6], v: [0.5, 0.5], hk: 0.25 }) + K(mir("M33.6,28.6 C29.6,22 29.4,15.6 32.4,9.6 C34.4,15.6 37.6,20 41,24.6Z"), dv, { w: [0.8, 0.6], v: [0.5, 0.5], hk: 0.25 });
      case 34: return K("M30,33 L45.4,6.4 C48,2 54,1.2 58,3.2 C54,4.4 52.2,7.2 53,11 L70,33Z", "#24202e", { hk: 0.14 }) + K("M14,34 C24,28 76,28 86,34 C76,39.6 24,39.6 14,34Z", "#1b1824", { w: [1, 0.8], v: [0.6, 0.6], hk: 0.14 }) + P("M33.4,27.6 C42,26 58,26 66.6,27.6 L68.2,30.8 C58,29 42,29 31.8,30.8Z", "#7a3ad6") + R(46.4, 26.8, 7.2, 4.4, 0.6, "none", ' stroke="#e9b93a" stroke-width="1"');
      case 35: return '<g transform="rotate(-10 50 22)">' + K(dR(39, 6, 22, 21, 1.6), "#1b1b1f", { hk: 0.22 }) + K(dE(50, 27, 16, 3.4), "#121215", { w: [0.8, 0.6], v: [0.5, 0.5], hk: 0.2 }) + R(39, 20, 22, 4, 0, "#e9b93a") + "</g>" + P(star(36, 10, 2.4), "#ffd76b") + P(star(66, 6, 1.8), "#ff8fc4") + C(70, 14, 0.8, "#8fd3ff") + C(30, 18, 0.7, "#ffd76b");
      case 36: var an = "#8a5a2b"; return S("M28.4,34 C34,25.6 66,25.6 71.6,34", "#5a3a1f", 1.6) + S("M35,27.6 C33,20 30,15 26,12 M31.4,19.6 C28,19.4 25,20.6 23,23 M33.6,23.4 C31,24.6 29,26.6 28.2,28.6 M29,15 C29.6,11.6 31.4,9 34,7.6", an, 2.2) + S(mir("M35,27.6 C33,20 30,15 26,12 M31.4,19.6 C28,19.4 25,20.6 23,23 M33.6,23.4 C31,24.6 29,26.6 28.2,28.6 M29,15 C29.6,11.6 31.4,9 34,7.6"), an, 2.2) + C(40, 28.2, 1.6, "#e9b93a") + C(60, 28.2, 1.6, "#e9b93a");
      case 37: return S("M28.4,34.6 C34,25 66,25 71.6,34.6", "#1d1d22", 1.8) + K("M31,29 L33,15.6 L42.6,24.4Z", "#1d1d22", { w: [0.8, 0.6], v: [0.5, 0.5], hk: 0.22 }) + K(mir("M31,29 L33,15.6 L42.6,24.4Z"), "#1d1d22", { w: [0.8, 0.6], v: [0.5, 0.5], hk: 0.22 }) + P("M33.4,25.6 L34.4,19.4 L39,23.6Z", "#ff8fc4") + P(mir("M33.4,25.6 L34.4,19.4 L39,23.6Z"), "#ff8fc4");
      case 38: return K("M29,36 C29,19 40,14.5 50,14.5 C60,14.5 71,19 71,36Z", c) + K("M36,36 C36,22 41.6,16 50,15.6 C58.4,16 64,22 64,36Z", "#f7f6f1", { k: 0.08 }) + P("M27,36 C40,32.6 62,32.6 84,38 C72,41.6 40,40.4 27,38.6Z", dk) +
        [[32.4, 27], [33, 32], [67.6, 27], [67, 32], [34, 22.6], [66, 22.6]].map(function (q) { return C(q[0], q[1], 0.6, shade(c, -0.45)); }).join("") + C(50, 15.2, 1.6, dk);
      case 39: var st = "#e6c97a"; return K("M35,31 C35,19 41,15 50,15 C59,15 65,19 65,31Z", st) + K("M12,33 C22,26.6 78,26.6 88,33 C78,39.6 22,39.6 12,33Z", shade(st, -0.06), { w: [1, 0.8], v: [0.6, 0.6] }) + R(35, 26, 30, 4, 0, "#c8202a") +
        S("M38,19 L62,19 M36,23 L64,23 M18,32 C30,29.6 70,29.6 82,32 M20,35.4 C32,37.4 68,37.4 80,35.4", shade(st, -0.2), 0.5, ' opacity=".7"');
      case 40: return K("M26,44 C25,20 38,12.5 50,12.5 C62,12.5 75,20 74,44 C72,38 66,35 50,35 C34,35 28,38 26,44Z", c, { hk: 0.3 }) + R(40, 15, 20, 3, 1.5, dk) + R(26, 27.6, 48, 3, 1.2, "#22252b") + '<rect x="33" y="22.6" width="34" height="10" rx="5" fill="#ff8a1f" stroke="#eef0ec" stroke-width="1.4"/>' + S("M37,25.6 L44,25.6", "#fff", 1.1, ' opacity=".7"') + S("M28,45 C30,56 36,61 43,62.6 M72,45 C70,56 64,61 57,62.6", "#22252b", 1.1);
      case 41: var g = nid(); return "<defs>" + rgrad(g, 50, 12, 18, [[0, "#fff6cc", 0.55], [1, "#fff6cc", 0]]) + "</defs>" + E(50, 12, 18, 7, "url(#" + g + ")") + '<ellipse cx="50" cy="12" rx="13" ry="3.6" fill="none" stroke="#ffd76b" stroke-width="2.4"/><ellipse cx="50" cy="11.4" rx="13" ry="3.6" fill="none" stroke="#fff6cc" stroke-width=".7" opacity=".8"/>';
      case 42: return K("M27.6,35 C22,22 44,13 63,17.4 C76,20.6 78,30 71,35 C60,31.6 40,31.6 27.6,35Z", "#4a90d9") + R(27, 32.6, 45, 3.6, 1.8, "#2f6aa8") + C(39, 27, 2.6, "#d9dee6") + C(39, 27, 1.2, "#4a90d9");
      case 43: return K("M24,31 C24,17 76,17 76,31 L70,35 L30,35Z", "#22301f") + R(29, 30, 42, 5.6, 0, "#141c10") + P("M29,35 C38,33 62,33 71,35 C66,40 34,40 29,35Z", "#d9a62a") +
        S("M31,36 C36,38.6 44,39.2 50,39.2 C56,39.2 64,38.6 69,36", "#e9b93a", 1.2, ' stroke-dasharray="1.6 1"') + P(star(50, 25.6, 4.2), "#ffc24d") + C(50, 25.6, 1.4, "#2f6fb8") + S("M30,30.4 L70,30.4", "#e9b93a", 1.1) + S("M33,27 Q36,23.6 39,26 M67,27 Q64,23.6 61,26", "#e9b93a", 0.8);
      default: return "";
    }
  }

  /* ---------- Glasses + masks ---------- */
  function glassesSVG(g) {
    var k = "#15161a", lens = "rgba(255,255,255,.12)", id = ID;
    function rimC(x, y, r, col, sw, fill) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + (fill || lens) + '" stroke="' + (col || k) + '" stroke-width="' + (sw || 1.4) + '"/>'; }
    function arms(col, w) { return S("M35.4,44.6 L31,43.6 M64.6,44.6 L69,43.6", col || k, w || 1.2); }
    switch (g) {
      case 1: return S("M48.2,46 Q50,44.6 51.8,46", k, 1.2) + rimC(42, 46, 5.6) + rimC(58, 46, 5.6) + S("M36.4,45 L31,44 M63.6,45 L69,44", k, 1.2) + S("M39,43.4 L41,42.6 M55,43.4 L57,42.6", "#fff", 0.7, ' opacity=".55"');
      case 2: return R(35.6, 41.6, 12.4, 9, 2, lens, ' stroke="' + k + '" stroke-width="1.5"') + R(52, 41.6, 12.4, 9, 2, lens, ' stroke="' + k + '" stroke-width="1.5"') + S("M48,45 L52,45 M35.6,44 L31,43 M64.4,44 L69,43", k, 1.4) + S("M38,43.6 L40.6,43.6 M54.4,43.6 L57,43.6", "#fff", 0.7, ' opacity=".55"');
      case 3: return R(35, 42, 13.4, 8.6, 3.6, "#101216") + R(51.6, 42, 13.4, 8.6, 3.6, "#101216") + S("M48.4,44.4 L51.6,44.4 M35,44 L30.6,43 M65,44 L69.4,43", k, 1.5) + S("M38,44.4 L41,44.4 M54.6,44.4 L57.6,44.4", "#fff", 0.9, ' opacity=".5"');
      case 4: return R(27, 42, 46, 5, 0, "#2b2b2b") + "<defs>" + grad(id + "k", 32, 38.6, 68, 52.6, [[0, "#ffd36b"], [0.5, "#ff7a1a"], [1, "#b26bff"]]) + '</defs><rect x="32" y="38.6" width="36" height="14" rx="7" fill="url(#' + id + 'k)" stroke="#eef0ec" stroke-width="1.6"/>' + S("M37,42 L45,42", "#fff", 1.2, ' opacity=".7"');
      case 5: return P("M35,43 C35,41.4 48,41.4 48,43 C48,48 46,51.4 41.6,51.4 C37.2,51.4 35,48 35,43Z", "#2b3a4a", ' stroke="#c8a24a" stroke-width="1"') + P("M52,43 C52,41.4 65,41.4 65,43 C65,48 62.8,51.4 58.4,51.4 C54,51.4 52,48 52,43Z", "#2b3a4a", ' stroke="#c8a24a" stroke-width="1"') + S("M48,43 L52,43 M35,43 L31,42.4 M65,43 L69,42.4", "#c8a24a", 1) + S("M37.6,44.4 L40.4,44.4 M54.6,44.4 L57.4,44.4", "#fff", 0.8, ' opacity=".45"');
      case 6: return P("M50,19.5 C66,19.5 73,30 72.5,46 C72,62 66,74 50,74 C34,74 28,62 27.5,46 C27,30 34,19.5 50,19.5Z M36.5,41 Q50,38.6 63.5,41 Q65,46 63.5,51 Q50,52.6 36.5,51 Q35,46 36.5,41Z", "#1b1d22", ' fill-rule="evenodd"') + C(50, 20.5, 3, "#1b1d22") + S("M33,30 C38,26 44,24 50,24", "#3a3d45", 1.2, ' opacity=".8"');
      case 7: return P("M33,44 C33,39.4 40,39.4 46,42 L50,43.6 L54,42 C60,39.4 67,39.4 67,44 C67,50 60,51.6 54,49 L50,47.6 L46,49 C40,51.6 33,50 33,44Z M38,45.4 A3.2,2.4 0 1 0 44.4,45.4 A3.2,2.4 0 1 0 38,45.4Z M55.6,45.4 A3.2,2.4 0 1 0 62,45.4 A3.2,2.4 0 1 0 55.6,45.4Z", "#8a3ad6", ' fill-rule="evenodd"') + P(star(66, 40, 1.8), "#ffc24d") + P(star(34, 40.6, 1.4), "#ffc24d");
      case 8: return S("M30,40 L70,38.6", k, 1.2) + E(58, 46, 5.4, 4.6, k);
      case 9: return R(36, 27, 28, 5, 2, "#2a2f1a") + R(47.6, 31, 4.8, 9, 0, "#2a2f1a") + R(36.4, 39, 11.4, 11.4, 2.6, "#1f241a") + R(52.2, 39, 11.4, 11.4, 2.6, "#1f241a") + C(42.1, 44.7, 3.6, "#3ddc84", ' opacity=".85"') + C(57.9, 44.7, 3.6, "#3ddc84", ' opacity=".85"');
      case 10: return '<circle cx="58" cy="46" r="5.4" fill="rgba(255,255,255,.15)" stroke="#d6a93a" stroke-width="1.4"/>' + S("M62.6,49 C66,56 64,64 70,72", "#d6a93a", 0.8);
      case 11: var ce = "M35,43.4 C38,41.4 45,41.4 48,43.4 C48,48.4 46,50.6 42,50.6 C38,50.6 35.6,48.6 35,45.4 L32.6,41Z"; return P(ce, lens, ' stroke="' + k + '" stroke-width="1.5" stroke-linejoin="round"') + P(mir(ce), lens, ' stroke="' + k + '" stroke-width="1.5" stroke-linejoin="round"') + S("M48,44.4 Q50,43 52,44.4", k, 1.2);
      case 12: return S("M35.4,42.6 L48,42.6 M52,42.6 L64.6,42.6", k, 2.6) + '<path d="M35.6,43 Q35.4,50.4 41.8,50.4 Q48,50.4 47.8,43" fill="' + lens + '" stroke="#b9a37a" stroke-width=".8"/><path d="M52.2,43 Q52,50.4 58.2,50.4 Q64.6,50.4 64.4,43" fill="' + lens + '" stroke="#b9a37a" stroke-width=".8"/>' + S("M48,43 L52,43", "#b9a37a", 0.9) + arms(k, 1.2);
      case 13: return rimC(42, 46.4, 3.8, "#c8a24a", 0.8, "#2a1a10") + rimC(58, 46.4, 3.8, "#c8a24a", 0.8, "#2a1a10") + S("M45.8,46 Q50,44.4 54.2,46 M38.2,45.6 L31,44 M61.8,45.6 L69,44", "#c8a24a", 0.8) + C(40.6, 45, 0.9, "#fff", ' opacity=".5"') + C(56.6, 45, 0.9, "#fff", ' opacity=".5"');
      case 14: return P(heart(42, 46.6, 4.4), "rgba(255,80,120,.55)", ' stroke="#e8384f" stroke-width="1.3"') + P(heart(58, 46.6, 4.4), "rgba(255,80,120,.55)", ' stroke="#e8384f" stroke-width="1.3"') + S("M46.6,44.6 Q50,43.2 53.4,44.6", "#e8384f", 1.1) + arms("#e8384f", 1.1);
      case 15: return P(star(42, 46, 6, 0.5), "rgba(255,210,80,.45)", ' stroke="#e9b93a" stroke-width="1.2" stroke-linejoin="round"') + P(star(58, 46, 6, 0.5), "rgba(255,210,80,.45)", ' stroke="#e9b93a" stroke-width="1.2" stroke-linejoin="round"') + S("M47.4,45 L52.6,45", "#e9b93a", 1.1);
      case 16: return "<defs>" + grad(id + "sp", 31, 40, 69, 50, [[0, "#3a7bd5"], [0.5, "#8a5ad6"], [1, "#e8384f"]]) + "</defs>" + P("M30.6,43.4 C36,40 64,40 69.4,43.4 L68.4,47.4 C64,51.4 54,51.4 50,48.4 C46,51.4 36,51.4 31.6,47.4Z", "url(#" + id + "sp)", ' stroke="#22252b" stroke-width="1"') + S("M35,43.4 L44,42.4", "#fff", 1, ' opacity=".6"');
      case 17: return '<path d="M36.4,45.6 Q36.6,50.6 42,50.6 Q47.4,50.6 47.6,45.6 Z" fill="' + lens + '"/><path d="M52.4,45.6 Q52.6,50.6 58,50.6 Q63.4,50.6 63.6,45.6 Z" fill="' + lens + '"/>' + S("M36.4,45.6 Q36.6,42.4 42,42.4 Q47.4,42.4 47.6,45.6 M52.4,45.6 Q52.6,42.4 58,42.4 Q63.4,42.4 63.6,45.6", k, 1.4) + S("M47.6,44.6 Q50,43.4 52.4,44.6", k, 1) + arms(k, 1.1);
      case 18: return R(33.8, 40, 14.4, 11.6, 3.4, lens, ' stroke="' + k + '" stroke-width="1.7"') + R(51.8, 40, 14.4, 11.6, 3.4, lens, ' stroke="' + k + '" stroke-width="1.7"') + S("M48.2,44.6 L51.8,44.6", k, 1.5) + S("M33.8,43.6 L30.6,43 M66.2,43.6 L69.4,43", k, 1.3) + S("M36.6,42.8 L39.6,42.8 M54.6,42.8 L57.6,42.8", "#fff", 0.8, ' opacity=".5"');
      case 19: return R(33.4, 40.6, 33.2, 11, 2, "#f7f6f1", ' stroke="#d9d6cc" stroke-width=".6"') + R(35.8, 42.6, 11.2, 7, 1.4, "rgba(232,40,58,.75)") + R(53, 42.6, 11.2, 7, 1.4, "rgba(40,200,230,.75)") + S("M33.4,43 L30.6,42.4 M66.6,43 L69.4,42.4", "#d9d6cc", 1.2);
      case 20: return rimC(42, 46, 5.8, "#3b2618", 2, "rgba(245,166,35,.82)") + rimC(58, 46, 5.8, "#3b2618", 2, "rgba(245,166,35,.82)") + C(40.4, 47.6, 0.6, "#fff6cc") + C(43.4, 48.6, 0.45, "#fff6cc") + C(56.4, 47.6, 0.6, "#fff6cc") + C(59.6, 48.4, 0.45, "#fff6cc") +
        P("M36.6,43.4 C36.6,40 39,39.2 40.4,40.6 C41.4,39 44,39.2 44.8,40.8 C46.8,40.4 48,42 47.4,43.6 C44,42.4 40,42.4 36.6,43.4Z", "#fbf7ea") + P("M52.6,43.4 C52.6,40 55,39.2 56.4,40.6 C57.4,39 60,39.2 60.8,40.8 C62.8,40.4 64,42 63.4,43.6 C60,42.4 56,42.4 52.6,43.4Z", "#fbf7ea") + S("M47.8,46 Q50,44.6 52.2,46", "#3b2618", 1.6) + arms("#3b2618", 1.4);
      case 21: return R(27, 43.2, 46, 3.6, 1, "#3b2618") + rimC(42, 45.8, 5.2, "#b07a2a", 2.6, "rgba(120,200,160,.4)") + rimC(58, 45.8, 5.2, "#b07a2a", 2.6, "rgba(120,200,160,.4)") + '<circle cx="42" cy="45.8" r="3.6" fill="none" stroke="#d6a93a" stroke-width=".6"/><circle cx="58" cy="45.8" r="3.6" fill="none" stroke="#d6a93a" stroke-width=".6"/>' + C(40.4, 44, 0.9, "#fff", ' opacity=".6"') + C(56.4, 44, 0.9, "#fff", ' opacity=".6"');
      case 22: return R(27, 42.4, 46, 3.6, 1, "#1d2b53") + R(33, 38.4, 34, 14.4, 6, "rgba(150,220,255,.35)", ' stroke="#1f2733" stroke-width="2"') + P("M47,50.6 L50,48 L53,50.6 L52,53.6 L48,53.6Z", "#1f2733") + S("M36,41.6 L42,41.4", "#fff", 1, ' opacity=".7"') + R(70, 26, 3.2, 26, 1.6, "#f28a1a") + R(69.4, 24, 4.4, 3, 1, "#1d1d22");
      case 23: return P("M31,44.6 C31,40.4 40,39.6 46,41.6 L50,43.2 L54,41.6 C60,39.6 69,40.4 69,44.6 C69,50 61,51.4 54.6,48.8 L50,47.4 L45.4,48.8 C39,51.4 31,50 31,44.6Z M37.6,45.4 A4,2.8 0 1 0 45.6,45.4 A4,2.8 0 1 0 37.6,45.4Z M54.4,45.4 A4,2.8 0 1 0 62.4,45.4 A4,2.8 0 1 0 54.4,45.4Z", "#17181c", ' fill-rule="evenodd"') + S("M31.4,44 L26,46.6 M68.6,44 L74,46.6", "#17181c", 1);
      case 24: return rimC(42, 46, 5.8, "#e9b93a", 2.2, "rgba(255,120,190,.45)") + rimC(58, 46, 5.8, "#e9b93a", 2.2, "rgba(255,120,190,.45)") + P(star(34.6, 39.6, 3, 0.4), "#ffd76b") + P(star(65.4, 39.6, 3, 0.4), "#ffd76b") + C(37, 52, 0.7, "#fff") + C(63.4, 51.6, 0.6, "#fff") + S("M47.8,45.6 Q50,44.2 52.2,45.6", "#e9b93a", 1.6);
      case 25: var gm = "#4f5a33"; return cel("M31.6,40 C32,35.4 68,35.4 68.4,40 L69.4,54 C66.4,64.4 58,68.6 50,68.6 C42,68.6 33.6,64.4 30.6,54Z", gm) + C(42, 45.6, 5, "#1b1d16") + C(58, 45.6, 5, "#1b1d16") + C(42, 45.6, 3.8, "#6fa3a8", ' opacity=".7"') + C(58, 45.6, 3.8, "#6fa3a8", ' opacity=".7"') +
        cel(dC(50, 60, 5.6), "#3a4224", { w: [1, 0.8], v: [0.6, 0.6] }) + C(50, 60, 3.4, "#2a2f1a") + S("M47.6,58.6 L52.4,58.6 M47.6,61.4 L52.4,61.4", "#5f6650", 0.6) + S("M31,42 L26.4,40 M69,42 L73.6,40", "#2a2f1a", 1.4);
      case 26: var hm = "M36.6,48 L47.4,48 C47.4,51.6 45,53.2 42,53.2 C39,53.2 36.6,51.6 36.6,48Z"; return P(hm, "rgba(255,240,200,.28)", ' stroke="#8a5a1a" stroke-width="1.7"') + P(mir(hm), "rgba(255,240,200,.28)", ' stroke="#8a5a1a" stroke-width="1.7"') + S("M47.4,48.6 Q50,47.4 52.6,48.6 M36.6,48.4 L31,46 M63.4,48.4 L69,46", "#8a5a1a", 1.2) + S("M31,46 C30,54 32,60 36,64 M69,46 C70,54 68,60 64,64", "#b8902a", 0.4, ' opacity=".8"');
      case 27: return rimC(42, 46, 5.2, "#3b2618", 1.4, "#1d2430") + rimC(58, 46, 5.2, "#3b2618", 1.4, "#1d2430") + P("M36.8,42.4 L32,41.6 L31.4,49 L37,49.6Z", "#5a3a1f") + P("M63.2,42.4 L68,41.6 L68.6,49 L63,49.6Z", "#5a3a1f") + S("M47.2,45.4 Q50,44 52.8,45.4", "#3b2618", 1.4) + C(40.4, 44.4, 1, "#8fd3ff", ' opacity=".55"') + C(56.4, 44.4, 1, "#8fd3ff", ' opacity=".55"');
      case 28: var mg = nid(); return "<defs>" + grad(mg, 35, 41, 65, 52, [[0, "#ffd36b"], [0.35, "#ff7ab6"], [0.7, "#6fb6ff"], [1, "#3ddc84"]]) + "</defs>" + P("M35,43 C35,41.4 48,41.4 48,43 C48,48 46,51.4 41.6,51.4 C37.2,51.4 35,48 35,43Z", "url(#" + mg + ")", ' stroke="#c9ced6" stroke-width="1"') + P("M52,43 C52,41.4 65,41.4 65,43 C65,48 62.8,51.4 58.4,51.4 C54,51.4 52,48 52,43Z", "url(#" + mg + ")", ' stroke="#c9ced6" stroke-width="1"') + S("M48,43 L52,43 M35,43 L31,42.4 M65,43 L69,42.4", "#c9ced6", 1) + S("M37.4,44 L41,43.6 M54.4,44 L58,43.6", "#fff", 0.9, ' opacity=".8"');
      case 29: var px = "#0d0d0f"; return R(32, 42, 36, 2.4, 0, px) + R(34.4, 44.4, 12, 2.4, 0, px) + R(53.6, 44.4, 12, 2.4, 0, px) + R(36.8, 46.8, 7.2, 2.4, 0, px) + R(56, 46.8, 7.2, 2.4, 0, px) + R(36.8, 44.4, 2.4, 2.4, 0, "#fff") + R(56, 44.4, 2.4, 2.4, 0, "#fff") + R(39.2, 46.8, 2.4, 2.4, 0, "#fff", ' opacity=".6"') + R(58.4, 46.8, 2.4, 2.4, 0, "#fff", ' opacity=".6"');
      default: return "";
    }
  }

  /* ---------- Neckwear (over the top) ---------- */
  function neckSVG(n, s) {
    var G = "#d6a93a";
    function chain(y, col, dash) { return S("M39.6,75.6 Q50," + y + " 60.4,75.6", col || G, 1.1, ' stroke-dasharray="' + (dash || "1.2 .7") + '"'); }
    switch (n) {
      case 1: var sc = "#b3242c"; return cel("M37.6,70.4 C44,74.6 56,74.6 62.4,70.4 L64.2,78.4 C56,82.4 44,82.4 35.8,78.4Z", sc, { w: [1, 1], v: [0.6, 0.6] }) + cel("M54,78.6 L60.4,78 L62.6,96 L55.4,97.4Z", shade(sc, -0.08), { w: [1, 1], v: [0.6, 0.6] }) + S("M38,75 C44,78 56,78 62,75 M55,83.6 L61,83 M55.6,89 L61.6,88.4", "#f2d6a2", 1.1, ' opacity=".8"') + S("M55.6,97.6 L55.2,99.6 M57.6,97.2 L57.4,99.4 M59.6,96.8 L59.6,99 M61.6,96.4 L61.8,98.6", sc, 0.6);
      case 2: var tc = "#c8202a"; return P("M41.6,75 L50,81 L46,85Z", "#f7f6f1") + P("M58.4,75 L50,81 L54,85Z", "#f7f6f1") + cel("M47.6,77.6 L52.4,77.6 L51.6,81.4 L48.4,81.4Z", shade(tc, -0.1), { w: [0.6, 0.5], v: [0.4, 0.4] }) + cel("M48.4,81.4 L51.6,81.4 L54.4,95 L50,99.6 L45.6,95Z", tc, { w: [1, 1], v: [0.5, 0.5] }) + S("M47.2,86 L52.8,84.4 M46.6,90 L53.6,88 M46.2,94 L54,91.6", "#f5c518", 0.6, ' opacity=".8"');
      case 3: var bc = "#c8202a"; return cel("M50,79 L42.4,75 L42.4,83 Z", bc, { w: [0.8, 0.6], v: [0.5, 0.5] }) + cel("M50,79 L57.6,75 L57.6,83 Z", bc, { w: [0.8, 0.6], v: [0.5, 0.5] }) + cel(dR(48, 76.8, 4, 4.4, 1.2), shade(bc, 0.15), { w: [0.5, 0.5], v: [0.3, 0.3] }) + C(44.6, 77.4, 0.4, "#fff") + C(44.6, 80.6, 0.4, "#fff") + C(55.4, 77.4, 0.4, "#fff") + C(55.4, 80.6, 0.4, "#fff");
      case 4: return chain(88);
      case 5: return chain(86) + '<g transform="translate(44.2 80.4) scale(.74)">' + P(DALA, "#c8202a", ' stroke="#7a0f16" stroke-width=".5"') + S("M8.4,5.4 C9.4,7.6 11.6,7.6 12.6,5.4", "#f5c518", 0.8) + S("M8.8,7.8 L12.2,7.8", "#2f6fb8", 0.6) + C(4.6, 2.8, 0.5, "#fff") + S("M5.6,4.4 C6.4,5.4 6.6,6.6 6,7.6", "#f5c518", 0.6) + "</g>";
      case 6: var pr = ""; for (var i = 0; i <= 10; i++) { var t = i / 10, x = f2(39 + 22 * t), y = f2(75.4 + 4 * (1 - Math.pow(2 * t - 1, 2)) * 2.2); pr += C(x, y, 1.15, "#f6f1e6") + C(x - 0.35, y - 0.35, 0.35, "#fff"); } return pr;
      case 7: var nc = "#f2c230"; return cel("M38.4,74 C44,78 56,78 61.6,74 L50,91Z", nc, { w: [1, 1], v: [0.6, 0.6] }) + cel(dR(47.6, 79.6, 4.8, 3.6, 1.6), "#6b4426", { w: [0.5, 0.5], v: [0.3, 0.3] }) + S("M41,75.6 C45,78.6 55,78.6 59,75.6", shade(nc, -0.3), 0.6);
      case 8: var B = "#2f6fb8", Y = "#f5c518"; return cel("M37.4,70.6 C44,75 56,75 62.6,70.6 L64.4,78.6 C56,82.6 44,82.6 35.6,78.6Z", B, { w: [1, 1], v: [0.6, 0.6] }) + P("M36.6,74.4 C44,78.4 56,78.4 63.4,74.4 L63.8,76.6 C56,80.6 44,80.6 36.2,76.6Z", Y) +
        cel("M42,78.4 L48,79.4 L46.6,98 L40,97Z", B, { w: [1, 1], v: [0.6, 0.6] }) + P("M41.4,84 L47.6,85 L47.3,88.4 L41,87.4Z", Y) + P("M40.8,91.2 L47,92.2 L46.8,95.2 L40.4,94.4Z", Y) + S("M40.4,97.4 L40,99.6 M42.4,97.6 L42.2,99.8 M44.4,97.8 L44.4,100 M46.4,98 L46.6,100", Y, 0.6);
      case 9: return S("M40,75.4 L49,89 M60,75.4 L53,88", "#b9bec6", 0.8, ' stroke-dasharray=".8 .5"') + '<g transform="rotate(-12 50 92)">' + cel(dR(46, 88, 7, 10, 2.4), "#c9ced6", { w: [0.6, 0.6], v: [0.4, 0.4], hk: 0.3 }) + S("M47.6,91 L51.4,91 M47.6,93 L51.4,93 M47.6,95 L50.4,95", "#7a828c", 0.45) + "</g>" + '<g transform="rotate(10 55 91)">' + cel(dR(52, 87, 7, 10, 2.4), "#b9bec6", { w: [0.6, 0.6], v: [0.4, 0.4], hk: 0.3 }) + "</g>";
      case 10: return chain(86) + C(50, 83.8, 3, "#c9a227") + C(50, 83.8, 2, "#e8c95a") + '<circle cx="50" cy="83.8" r="3" fill="none" stroke="#a07e1a" stroke-width=".7" stroke-dasharray=".7 .5"/>' + C(49.2, 83, 0.6, "#fff6cc");
      case 11: return R(41, 68.4, 18, 3, 1.2, "#17181c") + '<circle cx="50" cy="72.6" r="1.3" fill="none" stroke="#c9ced6" stroke-width=".6"/>';
      case 12: return P("M41,75 L48.4,90 L51.6,90 L59,75 L55.4,75 L50,86 L44.6,75Z", "#2f6fb8") + P("M44,75 L49.2,87 L50.8,87 L56,75 L54,75 L50,83.6 L46,75Z", "#f5c518") + cel(dC(50, 93, 4.6), "#e9b93a", { w: [1, 1], v: [0.6, 0.6], hk: 0.3 }) + P(star(50, 93, 2.6), "#fff6cc", ' opacity=".9"');
      case 13: var lc = TOPC[(s.uc + 3) % 8]; return S("M40,75.4 Q44,88 50.4,90.4 M60,75.4 Q57,88 51.6,90.4", lc, 1) + cel("M48.6,89.6 L57.4,89.6 C59,89.6 59.6,91 59.6,92.4 C59.6,95 57.4,96.4 55,96 L51.4,95.4 C49.4,95 48.4,93.4 48.6,91.6Z", "#c9ced6", { w: [0.6, 0.6], v: [0.4, 0.4], hk: 0.35 }) + C(56.4, 93, 1.2, "#5a626c");
      case 14: var bl = ""; for (var j = 0; j <= 8; j++) { var tt = j / 8, xx = f2(38.6 + 22.8 * tt), yy = f2(75.6 + 8.6 * (1 - Math.pow(2 * tt - 1, 2))); bl += E(xx, yy + 1.2, 0.95, 1.4, ["#ff5a5a", "#ffd36b", "#3ddc84", "#4aa3ff", "#ff8fc4"][j % 5]) + C(xx - 0.3, yy + 0.8, 0.3, "#fff", ' opacity=".7"'); }
        return S("M38.6,75.6 Q50,92.8 61.4,75.6", "#2c5a3a", 0.7) + bl;
      case 15: var gc = ""; for (var q = 0; q <= 9; q++) { var u = q / 9, gx = f2(38.4 + 23.2 * u), gy = f2(75.4 + 13 * (1 - Math.pow(2 * u - 1, 2))); gc += '<ellipse cx="' + gx + '" cy="' + gy + '" rx="1.6" ry="1.1" fill="none" stroke="' + (q % 2 ? "#e9b93a" : "#c9952a") + '" stroke-width="1" transform="rotate(' + f2((u - 0.5) * -70) + " " + gx + " " + gy + ')"/>'; } return gc;
      default: return "";
    }
  }

  /* ---------- Tops ---------- */
  var SHOULDERS = "M4,100 C6,84 22,77 38,75 L62,75 C78,77 94,84 96,100Z";
  function rankMark(r, x, y, col) {   // small rank insignia
    r = r | 0; var h = "";
    if (r >= 20) { h += C(x, y, 2.2, "#ffc24d") + C(x + 5, y, 2.2, "#ffc24d") + S("M" + (x - 3) + "," + (y + 3.5) + " L" + (x + 8) + "," + (y + 3.5), "#ffc24d", 1); }
    else if (r >= 11) { var n = r >= 17 ? 3 : r >= 14 ? 2 : 1; for (var i = 0; i < n; i++) h += P(star(x + i * 4.2, y, 1.8), "#ffc24d"); }
    else { var c = Math.max(1, Math.min(3, Math.ceil(r / 3))); for (var j = 0; j < c; j++) h += S("M" + (x - 2.5) + "," + (y + j * 2.2 - 1) + " L" + x + "," + (y + j * 2.2 + 1) + " L" + (x + 2.5) + "," + (y + j * 2.2 - 1), col || "#ffc24d", 1); }
    return h;
  }
  var ribMemo = {};
  function ribbonStops(id) {
    if (ribMemo[id]) return ribMemo[id];
    var out = [];
    try {
      var bg = window.MEDALS && window.MEDALS.ribbonBg ? window.MEDALS.ribbonBg(id) : "";
      var re = /(#[0-9a-fA-F]{3,8})\s+([\d.]+)%\s+([\d.]+)%/g, m;
      while ((m = re.exec(bg))) out.push([m[1], +m[2], +m[3]]);
    } catch (e) { out = []; }
    if (!out.length) { var h = hashStr(id), cs = ["#b3121b", "#1f6fb8", "#1fa45c", "#f5a623", "#6b2d8f"]; out = [[cs[h % 5], 0, 30], [cs[(h >> 3) % 5], 30, 70], [cs[h % 5], 70, 100]]; }
    ribMemo[id] = out;
    return out;
  }
  function ribbonsSVG(md) {
    if (!md || !md.length || LITE) return "";
    var h = "", w = 6.4, hh = 3.2, x0 = 58, y0 = 84;
    md.slice(0, 6).forEach(function (id, i) {
      var x = x0 + (i % 3) * (w + 0.8), y = y0 + Math.floor(i / 3) * (hh + 0.9);
      ribbonStops(id).forEach(function (s) { h += '<rect x="' + (x + w * s[1] / 100).toFixed(2) + '" y="' + y + '" width="' + (w * (s[2] - s[1]) / 100 + 0.05).toFixed(2) + '" height="' + hh + '" fill="' + s[0] + '"/>'; });
      h += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + hh + '" fill="none" stroke="rgba(0,0,0,.45)" stroke-width=".4"/>';
    });
    return h;
  }
  function topMain(s) {   // colour of the sleeve (held item arm)
    var u = s.up, col = hexOf(s.ux) || TOPC[s.uc];
    return [col, col, col, col, "#59613a", "#2f3b26", "#24301f", "#14223f", "#121212", "#1f5fb0", "#f6c518", col, "#f5c518", "#3f6a9a", "#1b1b1f", col, col, null, "#f4f2ec", col, col, col, "#f4f2ec", "#b3242c", "#141414", "#f4f2ec", "#7d8a5a", "#6b4426", "#14223f", "#f4f2ec", "#1f2733"][u] || col;
  }
  function topSVG(s, r, md, skin) {
    var u = s.up, col = hexOf(s.ux) || TOPC[s.uc], h = "", dk = shade(col, -0.25), lt = lum(col) > 0.62;
    var T = function (c) { return cel(SHOULDERS, c, { w: [2.6, 1.6], v: [1, 1] }); };
    var neckLine = S("M41,75.5 Q50,84 59,75.5", dk, 2);
    var GOLD = "#ffc24d";
    if (u === 0) h = T(col) + neckLine;
    else if (u === 1) h = P("M30,80 C28,68 40,64 50,64 C60,64 72,68 70,80Z", dk) + T(col) + P("M38,75 C40,86 60,86 62,75 L58,75 C56,81 44,81 42,75Z", dk) + S("M45,82 L44.5,92 M55,82 L55.5,92", "#eef0ec", 1.1) + R(40, 93, 20, 7, 2, shade(col, -0.1));
    else if (u === 2) {
      h = T(col);
      for (var i = 0; i < 6; i++) h += S("M" + (10 + i * 16) + ",76 L" + (10 + i * 16) + ",100", dk, 3, ' opacity=".6"');
      h += S("M4,88 L96,88 M4,96 L96,96", dk, 2.2, ' opacity=".55"') + P("M40,75 L50,86 L60,75 L56,74 L50,80 L44,74Z", shade(col, 0.25)) + C(50, 90, 0.8, dk) + C(50, 96, 0.8, dk);
    } else if (u === 3) h = T(col) + P("M22,79 C26,77 30,76 34,75.6 L36,100 L28,100Z", "#eef0ec", ' opacity=".9"') + P("M78,79 C74,77 70,76 66,75.6 L64,100 L72,100Z", "#eef0ec", ' opacity=".9"') + P("M42,75 L50,84 L58,75Z", dk);
    else if (u === 4) {
      var o = "#59613a";
      h = T(o) + P("M20,82 C26,78 30,80 34,84 C28,88 22,88 20,82Z", "#3f4527") + P("M70,90 C76,86 84,88 86,94 C80,96 74,96 70,90Z", "#7a7d4a") + P("M44,96 C48,92 54,94 56,100 L44,100Z", "#3f4527");
      h += P("M37,75 L50,86 L44,90 L33,78Z", "#4a5230") + P("M63,75 L50,86 L56,90 L67,78Z", "#4a5230") + S("M50,86 L50,100", "#3f4527", 1);
      h += R(39, 90, 7, 6, 1, "#2a2f1a") + rankMark(r, 42.5, 93, "#e8e6c8");
    } else if (u === 5 || u === 6 || u === 7) {
      var base = u === 5 ? "#2f3b26" : u === 6 ? "#24301f" : "#14223f";
      h = T(base) + P("M42,75 L50,92 L58,75Z", "#eef0ec") + P("M48.4,78 L51.6,78 L52.6,90 L50,93 L47.4,90Z", u === 7 ? "#111" : "#3f2a14");
      h += P("M38,75 L50,94 L46,100 L33,79Z", shade(base, 0.12)) + P("M62,75 L50,94 L54,100 L67,79Z", shade(base, 0.12));
      h += C(50, 96, 1, GOLD);
      h += '<rect x="18" y="81.4" width="13" height="4" rx="2" transform="rotate(-18 24 83.4)" fill="' + (u === 5 ? shade(base, 0.2) : GOLD) + '"/><rect x="69" y="81.4" width="13" height="4" rx="2" transform="rotate(18 76 83.4)" fill="' + (u === 5 ? shade(base, 0.2) : GOLD) + '"/>';
      if (u === 6) h += S("M62,80 C70,90 76,92 84,88", GOLD, 1.3) + S("M38,78 L42,84 M62,78 L58,84", GOLD, 1.6);
      if (u === 7) h += S("M8,96 L20,96 M80,96 L92,96", GOLD, 1.5);
      h += rankMark(r, u === 5 ? 20 : 19, 81);
    } else if (u === 8) h = T("#121212") + P("M42,75 L50,94 L58,75Z", "#f4f4f2") + P("M38,75 L50,96 L46,100 L33,79Z", "#232323") + P("M62,75 L50,96 L54,100 L67,79Z", "#232323") + P("M45.5,77 L50,79 L54.5,77 L54.5,82 L50,80 L45.5,82Z", "#111") + C(50, 86, 0.7, "#111") + C(50, 90, 0.7, "#111");
    else if (u === 9) {   // hockey: blue + yellow stripes, lace collar (no crest)
      var hb = "#1f5fb0", hy = "#f5c518";
      h = T(hb) + P("M8,90 C10,86 12,84 15,82 L19,96 L6,100Z", hy) + P(mir("M8,90 C10,86 12,84 15,82 L19,96 L6,100Z"), hy) + R(4, 94, 92, 3, 0, "#f4f2ec", ' opacity=".9"') + P("M38,75 C40,80 44,82 50,82 C56,82 60,80 62,75 L58,75 C56,78 54,79 50,79 C46,79 44,78 42,75Z", hy) +
        P("M47.6,79.6 L52.4,79.6 L50,88Z", "#f4f2ec") + S("M48.2,82 L51.8,83 M48.6,84.6 L51.4,85.6", hb, 0.6);
    } else if (u === 10) {   // football: yellow + blue trims (no crest)
      var fy = "#f6c518", fb = "#1f5fb0";
      h = T(fy) + P("M41,75 L50,85 L59,75 L56.4,75 L50,82 L43.6,75Z", fb) + P("M4,100 C5,92 8,86 12,83 L16,85 C12,88 9,94 8.6,100Z", fb) + P(mir("M4,100 C5,92 8,86 12,83 L16,85 C12,88 9,94 8.6,100Z"), fb) + S("M30,78 L32,100 M70,78 L68,100", shade(fy, -0.15), 0.8, ' opacity=".8"');
    } else if (u === 11) {   // Dala sweater: knit yoke with small horses and zigzags
      var yk = "#f4f0e6", rd = "#c8202a";
      h = T(col) + cel("M17,83 C26,77.6 36,75.4 50,75.4 C64,75.4 74,77.6 83,83 L86.6,89.6 C74,85.6 62,84.4 50,84.4 C38,84.4 26,85.6 13.4,89.6Z", yk, { w: [1.2, 1], v: [0.6, 0.6] }) +
        S("M16,87.6 L19,85.4 L22,87.6 L25,85.4 L28,87.6 L31,85.4 L34,87.6 M66,87.6 L69,85.4 L72,87.6 L75,85.4 L78,87.6 L81,85.4 L84,87.6", rd, 0.8) + S("M40,78 L43,80 M57,80 L60,78", rd, 0.8) +
        [[24, 79.4], [70, 79.4]].map(function (q) { return '<g transform="translate(' + q[0] + " " + q[1] + ') scale(.42)">' + P(DALA, rd) + "</g>"; }).join("") + S("M8,96 L92,96", yk, 1.4, ' stroke-dasharray="2 1.4"') + neckLine;
    } else if (u === 12) {   // raincoat
      var rc = "#f5c518";
      h = cel("M33,77 C34,67 66,67 67,77Z", shade(rc, -0.12), { w: [1, 1], v: [0.6, 0.6] }) + T(rc) + P("M42,75 L50,84 L58,75 L54,75 L50,80 L46,75Z", shade(rc, -0.3)) + S("M50,84 L50,100", shade(rc, -0.35), 1) + C(53, 88, 0.9, shade(rc, -0.35)) + C(53, 94, 0.9, shade(rc, -0.35)) + S("M20,86 L30,86 M70,86 L80,86", shade(rc, -0.25), 0.8);
    } else if (u === 13) {   // denim jacket over a tee
      var dn = "#3f6a9a";
      h = T(dn) + P("M42,75 L50,92 L58,75Z", col) + P("M37,75 L48,92 L42,96 L31,79Z", shade(dn, 0.14)) + P("M63,75 L52,92 L58,96 L69,79Z", shade(dn, 0.14)) + R(26, 86, 9, 7, 1, shade(dn, -0.12)) + R(65, 86, 9, 7, 1, shade(dn, -0.12)) +
        S("M26.6,87 L34.4,87 M65.6,87 L73.4,87 M14,90 L22,100 M86,90 L78,100", "#e8a14a", 0.5, ' stroke-dasharray="1 .7"') + C(30.5, 90, 0.7, "#c9ced6") + C(69.5, 90, 0.7, "#c9ced6");
    } else if (u === 14) {   // leather jacket
      var lb = "#1b1b1f";
      h = T(lb) + P("M43,75 L50,86 L57,75Z", "#f4f2ec") + P("M37,75 L52,96 L46,100 L31,80Z", "#28282e") + P("M63,75 L56,86 L60,92 L69,80Z", "#28282e") + S("M52,90 L56,100", "#c9ced6", 1) + S("M54,84 L66,82 M40,92 L30,90", "#c9ced6", 0.6) + C(36, 82, 0.8, "#c9ced6") + C(64, 79.6, 0.8, "#c9ced6") + S("M14,86 C20,84 26,84 30,86", "#fff", 0.6, ' opacity=".25"');
    } else if (u === 15) {   // blazer
      h = T(col) + P("M42,75 L50,92 L58,75Z", "#f7f6f1") + P("M38,75 L50,95 L46,100 L33,79Z", shade(col, -0.14)) + P("M62,75 L50,95 L54,100 L67,79Z", shade(col, -0.14)) + C(50, 97, 0.9, shade(col, -0.4)) + R(66, 86, 8, 1.6, 0.6, shade(col, -0.25));
    } else if (u === 16) {   // polo
      var pk = lt ? shade(col, -0.35) : "#f4f2ec"; h = T(col) + P("M38,74.6 L47.6,80.6 L43,86 L34.6,77.4Z", pk) + P("M62,74.6 L52.4,80.6 L57,86 L65.4,77.4Z", pk) + R(47.6, 78, 4.8, 11, 1, pk) + C(50, 81, 0.6, "#f4f2ec") + C(50, 85, 0.6, "#f4f2ec");
    } else if (u === 17) {   // tank top (bare shoulders)
      h = cel(SHOULDERS, skin, { w: [2.6, 1.6], v: [1, 1] }) + cel("M28,100 L31,79.4 C35,78 37.4,76.6 39,75.4 C42,83 58,83 61,75.4 C62.6,76.6 65,78 69,79.4 L72,100Z", col, { w: [1.6, 1.2], v: [0.8, 0.8] }) + S("M32,80 L28.6,100 M68,80 L71.4,100", dk, 0.7, ' opacity=".5"');
    } else if (u === 18) {   // breton stripes
      var nv = s.uc === 6 ? "#1d2b53" : col;
      h = T("#f4f2ec");
      for (var b = 0; b < 6; b++) h += '<clipPath id="' + ID + 'st' + b + '"><path d="' + SHOULDERS + '"/></clipPath>' + R(0, 79 + b * 4, 100, 1.9, 0, nv, ' clip-path="url(#' + ID + "st" + b + ')"');
      h += S("M40.6,75.4 Q50,82 59.4,75.4", nv, 1.4);
    } else if (u === 19) {   // turtleneck
      h = T(col) + cel("M41,64.6 C44,63.2 56,63.2 59,64.6 L60,77.4 C56,79 44,79 40,77.4Z", shade(col, -0.06), { w: [1, 0.8], v: [0.6, 0.6] }) + S("M43,66 L43,77 M46,65.4 L46,78 M49,65.2 L49,78.4 M52,65.2 L52,78.4 M55,65.4 L55,78 M58,66 L58,77", dk, 0.5, ' opacity=".55"');
    } else if (u === 20) {   // puffer
      h = T(col) + S("M8,90 C30,85 70,85 92,90 M5,98 C30,93 70,93 95,98 M20,80.6 C34,78 66,78 80,80.6", dk, 1.1, ' opacity=".7"') + cel("M38,70 C44,68 56,68 62,70 L63,78 C56,80.4 44,80.4 37,78Z", shade(col, 0.08), { w: [1, 0.8], v: [0.6, 0.6] }) + S("M50,78.6 L50,100", "#c9ced6", 0.9);
    } else if (u === 21) {   // student overall with patches
      h = T(col) + P("M42,75 L50,84 L58,75Z", "#f4f2ec") + S("M50,84 L50,100", shade(col, -0.35), 1.1) + R(36, 76, 3, 24, 1, shade(col, -0.12)) + R(61, 76, 3, 24, 1, shade(col, -0.12));
      [[24, 86, "#f5c518", 0], [32, 93, "#1fa45c", 1], [16, 94, "#c8202a", 2], [72, 84, "#4aa3ff", 1], [80, 92, "#ff8fc4", 0], [66, 94, "#f4f2ec", 2], [42, 94, "#e8722a", 0]].forEach(function (q) {
        h += q[3] === 0 ? C(q[0], q[1], 2.6, q[2], ' stroke="#fff" stroke-width=".5"') : q[3] === 1 ? R(q[0] - 2.4, q[1] - 2, 4.8, 4, 0.8, q[2], ' stroke="#fff" stroke-width=".5"') : P(star(q[0], q[1], 2.8), q[2], ' stroke="#fff" stroke-width=".4"');
      });
    } else if (u === 22) {   // folk costume: white blouse + red bodice
      h = T("#f7f5ee") + cel("M30,100 L33,82 C38,80 43,79.6 44,79.6 L50,90 L56,79.6 C57,79.6 62,80 67,82 L70,100Z", "#c8202a", { w: [1.4, 1], v: [0.6, 0.6] }) + S("M33,82.4 C38,80.4 43,80 44,80 L50,90.4 L56,80 C57,80 62,80.4 67,82.4", "#1f7a3a", 1.2) +
        S("M47,92 L53,92 M46.6,95.4 L53.4,95.4", "#f5c518", 0.9) + C(50, 98, 1.1, "#c9ced6") + P("M43,75 C45,78 55,78 57,75 L56,77.6 C54,79.6 46,79.6 44,77.6Z", "#e9e4d6") + S("M44,76.6 Q50,79.4 56,76.6", "#c8202a", 0.5, ' stroke-dasharray=".6 .6"');
    } else if (u === 23) {   // christmas jumper
      var jr = "#b3242c";
      h = T(jr) + R(4, 86, 92, 6, 0, "#f4f2ec") + S("M6,89 L9,87 L12,89 L15,87 L18,89 L21,87 L24,89 M76,89 L79,87 L82,89 L85,87 L88,89 L91,87 L94,89", jr, 0.8) + P("M50,80 L44,92 L56,92Z", "#1f7a3a") + P("M50,84.6 L45.4,93.6 L54.6,93.6Z", "#2c8a46") + R(49, 93.4, 2, 2.4, 0, "#6b4426") + P(star(50, 79.6, 1.6), "#f5c518") +
        C(47, 88, 0.6, "#ffd36b") + C(53, 90, 0.6, "#4aa3ff") + C(50, 91.6, 0.6, "#ff8fc4") + S("M30,96 L32,98 L34,96 M66,96 L68,98 L70,96", "#f4f2ec", 0.8) + neckLine;
    } else if (u === 24) {   // skeleton top
      var bw = "#e8e6df";
      h = T("#141414") + S("M50,77 L50,100", bw, 1.6) + S("M50,82 C44,80 38,81 34,84 M50,82 C56,80 62,81 66,84 M50,87 C44,85 37,86 32,90 M50,87 C56,85 63,86 68,90 M50,92 C44,90.4 37,91.4 31,96 M50,92 C56,90.4 63,91.4 69,96", bw, 1.2) + S("M38,76 C34,77 30,78 26,80 M62,76 C66,77 70,78 74,80", bw, 1.2);
    } else if (u === 25) {   // sailor top
      var nb = "#1d2b53";
      h = T("#f4f2ec") + P("M36,75.6 L50,92 L64,75.6 L72,78 L68,90 L50,96 L32,90 L28,78Z", nb) + P("M40,75.6 L50,88 L60,75.6 L57,75.6 L50,84 L43,75.6Z", "#f4f2ec") + S("M30,80 L34,89 M70,80 L66,89", "#f4f2ec", 0.6) + P("M47,88 L53,88 L51.6,92 L54,98 L50,96 L46,98 L48.4,92Z", "#c8202a");
    } else if (u === 26) {   // splinter camo
      var cm = "#7d8a5a";
      h = T(cm) + '<clipPath id="' + ID + 'cm"><path d="' + SHOULDERS + '"/></clipPath><g clip-path="url(#' + ID + 'cm)">' +
        P("M6,90 L20,80 L28,86 L16,100 L4,100Z", "#3f4a2c") + P("M30,80 L44,78 L40,90 L28,94Z", "#a59e6c") + P("M62,79 L76,84 L70,96 L58,90Z", "#3f4a2c") + P("M78,86 L94,90 L96,100 L80,100Z", "#a59e6c") + P("M44,92 L56,90 L58,100 L42,100Z", "#56603a") +
        S("M10,84 L22,96 M66,80 L84,98 M34,86 L46,98", "#2a311d", 0.5, ' opacity=".6"') + "</g>" + P("M42,75 L50,84 L58,75Z", "#56603a") + R(62, 86, 8, 6, 1, "#56603a") + rankMark(r, 66, 89, "#e8e6c8");
    } else if (u === 27) {   // flight jacket with shearling collar
      var lj = "#6b4426";
      h = T(lj) + cel("M34,74 C38,70 46,72 50,80 C54,72 62,70 66,74 L70,82 C64,82 56,84 50,90 C44,84 36,82 30,82Z", "#efe6d2", { w: [1, 0.8], v: [0.6, 0.6], k: 0.12 }) + S("M50,90 L50,100", "#c9ced6", 1) + R(20, 88, 10, 2, 0.8, shade(lj, -0.3)) + R(70, 88, 10, 2, 0.8, shade(lj, -0.3)) + S("M14,84 C20,82 26,82 30,84", "#fff", 0.6, ' opacity=".2"');
    } else if (u === 28) {   // dress uniform: white cross belts, gold buttons, red piping
      var du = "#14223f";
      h = T(du) + P("M40.6,75 L50,79.4 L59.4,75 L59.4,78.8 L50,83 L40.6,78.8Z", "#b3242c") + S("M28,80 L64,100 M72,80 L36,100", "#f4f2ec", 2.6) + C(50, 86, 1.1, GOLD) + C(50, 91, 1.1, GOLD) + C(50, 96, 1.1, GOLD) +
        '<rect x="18" y="81.4" width="13" height="4" rx="2" transform="rotate(-18 24 83.4)" fill="' + GOLD + '"/><rect x="69" y="81.4" width="13" height="4" rx="2" transform="rotate(18 76 83.4)" fill="' + GOLD + '"/>' + S("M18,86.4 L30,86.4", "#b3242c", 0.8) + rankMark(r, 19, 81);
    } else if (u === 29) {   // bartender vest
      h = T("#f4f2ec") + cel("M24,100 L26,82 C30,80 36,78 40,76.4 L50,94 L60,76.4 C64,78 70,80 74,82 L76,100Z", "#1d1d22", { w: [1.4, 1], v: [0.6, 0.6], hk: 0.14 }) + C(50, 97, 0.8, "#c9ced6") + R(30, 88, 7, 1.4, 0.6, "#3a3a40") + R(63, 88, 7, 1.4, 0.6, "#3a3a40") +
        P("M50,79 L45.6,76.6 L45.6,81.4Z", "#c8202a") + P("M50,79 L54.4,76.6 L54.4,81.4Z", "#c8202a") + C(50, 79, 0.9, "#7a0f16") + S("M40.6,76 L44,79.4 M59.4,76 L56,79.4", "#d9d6cc", 0.6);
    } else if (u === 30) {   // hi-vis vest over a dark tee
      var hv = "#c6f03a";
      h = T("#1f2733") + cel("M20,100 L23,81 C28,79 34,77.4 39,76 C42,84 58,84 61,76 C66,77.4 72,79 77,81 L80,100Z", hv, { w: [1.4, 1], v: [0.6, 0.6] }) + R(22, 88, 56, 2.6, 0, "#d9dee6") + R(21, 94, 58, 2.6, 0, "#d9dee6") + S("M50,84 L50,100", shade(hv, -0.3), 0.7);
    }
    if (md && md.length) h += ribbonsSVG(md);
    return h;
  }

  /* ---------- Backgrounds ---------- */
  function bgSVG(b, s) {
    var id = ID, X = hexOf(s.bx);
    function full(c) { return R(0, 0, 100, 100, 0, c); }
    function stars(list, c) { return list.map(function (p) { return C(p[0], p[1], p[2] || 0.7, c || "#fff"); }).join(""); }
    function sky(a, z) { var n = nid(); return "<defs>" + grad(n, 0, 0, 0, 100, [[0, a], [1, z]]) + "</defs>" + R(0, 0, 100, 100, 0, "url(#" + n + ")"); }
    if (b < 8) return full(BGC[b]);
    switch (b) {
      case 8: return full("#5b6338") + P("M0,20 C14,10 24,26 38,18 C46,30 30,38 14,34 C6,32 2,28 0,30Z", "#3f4527") + P("M60,4 C74,0 88,10 100,6 L100,30 C88,34 76,24 66,28 C58,22 54,12 60,4Z", "#7a7d4a") + P("M70,46 C84,40 96,52 100,48 L100,70 C90,74 80,62 72,64Z", "#3f4527") + P("M0,52 C10,46 20,58 26,66 C16,72 6,66 0,70Z", "#7a7d4a");
      case 9: return full("#3a0d0d") + P("M0,100 L0,62 C8,70 10,52 18,46 C18,60 26,62 28,50 C34,58 34,68 40,60 C44,52 42,44 48,36 C50,50 58,52 56,62 C62,58 66,50 64,40 C72,48 74,60 80,56 C84,50 82,42 86,38 C88,50 96,54 100,48 L100,100Z", "#ff7a1a") + P("M0,100 L0,78 C10,82 14,68 22,66 C22,76 30,78 34,70 C40,78 46,74 50,66 C54,76 62,78 66,70 C70,78 78,76 82,68 C86,76 94,78 100,72 L100,100Z", "#ffc24d");
      case 10: return full("#0b1638") + P("M-4,40 C20,20 40,46 60,26 C74,14 90,22 104,12 L104,24 C90,34 76,26 62,38 C42,56 22,32 -4,52Z", "#3ddc84", ' opacity=".75"') + P("M-4,58 C18,44 38,62 58,46 C74,34 92,44 104,36 L104,44 C92,52 76,44 60,54 C40,68 20,52 -4,64Z", "#b26bff", ' opacity=".55"') + C(18, 14, 0.9, "#fff") + C(80, 8, 0.7, "#fff") + C(46, 10, 0.6, "#fff");
      case 11: return "<defs>" + rgrad(id + "g", 50, 40, 65, [[0, "#fff1b8"], [0.55, "#f5c542"], [1, "#a86a00"]]) + "</defs>" + R(0, 0, 100, 100, 0, "url(#" + id + "g)") + '<circle cx="50" cy="50" r="47" fill="none" stroke="#fff6cc" stroke-width="1.5" opacity=".7"/>';
      case 12: return sky("#5aa9f0", "#cfeaff") + P("M8,24 C8,19 15,18 17,21 C19,16 27,17 27,22 C31,22 32,27 28,28 L10,28 C6,28 5,25 8,24Z", "#fff", ' opacity=".9"') + P("M66,14 C66,10 72,9 74,12 C76,8 83,9 83,13 C86,13 87,17 84,18 L68,18 C64,18 63,15 66,14Z", "#fff", ' opacity=".85"');
      case 13: return sky("#ff7a45", "#ffd27a") + C(78, 64, 14, "#fff1b0", ' opacity=".85"') + R(0, 70, 100, 30, 0, "#e0603a", ' opacity=".35"') + S("M0,74 L100,74 M0,80 L100,80", "#fff1b0", 0.8, ' opacity=".4"');
      case 14: return full("#7fd6b8");
      case 15: return full("#2b2f36") + C(20, 18, 14, "#343944") + C(84, 76, 18, "#343944");
      case 16: return full(X || "#f5a623");
      case 17: var sc = X || "#2f6fb8", sh = "", sl = shade(sc, 0.18); for (var i = -100; i < 200; i += 14) sh += P("M" + i + ",0 L" + (i + 7) + ",0 L" + (i - 93) + ",100 L" + (i - 100) + ",100Z", sl); return full(sc) + sh;
      case 18: var dc = X || "#c8202a", dt = ""; for (var y = 6; y < 100; y += 12) for (var x = ((y / 12) % 2 ? 12 : 6); x < 100; x += 12) dt += C(x, y, 2.2, shade(dc, 0.35)); return full(dc) + dt;
      case 19: var gc = X || "#c8202a", gg = full("#f7f3ea"); for (var g = 0; g < 100; g += 10) gg += R(g, 0, 5, 100, 0, gc, ' opacity=".55"') + R(0, g, 100, 5, 0, gc, ' opacity=".55"'); return gg;
      case 20: var dh = full(X || "#c8202a"), hc = X ? shade(X, 0.4) : "#f5c518"; [[4, 6], [30, 4], [64, 6], [86, 10], [10, 34], [80, 34], [4, 62], [84, 60], [12, 86], [76, 84], [40, 2]].forEach(function (q, i) { dh += '<g transform="translate(' + q[0] + " " + q[1] + ') scale(.9)">' + P(DALA, i % 3 ? hc : "#2f6fb8") + S("M8.4,5.4 C9.4,7.8 11.8,7.8 12.8,5.4 M8.8,8.4 L12.4,8.4", i % 3 ? "#2f6fb8" : "#f5c518", 0.8) + S("M5.4,4.2 C6.2,5.2 6.4,6.4 5.8,7.4", "#fff", 0.6) + C(4.4, 2.8, 0.45, "#fff") + "</g>"; }); return dh;
      case 21: return full("#2f6fb8") + R(28, 0, 14, 100, 0, "#f5c518") + R(0, 43, 100, 14, 0, "#f5c518");
      case 22: return sky("#8fc9ff", "#e8f6ff") + P("M0,72 C20,66 40,70 60,66 C80,62 92,66 100,64 L100,100 L0,100Z", "#5cae4e") + P("M0,82 C30,76 60,82 100,76 L100,100 L0,100Z", "#4a9a3f") +
        R(16.4, 20, 2.6, 58, 0, "#6b4426") + R(8, 28, 19.4, 2.4, 0, "#6b4426") + '<circle cx="11" cy="36" r="4.4" fill="none" stroke="#3c8a3a" stroke-width="2"/><circle cx="24.4" cy="36" r="4.4" fill="none" stroke="#3c8a3a" stroke-width="2"/>' + S("M17.7,22 C14,28 13,34 17.7,40 C22,34 21,28 17.7,22", "#3c8a3a", 1.6) +
        [[8, 88, "#fff"], [26, 92, "#f5c518"], [74, 90, "#ff8fc4"], [88, 86, "#fff"], [60, 94, "#6f9bff"], [40, 96, "#fff"]].map(function (q) { return C(q[0], q[1], 1.4, q[2]) + C(q[0], q[1], 0.6, "#f5c518"); }).join("");
      case 23: return sky("#071029", "#13305a") + P("M-4,30 C18,14 34,36 54,20 C68,10 86,18 104,8 L104,22 C86,32 70,22 56,34 C36,50 18,28 -4,46Z", "#3ddc84", ' opacity=".7"') + P("M-4,46 C22,32 40,50 62,36 C76,28 92,36 104,30 L104,38 C90,44 76,38 62,48 C40,62 20,44 -4,56Z", "#22b3a0", ' opacity=".45"') +
        stars([[12, 8], [30, 6, 0.5], [70, 6], [88, 14, 0.5], [50, 4, 0.5], [6, 20, 0.5]]) + P("M-2,100 L-2,72 L14,58 L24,66 L36,52 L50,68 L62,56 L76,64 L88,50 L102,64 L102,100Z", "#1b2a44") + P("M10,61 L14,58 L18,61.4 L14,61Z M33,55 L36,52 L39.4,55.6 L36,55Z M85,53 L88,50 L91.4,53.6 L88,53Z", "#e8f2ff");
      case 24: var city = sky("#0d1640", "#2a2a66") + C(80, 16, 7, "#fff1c4") + C(83, 14, 6, "#2a2f6a", ' opacity=".0"'), bl = [[0, 62, 12], [12, 50, 10], [22, 58, 14], [36, 44, 10], [64, 48, 12], [76, 56, 10], [86, 40, 14]];
        bl.forEach(function (q) { city += R(q[0], q[1], q[2], 100 - q[1], 0, "#161d3e"); for (var yy = q[1] + 4; yy < 100; yy += 6) for (var xx = q[0] + 2; xx < q[0] + q[2] - 2; xx += 4) if (hashStr(q[0] + ":" + yy + ":" + xx) % 3) city += R(xx, yy, 1.8, 2.4, 0, "#ffcf6b", ' opacity=".85"'); });
        return city + stars([[10, 10, 0.5], [30, 16, 0.5], [56, 8, 0.6], [64, 20, 0.4]]);
      case 25: var pub = full("#4a2a18") + R(0, 0, 100, 34, 0, "#3b2112") + R(0, 30, 100, 2.4, 0, "#2a170c") + R(0, 52, 100, 2.4, 0, "#2a170c");
        [[6, "#3c8a3a"], [12, "#8a3a1c"], [18, "#c9a227"], [24, "#3c8a3a"], [74, "#c9a227"], [80, "#3c8a3a"], [86, "#8a3a1c"], [92, "#c9a227"]].forEach(function (q, i) { pub += R(q[0], 40 + (i % 2) * 2, 4, 12 - (i % 2) * 2, 1.4, q[1]) + R(q[0] + 1.2, 37 + (i % 2) * 2, 1.6, 4, 0.6, q[1]); });
        [[16, 0], [50, 0], [84, 0]].forEach(function (q) { var g = nid(); pub += "<defs>" + rgrad(g, q[0], 20, 16, [[0, "#ffd27a", 0.75], [1, "#ffd27a", 0]]) + "</defs>" + C(q[0], 20, 16, "url(#" + g + ")") + S("M" + q[0] + ",0 L" + q[0] + ",14", "#1a0f08", 0.6) + P("M" + (q[0] - 4) + ",18 L" + (q[0] + 4) + ",18 L" + (q[0] + 2) + ",14 L" + (q[0] - 2) + ",14Z", "#c9952a"); });
        return pub;
      case 26: var fo = sky("#bfe3d0", "#e9f6ee"); [[10, 60, 14, "#2c5a3a"], [26, 52, 16, "#1f4a2e"], [84, 54, 16, "#1f4a2e"], [96, 62, 12, "#2c5a3a"], [64, 66, 12, "#3c7a4a"], [42, 70, 10, "#3c7a4a"]].forEach(function (q) { fo += P("M" + q[0] + "," + (q[1] - q[2] * 2.2) + " L" + (q[0] + q[2] * 0.7) + "," + q[1] + " L" + (q[0] - q[2] * 0.7) + "," + q[1] + "Z", q[3]) + R(q[0] - 1, q[1], 2, 100 - q[1], 0, "#3b2618"); }); return fo + R(0, 88, 100, 12, 0, "#2c5a3a");
      case 27: return sky("#9fd3ff", "#e6f4ff") + R(0, 70, 100, 30, 0, "#3f86c6") + S("M4,78 L20,78 M60,84 L80,84 M30,92 L44,92", "#cfe8ff", 0.8, ' opacity=".8"') + P("M2,70 L2,54 L12,44 L22,54 L22,70Z", "#b3242c") + P("M0,55 L12,42 L24,55 L22,56 L12,46 L2,56Z", "#3a2a24") + R(9, 58, 6, 12, 0, "#6b2a18") + R(4, 56, 4, 4, 0, "#f4f2ec") + R(16, 56, 4, 4, 0, "#f4f2ec") + S("M2,54 L2,70 M22,54 L22,70", "#f4f2ec", 1) +
        R(86, 30, 2, 40, 0, "#f4f2ec") + S("M86,40 L88,40 M86,50 L88,50 M86,60 L88,60", "#2b2b2b", 0.6) + C(87, 28, 8, "#6fb24e", ' opacity=".9"') + C(82, 36, 5, "#5ca04a", ' opacity=".9"');
      case 28: var wi = sky("#b8d8f2", "#eef6fd") + P("M0,80 C20,74 40,78 60,74 C80,70 92,74 100,72 L100,100 L0,100Z", "#fbfdff"); [[10, 10], [24, 30], [80, 12], [90, 34], [64, 6], [40, 14], [8, 50], [92, 56], [18, 70], [84, 76]].forEach(function (q) { wi += C(q[0], q[1], 1.2, "#fff"); }); return wi;
      case 29: var vf = sky("#2a1a4a", "#c2563a"), g2 = nid(), fl1 = "M2,100 C0,84 8,74 10,62 C14,72 14,78 18,70 C22,78 20,86 26,80 C28,88 24,94 26,100Z", fl2 = "M7,100 C6,90 10,84 12,78 C15,86 17,88 20,84 C21,90 20,96 21,100Z";
        return vf + "<defs>" + rgrad(g2, 50, 100, 52, [[0, "#ffcf4d", 0.75], [1, "#ff7a1a", 0]]) + "</defs>" + C(50, 100, 52, "url(#" + g2 + ")") + P(fl1, "#ff7a1a") + P(mir(fl1), "#ff7a1a") + P(fl2, "#ffcf4d") + P(mir(fl2), "#ffcf4d") + stars([[10, 50, 0.6], [20, 40, 0.5], [84, 44, 0.6], [74, 54, 0.5], [90, 30, 0.5], [16, 58, 0.4]], "#ffcf4d");
      case 30: var hw = sky("#1d0f33", "#4a1f5a") + C(76, 22, 12, "#ffe9b0") + C(72, 19, 2, "#f2d48a") + C(80, 26, 1.4, "#f2d48a");
        [[14, 18], [28, 10], [88, 44]].forEach(function (q) { hw += P("M" + q[0] + "," + q[1] + " c2,-3 4,-1 5,1 c1,-2 3,-2 3,0 c0,-2 2,-2 3,0 c1,-2 3,-4 5,-1 c-3,0 -4,2 -5,4 c-1,-1 -3,-1 -3,1 c-1,-2 -3,-2 -3,0 c-1,-2 -2,-4 -5,-5Z", "#120820"); });
        [[13, 70, 6], [87, 68, 6.6]].forEach(function (q) { hw += cel(dE(q[0], q[1], q[2], q[2] * 0.8), "#f28a1a", { w: [1.4, 1], v: [0.6, 0.6] }) + R(q[0] - 1, q[1] - q[2] * 0.8 - 2.6, 2, 3, 0, "#3c6a2a") + P("M" + (q[0] - 4) + "," + (q[1] - 2) + " l2,-2 l2,2Z M" + q[0] + "," + (q[1] - 2) + " l2,-2 l2,2Z M" + (q[0] - 4) + "," + (q[1] + 2) + " l2,2 l2,-1 l2,1 l2,-2Z", "#ffe25a"); });
        return hw;
      case 31: var ju = sky("#0f3b2a", "#174f38") + S("M-2,10 Q25,22 50,10 Q75,22 102,10", "#0a2a1c", 0.6);
        [[6, 13], [16, 17], [27, 16.4], [38, 12.6], [62, 12.6], [73, 16.4], [84, 17], [94, 13]].forEach(function (q, i) { ju += E(q[0], q[1] + 1.4, 1.2, 1.7, ["#ff5a5a", "#ffd36b", "#4aa3ff", "#3ddc84"][i % 4]); });
        [[8, 40], [92, 36], [16, 68], [86, 70], [24, 30], [76, 52]].forEach(function (q) { ju += C(q[0], q[1], 1.1, "#fff", ' opacity=".9"'); }); return ju + P(star(50, 30, 4), "#ffd36b", ' opacity=".0"');
      case 32: var fw2 = sky("#0a0f2a", "#1d2550");
        [[22, 26, "#ff5a8a", 12], [78, 20, "#ffd36b", 13], [86, 62, "#3ddc84", 9], [12, 64, "#4aa3ff", 9]].forEach(function (q) { for (var a = 0; a < 12; a++) { var t = a * Math.PI / 6; fw2 += S("M" + f2(q[0] + Math.cos(t) * q[3] * 0.35) + "," + f2(q[1] + Math.sin(t) * q[3] * 0.35) + " L" + f2(q[0] + Math.cos(t) * q[3]) + "," + f2(q[1] + Math.sin(t) * q[3]), q[2], 1); } fw2 += C(q[0], q[1], 1.2, "#fff"); }); return fw2;
      case 33: return sky("#8fd0ff", "#dff2ff") + R(0, 62, 100, 38, 0, "#2f7ac0") + P("M-2,100 L-2,76 C6,70 16,70 24,78 C30,84 34,92 38,100Z", "#c9a39a") + P("M62,100 C66,90 72,82 82,78 C90,76 98,80 102,84 L102,100Z", "#b8928a") + S("M4,84 C10,80 16,80 22,84 M70,90 C76,86 84,84 92,86", "#e3c4bc", 0.8) +
        R(84, 54, 5, 22, 0, "#f4f2ec") + R(84, 60, 5, 3, 0, "#c8202a") + R(84, 68, 5, 3, 0, "#c8202a") + P("M83,54 L86.5,49 L90,54Z", "#c8202a") + S("M10,68 L24,68 M50,70 L60,70", "#cfe8ff", 0.8);
      case 34: var cf = full("#1d2550"); [[8, 10, "#ff5a8a", 20], [22, 30, "#ffd36b", -30], [86, 12, "#3ddc84", 40], [72, 34, "#4aa3ff", 10], [10, 56, "#ffd36b", 60], [90, 54, "#ff5a8a", -20], [16, 82, "#4aa3ff", 30], [84, 84, "#ffd36b", -50], [40, 6, "#3ddc84", 70], [62, 8, "#ff8fc4", -10], [30, 92, "#ff8fc4", 20], [70, 94, "#3ddc84", 50]].forEach(function (q) { cf += R(q[0] - 2, q[1] - 1, 4, 2, 0.4, q[2], ' transform="rotate(' + q[3] + " " + q[0] + " " + q[1] + ')"'); }); return cf;
      case 35: var ds = full("#2a0f4a"); for (var dsi = 0; dsi < 8; dsi++) ds += P("M50,8 L" + f2(50 + Math.cos(dsi * 0.785 + 0.3) * 90) + "," + f2(8 + Math.sin(dsi * 0.785 + 0.3) * 90) + " L" + f2(50 + Math.cos(dsi * 0.785 + 0.5) * 90) + "," + f2(8 + Math.sin(dsi * 0.785 + 0.5) * 90) + "Z", ["#ff5a8a", "#4aa3ff", "#ffd36b", "#3ddc84"][dsi % 4], ' opacity=".28"');
        return ds + C(50, 8, 7, "#c9ced6") + S("M43.6,6 L56.4,6 M43.4,9.6 L56.6,9.6 M47,1.6 L47,14.6 M53,1.6 L53,14.6", "#8a929c", 0.5) + C(47.6, 5.6, 1.2, "#fff", ' opacity=".8"');
      case 36: var mp = full("#efe6d2"); mp += S("M0,30 L100,22 M0,62 L100,70 M24,0 L30,100 M70,0 L64,100", "#fff", 4) + S("M0,30 L100,22 M0,62 L100,70 M24,0 L30,100 M70,0 L64,100", "#d9ccb0", 0.6) + P("M36,74 L58,72 L60,100 L38,100Z", "#bfe0b0") + P("M76,30 L100,28 L100,54 L78,56Z", "#cfe3f2");
        [[16, 46, "#f5a623"], [86, 14, "#3ddc84"], [10, 84, "#f5a623"]].forEach(function (q) { mp += P("M" + q[0] + "," + (q[1] + 6) + " C" + (q[0] - 4) + "," + (q[1] + 1) + " " + (q[0] - 4) + "," + (q[1] - 4) + " " + q[0] + "," + (q[1] - 4) + " C" + (q[0] + 4) + "," + (q[1] - 4) + " " + (q[0] + 4) + "," + (q[1] + 1) + " " + q[0] + "," + (q[1] + 6) + "Z", q[2]) + C(q[0], q[1] - 0.6, 1.4, "#fff"); }); return mp;
      case 37: var g3 = nid(); return "<defs>" + rgrad(g3, 30, 30, 90, [[0, "#3a1f6a"], [1, "#05030f"]]) + "</defs>" + R(0, 0, 100, 100, 0, "url(#" + g3 + ")") + stars([[8, 10], [20, 30, 0.5], [90, 8], [76, 30, 0.5], [12, 62, 0.6], [88, 64, 0.6], [40, 6, 0.5], [60, 12, 0.4], [6, 88, 0.5], [94, 86, 0.6]]) +
        cel(dC(84, 20, 8), "#ff8a5a", { w: [1.6, 1.2], v: [0.8, 0.8] }) + '<ellipse cx="84" cy="20" rx="13" ry="3.4" fill="none" stroke="#ffd36b" stroke-width="1.2" transform="rotate(-18 84 20)"/>';
      case 38: var g4 = nid(), bb = "<defs>" + grad(g4, 0, 0, 0, 100, [[0, "#ffcf4d"], [1, "#d98a0f"]]) + "</defs>" + R(0, 0, 100, 100, 0, "url(#" + g4 + ")");
        [[10, 80, 2], [16, 60, 1.4], [86, 70, 2.2], [80, 50, 1.2], [8, 40, 1.6], [92, 30, 1.4], [24, 90, 1.2], [74, 88, 1.6]].forEach(function (q) { bb += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="' + q[2] + '" fill="rgba(255,255,255,.25)" stroke="#fff6cc" stroke-width=".5"/>'; });
        return bb + P("M0,0 L100,0 L100,12 C92,16 86,10 78,14 C70,18 62,10 54,14 C46,18 38,10 30,14 C22,18 14,10 6,14 C3,15 1,14 0,13Z", "#fbf7ea");
      default: return full(BGC[0]);
    }
  }

  /* ---------- Held item (viewer's left: the wearer's right hand) ---------- */
  function heldSVG(hi, s, skin) {
    if (!hi) return "";
    var sl = topMain(s) || skin, it = "", glass = "rgba(220,240,255,.55)";
    switch (hi) {
      case 1: it = P("M13,64 L31,64 L28.6,94 L15.4,94Z", glass, ' stroke="#e6f2ff" stroke-width=".8"') + P("M14.2,70 L29.8,70 L28.6,93 L15.4,93Z", "#f5a623") + P("M13,64.6 C13,61 16,60.4 17.6,62 C18.6,59.6 22,59.6 23,61.6 C24.6,60 28,60.6 28.6,62.6 C30.6,62.4 31.4,64.6 31,66 L31,70.6 L13,70.6Z", "#fbf7ea") + S("M16.6,72 L17.6,90", "#fff6cc", 0.9, ' opacity=".7"') + C(22, 80, 0.6, "#fff6cc") + C(25, 86, 0.5, "#fff6cc"); break;
      case 2: it = cel("M19,94 L19,74 C19,70 20.6,68.6 21,66 L21,56 L25,56 L25,66 C25.4,68.6 27,70 27,74 L27,94Z", "#2f6a3a", { w: [0.8, 0.6], v: [0.5, 0.5], hk: 0.25 }) + R(20.4, 54, 5.2, 3, 0.8, "#c9ced6") + R(19, 76, 8, 9, 0.6, "#f4f2ec") + R(19, 79, 8, 2.4, 0, "#2f6fb8") + S("M21,90 L21.4,76", "#fff", 0.6, ' opacity=".35"'); break;
      case 3: it = '<g transform="rotate(-12 22 78)">' + R(15, 62, 15, 26, 2.6, "#1b1d22") + R(16.4, 64.6, 12.2, 19.6, 1.4, "#3a5aa8") + P("M16.4,64.6 L28.6,64.6 L16.4,78Z", "#6fb6ff", ' opacity=".45"') + C(22.5, 86.2, 0.8, "#3a3d45") + "</g>"; break;
      case 4: it = S("M24,96 L24,52", "#8a5a2b", 1.4) + P("M24,52 C30,50 34,55 42,52 L42,66 C34,69 30,64 24,66Z", "#2f6fb8") + P("M29.6,51.4 L32.6,52.6 L32.6,67 L29.6,66.2Z", "#f5c518") + P("M24,57.6 C30,56 34,61 42,58.4 L42,61 C34,63.6 30,58.6 24,60.2Z", "#f5c518") + C(24, 51, 1.2, "#e9b93a"); break;
      case 5: it = cel("M30,82 L36,86 L16,59 L12.6,60.8Z", "#5a3a1f", { w: [0.6, 0.6], v: [0.4, 0.4] }) + cel(dR(8.6, 52.4, 6, 9, 1.6), "#3b2618", { w: [0.6, 0.6], v: [0.4, 0.4] }) + C(9.6, 55, 0.7, "#c9ced6") + C(13.6, 55, 0.7, "#c9ced6") + C(9.6, 58, 0.7, "#c9ced6") + C(13.6, 58, 0.7, "#c9ced6") +
        cel("M30,80 C24,80 20,84 21,90 C22,94 20,97 22,100 L50,100 C52,96 50,92 46,90 C44,88 45,84 42,82 C38,79 34,79 30,80Z", "#c97a2a", { w: [1.4, 1], v: [0.8, 0.8] }) + C(35, 89, 3.4, "#3b2618") + S("M33.4,86.6 L14.6,60.2 M34.6,86 L15.8,59.6", "#e8e6df", 0.3) + R(38, 93, 6, 1.6, 0.6, "#3b2618"); break;
      case 6: it = P("M14,60 L30,60 C30,70 26,74 22,74 C18,74 14,70 14,60Z", glass, ' stroke="#e6f2ff" stroke-width=".7"') + P("M14.4,64 L29.6,64 C29,70.6 26,73.4 22,73.4 C18,73.4 15,70.6 14.4,64Z", "#8a1f3a") + S("M22,74 L22,90", "#e6f2ff", 1.2) + S("M16.4,61.6 L17.4,68", "#fff", 0.7, ' opacity=".6"'); break;
      case 7: it = cel(dR(13, 70, 16, 18, 3), "#f4f2ec", { w: [1, 0.8], v: [0.6, 0.6], k: 0.1 }) + '<path d="M29,74 C35,74 35,84 29,84" fill="none" stroke="#e6e2d6" stroke-width="2"/>' + E(21, 71, 7.4, 1.6, "#5a3a1f") + S("M17,66 C15,62 19,60 17,56 M22,66 C20,62 24,60 22,56 M27,66 C25,62 29,60 27,56", "#fff", 0.8, ' opacity=".6"') + R(13, 78, 16, 3, 0, "#c8202a"); break;
      case 8: it = '<g transform="rotate(-24 22 76)">' + cel(dR(6, 70, 32, 9, 4.4), "#e0a85a", { w: [1, 0.8], v: [0.6, 0.6] }) + R(7, 72.6, 30, 4.6, 2.3, "#b3442c") + S("M10,73.6 C13,71.6 15,75.6 18,73.6 C21,71.6 23,75.6 26,73.6 C29,71.6 31,75.6 34,73.6", "#f5c518", 0.9) + "</g>"; break;
      case 9: it = cel(dC(22, 62, 5.6), "#3a3d45", { w: [1, 0.8], v: [0.6, 0.6], hk: 0.3 }) + S("M18.4,60 L25.6,60 M18,63 L26,63 M19,66 L25,66 M20,58 L20,66 M24,58 L24,66", "#22252b", 0.5) + cel("M18.6,66 L25.4,66 L24,90 L20,90Z", "#1b1d22", { w: [0.8, 0.6], v: [0.5, 0.5] }) + R(19.4, 70, 5.2, 1.6, 0.4, "#c8202a"); break;
      case 10: it = '<g transform="rotate(-8 22 74)">' + cel(dR(8, 64, 28, 17, 2.4), "#f5c518", { w: [1, 0.8], v: [0.6, 0.6] }) + R(8, 68, 28, 9, 0, "#1d1d22") + C(24, 72.4, 5, "#2a2d33") + C(24, 72.4, 3.2, "#5a7aa8") + C(22.8, 71, 1, "#fff", ' opacity=".7"') + R(10, 65.4, 7, 3.4, 0.6, "#e8f2ff") + R(30.4, 62, 4, 2.4, 0.6, "#3a3d45") + "</g>"; break;
      case 11: it = P("M16,70 L28,70 L26.4,84 L17.6,84Z", glass, ' stroke="#e6f2ff" stroke-width=".7"') + P("M16.6,74 L27.4,74 L26.4,83.4 L17.6,83.4Z", "#eaf6ff", ' opacity=".85"') + P(star(29, 68, 1.6, 0.35), "#fff"); break;
      case 12: var g = nid(); it = S("M22,54 L22,60", "#3b2618", 1) + S("M14,64 C14,54 30,54 30,64", "#3b2618", 0.8) + cel(dE(22, 70, 10, 8.6), "#f28a1a", { w: [1.4, 1], v: [0.6, 0.6] }) + S("M22,62 L22,78 M16,63 C14,68 14,74 16,77 M28,63 C30,68 30,74 28,77", "#c46a10", 0.6) + "<defs>" + rgrad(g, 22, 70, 6, [[0, "#fff3a0"], [1, "#ffcf4d"]]) + "</defs>" +
        P("M15.6,67.4 L18.4,64.6 L20.6,67.4Z M23.4,67.4 L25.6,64.6 L28.4,67.4Z M16,72 L19,74.6 L22,72.6 L25,74.6 L28,72 L26,76.4 L18,76.4Z", "url(#" + g + ")"); break;
      case 13: it = cel(dR(13.6, 70, 15, 17, 3.4), "#b3242c", { w: [1, 0.8], v: [0.6, 0.6] }) + '<path d="M28.6,74 C34,74 34,83 28.6,83" fill="none" stroke="#8a1a22" stroke-width="2"/>' + E(21.1, 71, 7, 1.5, "#5a0f1a") + C(18, 70.4, 2.2, "#f28a1a") + C(18, 70.4, 1.4, "#ffb24d") + S("M17,66 C15,62 19,60 17,56 M24,66 C22,62 26,60 24,56", "#fff", 0.8, ' opacity=".55"') + S("M14,80 L28.6,80", "#f4f2ec", 0.8, ' stroke-dasharray="1 1"'); break;
      case 14: it = '<path d="M30,70 C38,70 38,88 30,88" fill="none" stroke="rgba(220,240,255,.75)" stroke-width="3.2"/>' + P("M12,64 L31,64 L30,95 L13,95Z", glass, ' stroke="#e6f2ff" stroke-width=".9"') + P("M13,70 L30,70 L29.2,94 L13.8,94Z", "#e8961a") +
        [[17, 76], [24, 76], [17, 84], [24, 84], [20.5, 90]].map(function (q) { return E(q[0], q[1], 2.2, 2.8, "#fff", ' opacity=".22"'); }).join("") + P("M11.4,64.6 C11.4,60.6 14.6,59.8 16.4,61.6 C17.4,59.2 21,59 22.2,61.2 C23.8,59.4 27.6,59.8 28.4,62 C30.8,61.8 32,64 31.6,65.6 L31,70.6 L12,70.6Z", "#fbf7ea") + S("M15,72 L15.8,92", "#fff6cc", 0.9, ' opacity=".6"'); break;
      case 15: it = cel("M12,58 L32,58 C32,68 28,73 22,73 C16,73 12,68 12,58Z", "#e9b93a", { w: [1.2, 1], v: [0.6, 0.6], hk: 0.3 }) + S("M12,61 C6,61 6,68 13,68 M32,61 C38,61 38,68 31,68", "#d19a1e", 1.4) + R(20.4, 72, 3.2, 8, 0, "#d19a1e") + cel(dR(15, 80, 14, 5, 1), "#6b4426", { w: [0.6, 0.6], v: [0.4, 0.4] }) + P(star(22, 64, 3), "#fff6cc", ' opacity=".9"'); break;
      case 16: it = P("M13,64 L31,64 L29,94 L15,94Z", glass, ' stroke="#e6f2ff" stroke-width=".8"') + P("M13.6,70 L30.4,70 L29,93 L15,93Z", "#bfe6ff", ' opacity=".8"') + R(16, 72, 5, 5, 0.8, "#fff", ' opacity=".7" transform="rotate(12 18 74)"') + R(22.6, 76, 5, 5, 0.8, "#fff", ' opacity=".65" transform="rotate(-10 25 78)"') + S("M16.4,80 L17,90", "#fff", 0.8, ' opacity=".7"'); break;
    }
    var big = hi === 5;
    var hand = cel(big ? dR(14.4, 62, 11, 11, 4.4) : dR(13.4, 82, 15, 11, 5), skin, { w: [1, 0.8], v: [0.6, 0.6] }) + S(big ? "M16.6,65 L23.6,65 M16.6,68 L23.6,68" : "M16.4,85 L26.4,85 M16.4,88 L26.4,88 M16.6,91 L25.6,91", shade(skin, -0.25), 0.7);
    var arm = cel(big ? "M15,70 L25,70 L18,100 L6,100Z" : "M14,92 L28,92 L30,100 L12,100Z", sl, { w: [1, 0.8], v: [0.6, 0.6] });
    return it + arm + hand;
  }

  /* ---------- Frame ring (+ rank badge) ---------- */
  function rankTier(r) { r = r | 0; return r >= 40 ? 4 : r >= 31 ? 3 : r >= 21 ? 2 : r >= 11 ? 1 : 0; }
  var METAL = [["#c98a4a", "#f0c08a", "#8a5428"], ["#b9c0c9", "#f2f5f8", "#7a828c"], ["#e9b93a", "#fff1a8", "#a8780a"], ["#d9e6ef", "#ffffff", "#8fa5b5"], ["#8fe3ff", "#ffffff", "#4aa3d9"]];
  function frameSVG(fr, r) {
    if (!fr) return "";
    var n = nid(), ring = function (a, b2, c, w) { return "<defs>" + grad(n, 0, 0, 100, 100, [[0, b2], [0.45, a], [1, c]]) + '</defs><circle cx="50" cy="50" r="' + (50 - w / 2) + '" fill="none" stroke="url(#' + n + ')" stroke-width="' + w + '"/>'; };
    var badge = function (m) { var bx = 80, by = 20; return C(bx, by, 7.2, m[2]) + C(bx, by, 6, m[0]) + C(bx, by, 4.6, "#14223f") + rankMark(r, r >= 20 ? bx - 2.4 : r >= 11 ? (r >= 17 ? bx - 4.2 : r >= 14 ? bx - 2.1 : bx) : bx, r >= 20 ? by - 1.2 : r >= 11 ? by : by - 1, "#ffc24d"); };
    if (fr >= 1 && fr <= 5) { var m = METAL[fr === 1 ? rankTier(r) : fr - 1]; return ring(m[0], m[1], m[2], LITE ? 6 : 4.6) + (fr === 5 || (fr === 1 && rankTier(r) === 4) ? stars([[14, 30], [86, 22], [30, 92]], "#fff") : "") + (LITE ? "" : badge(m)); }
    function stars(list, c) { return list.map(function (p) { return P(star(p[0], p[1], 2.4, 0.35), c); }).join(""); }
    switch (fr) {
      case 6: var lv = ring("#e9b93a", "#fff1a8", "#a8780a", 2.2); for (var i = 0; i < 13; i++) { var a = Math.PI * (0.58 + i * 0.065), x = f2(50 + 46 * Math.cos(a)), y = f2(50 + 46 * Math.sin(a)), dg = f2(a * 57.3 + 90 + 28); lv += E(x, y, 3.4, 1.5, i % 2 ? "#3c8a3a" : "#4fa64a", ' transform="rotate(' + dg + " " + x + " " + y + ')"') + E(f2(100 - x), y, 3.4, 1.5, i % 2 ? "#3c8a3a" : "#4fa64a", ' transform="rotate(' + f2(-dg) + " " + f2(100 - x) + " " + y + ')"'); } return lv + C(50, 96.4, 2, "#c8202a");
      case 7: return '<circle cx="50" cy="50" r="47.6" fill="none" stroke="#2f6fb8" stroke-width="4.8"/><circle cx="50" cy="50" r="47.6" fill="none" stroke="#f5c518" stroke-width="4.8" stroke-dasharray="12 12"/>';
      case 8: return '<circle cx="50" cy="50" r="47" fill="none" stroke="#ff4fd8" stroke-width="6" opacity=".35"/><circle cx="50" cy="50" r="47.6" fill="none" stroke="#ff7ae6" stroke-width="2.4"/><circle cx="50" cy="50" r="45" fill="none" stroke="#5ae8ff" stroke-width="1.2"/>';
      case 9: var fl = ring("#ff7a1a", "#ffcf4d", "#c8202a", 3.6); for (var j = 0; j < 16; j++) { var b = j * Math.PI / 8, fx = 50 + 47 * Math.cos(b), fy = 50 + 47 * Math.sin(b); fl += P("M" + f2(fx - 2) + "," + f2(fy) + " Q" + f2(50 + 41 * Math.cos(b + 0.08)) + "," + f2(50 + 41 * Math.sin(b + 0.08)) + " " + f2(50 + 39 * Math.cos(b + 0.12)) + "," + f2(50 + 39 * Math.sin(b + 0.12)) + " Q" + f2(fx + 1) + "," + f2(fy + 1) + " " + f2(fx + 2) + "," + f2(fy) + "Z", j % 2 ? "#ffcf4d" : "#ff7a1a"); } return fl;
      case 10: var st = ring("#2a3a7a", "#5a6ab8", "#141c40", 4.4); for (var q = 0; q < 10; q++) { var c = q * Math.PI / 5 - Math.PI / 2; st += P(star(f2(50 + 47.8 * Math.cos(c)), f2(50 + 47.8 * Math.sin(c)), 2.6, 0.4), "#ffd76b"); } return st;
      default: return "";
    }
  }

  /* svg(spec, {r rank, md medal ids, vb viewBox, small}) → SVG string. layers(spec, o) → [[name, svg part]] (avt01: the
     fit / clip tests render one layer at a time). Layer order: bg · hairB · neck · (nk tucked) · top · nk · hairM · ears ·
     head · earring · face · beard · foam · hairF · glasses · hat · held · frame. */
  var NECK = "M42.6,61 C42.6,58.2 44.8,56 47.6,56 L52.4,56 C55.2,56 57.4,58.2 57.4,61 L57.4,82 L42.6,82Z";   // avt01: no round bottom (no notch at the collar)
  // hats follow the head like the hair; the square head gets a 10 % wider hat (its top corners poked out beside narrow crowns)
  var HATT = HAIRT.slice(); HATT[2] = [1.1, 1, 46];
  var OLDFIT = false;   // test only (avt-tools before/after): the fit rules before avt01
  function layers(spec, o) {
    o = o || {};
    var s = {}; Object.keys(MAX).forEach(function (k) { s[k] = clamp(spec, k); });
    if (!spec || spec.ms == null) s.ms = 1;
    migrate(s);
    var small = !!o.small, md = s.ms ? (o.md || []) : [];
    ID = "__ID__"; CN = 0; LITE = small; SWK = small ? 1.3 : 1;
    var defs = [], skin = SKIN[s.sk], sh = shade(skin, -0.14), F = hairFills(s, defs), hcol = F.base;
    var browCol = s.hr === 0 && s.hc < 3 && !s.hx ? "#3b2618" : shade(hcol, -0.1);
    var mask = s.gl === 6 && !OLDFIT, lim = HCLIP[s.hw] || (s.hw && !OLDFIT ? HAIRTOP : 0), hs = hairStyle(s.hr);
    if (OLDFIT) { hs = Object.assign({}, hs); if (hs.t) { hs.f = (hs.f || "") + hs.t; delete hs.t; } }
    if (s.hw && !OLDFIT) { hs = Object.assign({}, hs, hs.hat || {}); delete hs.t; delete hs.tl; delete hs.tx; }
    var ht = tf(HAIRT[s.fs]), jt = tf(JAWT[s.fs]), cut = lim ? ' clip-path="url(#' + ID + 'h)"' : "", cutB = OLDFIT ? (lim ? ' clip-path="url(#' + ID + 'hb)"' : "") : cut, cutM = OLDFIT ? "" : cut;
    var out = [], add = function (n, x) { if (x) out.push([n, x]); };
    add("bg", bgSVG(s.bg, s));
    if (hs.b && !mask) add("hairB", "<g" + ht + cutB + ">" + hairPart(hs.b, F) + "</g>");
    add("neck", P(OLDFIT ? dR(42.6, 56, 14.8, 22, 5) : NECK, sh) + (LITE ? "" : P("M42.6,60 C46,64.6 54,64.6 57.4,60 L57.4,65 C54,68 46,68 42.6,65Z", shade(skin, -0.24), ' opacity=".7"')));
    var tuck = !!(s.nl && NKL[s.nk]);
    add("top", OLDFIT ? topSVG(s, o.r | 0, md, skin) : '<g clip-path="url(#' + ID + 't)">' + topSVG(s, o.r | 0, md, skin) + "</g>");   // avt01: nothing sticks out of the body outline
    // Instoppad: the part under the clothes is hidden, only the part around the neck shows (clipped above the collar)
    add("nk", tuck ? '<g clip-path="url(#' + ID + 'n)">' + neckSVG(s.nk, s) + "</g>" : neckSVG(s.nk, s));
    if (hs.m && !mask) add("hairM", "<g" + ht + cutM + ">" + hairPart(hs.m, F) + (hs.ml ? S(hs.ml, F.dk, 0.7, ' opacity=".7"') : "") + (hs.x2 ? hs.x2.map(function (q) { return C(q[0], q[1], 1.8, "#c8202a"); }).join("") : "") + "</g>");
    if (!mask) add("ears", earsSVG(s.fs, skin, s.er));
    add("head", cel(HEAD[s.fs] || HEAD[0], skin, { w: [2.4, 1.6], v: [1.1, 1.1], k: 0.12, hk: 0.12 }));
    if (!mask) add("earring", earringsSVG(s.er, s.fs));
    add("face", cheeksSVG(s.ck, skin) + marksSVG(s.fm, skin) + paintSVG(s.fp) + noseSVG(s.ns, skin) + eyesSVG(s.ey, s.ec, skin) + browsSVG(s.br, browCol) + mouthSVG(s.mt, skin));
    var fhs = mask ? "" : facialHair(s.fh, shade(hcol, s.hc === 6 && !s.hx ? -0.05 : 0)); if (fhs) add("beard", "<g" + jt + ">" + fhs + "</g>");
    if (s.fp === 11 && !mask) add("foam", foamSVG());
    if (!mask && (hs.f || hs.t || hs.z || hs.l || hs.l2 || hs.ld)) {
      var lc = lum(hcol) < 0.25 ? shade(hcol, 0.34) : shade(hcol, -0.36);
      var hf = (hs.z ? P(hs.z, F.b, ' opacity=".35"') : "") + hairPart(hs.f, F, hs.o) + hairPart(hs.t, F) + (hs.tl && !LITE ? S(hs.tl, F.dk, 0.8, ' opacity=".55"') : "") +
        (hs.l && !LITE ? S(hs.l, F.dk, 0.8, ' opacity=".55"') : "") + (hs.l2 ? S(hs.l2, F.b, 1) : "") + (hs.ld ? S(hs.ld, lc, LITE ? 1.5 : 1.1) : "") +
        (hs.sh ? S(hs.sh, shade(hcol, lum(hcol) < 0.25 ? 0.42 : 0.5), LITE ? 1.7 : 1.3, ' opacity=".9"') : "") +
        (hs.x ? C(hs.x[0], hs.x[1], hs.x[2], shade(hcol, 0.25)) : "") + (hs.tx ? C(hs.tx[0], hs.tx[1], hs.tx[2], shade(hcol, 0.25)) : "");
      add("hairF", "<g" + ht + cut + ">" + hf + "</g>");
    }
    // avt01: glasses go over the hat brim (a low brim cut the frames); the balaclava stays under the hat
    var gfirst = OLDFIT || s.gl === 6;
    if (gfirst) add("glasses", glassesSVG(s.gl));
    add("hat", "<g" + (OLDFIT ? ht : tf(HATT[s.fs])) + ">" + hatSVG(s.hw, s) + "</g>");
    if (!gfirst) add("glasses", glassesSVG(s.gl));
    add("held", heldSVG(s.hi, s, skin));
    add("frame", frameSVG(s.fr, o.r | 0));
    var head = '<defs><clipPath id="' + ID + 'c"><circle cx="50" cy="50" r="50"/></clipPath><clipPath id="' + ID + 't"><path d="' + SHOULDERS + '"/><rect x="27" y="62" width="46" height="20"/></clipPath><clipPath id="' + ID + 'n"><path d="M33,60 L67,60 L67,77.2 Q50,80.6 33,77.2Z"/></clipPath>' +
      (lim ? '<clipPath id="' + ID + 'h"><rect x="-30" y="' + lim + '" width="160" height="160"/></clipPath><clipPath id="' + ID + 'hb"><rect x="-30" y="24" width="160" height="160"/></clipPath>' : "") + "</defs>";
    return { parts: out, head: head, defs: defs.length ? "<defs>" + defs.join("") + "</defs>" : "", s: s };
  }
  function svg(spec, o) {
    o = o || {};
    var s0 = {}; Object.keys(MAX).forEach(function (k) { s0[k] = clamp(spec, k); });
    if (!spec || spec.ms == null) s0.ms = 1;
    migrate(s0);
    var md0 = s0.ms ? (o.md || []) : [];
    var key = JSON.stringify([s0, md0, o.r | 0, o.vb || "", !!o.small]);
    var memo = svgMemo[key]; if (memo) return memo.replace(/__ID__/g, "av" + (++uid));
    var L = layers(spec, o), vb = o.vb || "0 0 100 100";
    var h = '<svg viewBox="' + vb + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' + L.head +
      '<g clip-path="url(#' + ID + 'c)">' + L.parts.map(function (p) { return p[1]; }).join("") + "</g>" + L.defs + "</svg>";
    if (svgMemoN > 1500) { svgMemo = {}; svgMemoN = 0; }
    svgMemo[key] = h; svgMemoN++;
    return h.replace(/__ID__/g, "av" + (++uid));
  }
  // test hook (avt-tools): each layer as its own SVG, same clip + defs, transparent background
  function layerSVGs(spec, o) {
    var L = layers(spec, o || {}), vb = (o && o.vb) || "0 0 100 100", r = {}, n = ++uid;
    L.parts.forEach(function (p) { r[p[0]] = ('<svg viewBox="' + vb + '" xmlns="http://www.w3.org/2000/svg">' + L.head + '<g clip-path="url(#' + ID + 'c)">' + p[1] + "</g>" + L.defs + "</svg>").replace(/__ID__/g, "lt" + n); });
    return r;
  }
  /* ---------- People + cache ---------- */
  var TTL = 60000, retryF = false, retryG = {};
  function retryLoads() {   // feat: specs asked for before the session was ready
    if (off || !A || (!retryF && !Object.keys(retryG).length)) return;
    try { if (A.authed && !A.authed()) return; } catch (e) {}
    var ps = [];
    if (retryF) { retryF = false; ps.push(forFriends()); }
    Object.keys(retryG).forEach(function (g) { delete retryG[g]; ps.push(forGroup(g)); });
    Promise.all(ps).then(function () { try { if (A.render) A.render(); } catch (e) {} });
  }
  function chestOf(p) {
    if (!p) return [];
    if (p.md) return p.md;
    return [];
  }
  function personSVG(p, o) {
    o = o || {};
    if (!p) return "";
    var spec = p.a || defaultSpec(p.seed || ("n:" + (p.name || "?")), p.r);
    return svg(spec, { r: p.r, md: chestOf(p), vb: o.vb, small: o.small });
  }
  function myMedals(spec, facts) {
    if (spec && spec.ms === 0) return [];
    if (spec && spec.md && spec.md.length) return spec.md.slice(0, 6);
    return ((facts && facts.m) || []).filter(function (x) { return !HIDDEN_MEDALS[x]; }).slice(0, 5);
  }
  function mePerson() {
    if (!me || !me.spec) return null;   // v3: nothing until you create your character
    return { a: me.spec, seed: me.seed, r: me.facts ? me.facts.r : 1, md: myMedals(me.spec, me.facts), is_me: true, name: (A && A.getName && A.getName()) || "" };
  }
  function loadMe(force) {
    if (off) return Promise.resolve(null);
    if (meP && !force) return meP;
    meP = rpc("my_avatar").then(function (r) {
      if (r.error) { meP = null; return null; }
      me = parse(r.data); me.facts = me.facts || {};
      repaint();
      return me;
    });
    return meP;
  }
  function index(list) {
    var c = { at: Date.now(), byName: {}, byK: {}, me: null };
    (list || []).forEach(function (p) {
      if (p.is_me) c.me = p;
      if (!p.a) return;   // v3: no saved character = no character (initial / the normal map pin), never a random one
      if (p.k) c.byK[p.k] = p;
      if (p.name && !(p.is_me && c.byName[p.name])) c.byName[p.name] = p;
    });
    return c;
  }
  function forGroup(gid) {
    if (off || !gid) return Promise.resolve(null);
    var c = groups[gid];
    if (c && c.data && Date.now() - c.data.at < TTL) return Promise.resolve(c.data);
    if (c && c.p) return c.p;
    c = groups[gid] = groups[gid] || {};
    c.p = rpc("avatars_for", { p_group_id: gid }).then(function (r) {
      c.p = null;
      if (r.error) { if (/no_session|timeout/.test(String(r.error.message || r.error.code || ""))) retryG[gid] = 1; return c.data || null; }
      c.data = index(parse(r.data).people);
      repaint();
      return c.data;
    });
    return c.data ? Promise.resolve(c.data) : c.p;
  }
  function forFriends() {
    if (off) return Promise.resolve(null);
    if (friends && friends.data && Date.now() - friends.data.at < TTL) return Promise.resolve(friends.data);
    if (friends && friends.p) return friends.p;
    friends = friends || {};
    friends.p = rpc("avatars_for", { p_group_id: null }).then(function (r) {
      friends.p = null;
      if (r.error) { if (/no_session|timeout/.test(String(r.error.message || r.error.code || ""))) retryF = true; return friends.data || null; }
      friends.data = index(parse(r.data).people);
      repaint();
      return friends.data;
    });
    return friends.data ? Promise.resolve(friends.data) : friends.p;
  }
  // avk: "me" | "g|<gid>|k|<k>" | "g|<gid>|n|<name>" | "f|<key>"
  function lookup(avk) {
    if (!avk) return null;
    if (avk === "me") return me ? mePerson() : null;
    var p = avk.split("|");
    if (p[0] === "f") { var f = friends && friends.data; return f ? f.byK[p[1]] || null : null; }
    if (p[0] === "g") {
      var d = groups[p[1]] && groups[p[1]].data; if (!d) return null;
      var x = p[2] === "k" ? d.byK[p.slice(3).join("|")] : d.byName[p.slice(3).join("|")];
      if (x && x.is_me && me) return mePerson();
      return x || null;
    }
    return null;
  }
  function isSmall(el) { var c = el.classList; return c.contains("av-pic") || c.contains("av-40") || c.contains("av-face"); }
  function paintEl(el) {
    var avk = el.getAttribute("data-avk"), p = lookup(avk);
    var sig = p ? JSON.stringify([p.a, p.seed, p.r, p.md]) : "";
    var tgt = el.querySelector(":scope > .av-pf-in") || el;
    if (!p) {
      if (!tgt.firstChild) { tgt.textContent = (el.getAttribute("data-avi") || "?").charAt(0).toUpperCase(); el.classList.add("av-ph"); }
      return;
    }
    if (el.__sig === sig && tgt.firstChild) return;
    el.__sig = sig;
    el.classList.remove("av-ph");
    tgt.innerHTML = personSVG(p, { vb: el.getAttribute("data-avvb") || "", small: isSmall(el) });
  }
  var rpT = 0;
  function repaint() {
    if (rpT) return;
    rpT = setTimeout(function () {
      rpT = 0;
      try { document.querySelectorAll(".av[data-avk]").forEach(paintEl); } catch (e) {}
      try { if (window.AVWIZ && window.AVWIZ.sync) window.AVWIZ.sync(); } catch (e) {}   // v3: Profil card + nudge
    }, 30);
  }
  function avEl(avk, initial, cls, label) {
    var e = document.createElement("span");
    e.className = "av" + (cls ? " " + cls : "");
    e.setAttribute("data-avk", avk);
    if (initial) e.setAttribute("data-avi", initial);
    if (label) e.setAttribute("aria-label", label); else e.setAttribute("aria-hidden", "true");
    paintEl(e);
    return e;
  }

  /* ---------- Chat (group, event chat, DM): one avatar per message group ---------- */
  var chat = { g: null, msgs: {}, t: 0 };
  function chatSeen(m, g) {
    if (off || !m || !g || !g.id) return;
    if (!chat.g || chat.g.id !== g.id) { chat.g = g; chat.msgs = {}; forGroup(g.id); if (!me) loadMe(); }
    chat.msgs[String(m.id)] = { me: !!m.is_me, name: m.name || "" };
    if (!chat.t) chat.t = setTimeout(decorateChat, 0);
  }
  function decorateChat() {
    chat.t = 0;
    var list = document.querySelector("#sheet-body .chat-list"); if (!list || !chat.g) return;
    var prev = null, gid = chat.g.id;
    for (var li = list.firstElementChild; li; li = li.nextElementSibling) {
      var info = li.classList.contains("chat-msg") ? chat.msgs[li.getAttribute("data-mid") || ""] : null;
      if (!info) { if (!li.classList.contains("chat-older-li")) prev = null; continue; }
      var who = info.me ? "\u0001me" : info.name || "\u0001?";
      var cont = prev === who;
      prev = who;
      if (info.me) { li.classList.add("av-mine"); continue; }
      li.classList.add("av-on");
      li.classList.toggle("av-cont", cont);
      var pic = li.querySelector(":scope > .av-pic");
      if (cont) { if (pic) pic.remove(); continue; }
      if (!pic) {
        var nm = info.name || L("Någon", "Someone");
        pic = avEl(info.name ? "g|" + gid + "|n|" + info.name : "none", nm, "av-pic", nm);
        pic.setAttribute("role", "button"); pic.setAttribute("tabindex", "-1");
        li.insertBefore(pic, li.firstChild);
      }
    }
  }
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest(".av-pic") : null;
    if (t) { var li = t.parentNode, n = li && li.querySelector(".cm-name.cm-tap"); if (n) n.click(); return; }
    var ed = e.target && e.target.closest ? e.target.closest("[data-av-edit]") : null;
    if (ed) { e.preventDefault(); e.stopPropagation(); openEditor(); }
  }, true);
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var ed = e.target && e.target.closest ? e.target.closest("[data-av-edit]") : null;
    if (ed) { e.preventDefault(); openEditor(); }
  });

  /* ---------- Member list, Vänner rows, NU strip, Profil ---------- */
  function statusRow(g, m, row) {
    if (off || !g || !g.id || !m || !row) return;
    var avk = m.is_me ? "me" : m.k ? "g|" + g.id + "|k|" + m.k : m.name ? "g|" + g.id + "|n|" + m.name : "";
    if (!avk) return;
    var e = avEl(avk, m.name || "?", "av-40" + (m.live ? " av-live" : "") + (m.is_me ? " av-me" : ""));
    var dot = row.querySelector(".st-dot");
    row.insertBefore(e, dot ? dot.nextSibling : row.firstChild);
    row.classList.add("av-row");
    forGroup(g.id); if (m.is_me && !me) loadMe();
  }
  function friendRow(p, li) {
    if (off || !p || !p.key || !li || li.querySelector(":scope > .av")) return;
    var e = avEl("f|" + p.key, p.name || "?", "av-40" + (p.out ? " av-live" : ""));
    var main = li.querySelector(".nr-fmain");
    li.insertBefore(e, main || li.firstChild);
    li.classList.add("av-row");
    forFriends();
  }
  function faces(box, out, g) {
    if (off || !box || !g || !g.id) return;
    var els = box.querySelectorAll(".gpg-face");
    for (var i = 0; i < els.length; i++) {
      var p = out[i]; if (!p) continue;
      var f = els[i];
      f.classList.add("av", "av-face");
      f.setAttribute("data-avk", p.me ? "me" : "g|" + g.id + "|n|" + (p.name || ""));
      f.setAttribute("data-avi", p.i || (p.name || "?").charAt(0));
      f.textContent = "";
      paintEl(f);
    }
    forGroup(g.id); if (!me) loadMe();
  }
  function profileAv(initial) {
    if (off) return null;
    if (!me) loadMe();
    // No SVG in this string: profile.js builds the hero with innerHTML and an <svg> there switches Chrome off its fast
    // parser path, which then un-nests the medal ribbon buttons. The SVG is painted into the element right after.
    setTimeout(repaint, 0);
    return '<div role="button" tabindex="0" class="pf-av av av-pf" data-avk="me" data-avi="' + esc(initial || "?") + '" data-av-edit="1" aria-label="' +
      esc(me && !me.spec ? L("Skapa din karaktär", "Create your character") : L("Ändra din karaktär", "Edit your character")) + '"><span class="av-pf-in"></span><span class="av-pen" aria-hidden="true">✎</span></div>';
  }

  function afterSave(spec) {
    me.spec = spec;
    var f = me.facts || {};
    var upd = function (x) { if (!x || !x.me) return; x.me.a = me.spec; x.me.md = myMedals(me.spec, f); if (x.me.name) x.byName[x.me.name] = x.me; if (x.me.k) x.byK[x.me.k] = x.me; };
    Object.keys(groups).forEach(function (g) { upd(groups[g].data); });
    if (friends) upd(friends.data);
    repaint();
  }
  function setSpec(spec) {   // avt01: nl needs SQL 0397; an old server answers invalid_avatar → save again without nl
    return rpc("set_my_avatar", { p_spec: spec }).then(function (r) {
      if (!r.error || !spec.nl || codeOf(r.error) !== "invalid_avatar") return r;
      var s2 = JSON.parse(JSON.stringify(spec)); delete s2.nl;
      return rpc("set_my_avatar", { p_spec: s2 }).then(function (r2) { if (!r2.error) r2.noNl = true; return r2; });
    });
  }
  function saveSpec(spec) {   // avwiz.js: {ok, spec} | {ok:false, code}
    spec = clean(spec);
    return setSpec(spec).then(function (r) {
      if (r.error) return { ok: false, code: codeOf(r.error) };
      afterSave(parse(r.data).spec || spec);
      return { ok: true, spec: me.spec };
    });
  }

  /* ---------- Unlock checks ---------- */
  function lockOf(k, i) { return LOCKS[k + ":" + i] || null; }
  function today(f) {
    if (f && /^\d\d-\d\d$/.test(f.today || "")) return f.today;
    var d = new Date(); return ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function inWin(w, t) { var a = w.slice(0, 5), b = w.slice(6, 11); return a <= b ? t >= a && t <= b : t >= a || t <= b; }
  // All plain needs must be met; OR any one of lk.o (same as SQL olnu_avatar_lock_ok).
  // v3: facts.gf from the server (0252). Before 0252 runs: an account that already had a saved avatar and did not make it in
  // the new wizard (local flag olnu.avV3) counts as grandfathered, so nobody loses an item.
  function grandfathered(f) {
    if (f && typeof f.gf === "boolean") return f.gf;
    return !!(me && me.spec) && !lsGet("olnu.avV3", null);
  }
  function unlocked(lk, f) {
    if (!lk) return true;
    f = f || {};
    if (lk.n && grandfathered(f)) return true;
    var ok = true;
    if (lk.r && (f.r | 0) < lk.r) ok = false;
    if (lk.m && (f.m || []).indexOf(lk.m) < 0) ok = false;
    if (lk.s && (f.s | 0) < lk.s) ok = false;
    if (lk.b && (f.b | 0) < lk.b) ok = false;
    if (lk.t && (f.t | 0) < lk.t) ok = false;
    if (lk.e && (f.e | 0) < lk.e) ok = false;
    if (lk.g && (f.g | 0) < lk.g) ok = false;
    if (lk.k && (f.k | 0) < lk.k) ok = false;
    if (lk.d && !inWin(lk.d, today(f))) ok = false;
    if (ok) return true;
    return !!(lk.o && lk.o.some(function (x) { return unlocked(x, f); }));
  }
  // Free to use now: unlocked, or it is what you already wear (kept after a season ends).
  function usable(k, i, f) { return unlocked(lockOf(k, i), f) || !!(me && me.spec && (me.spec[k] | 0) === i && i > 0); }
  function rarity(k, i) {
    if (RARE[k + ":" + i]) return RARE[k + ":" + i];
    var lk = lockOf(k, i); if (!lk) return 0;
    if (lk.d && !lk.o) return 0;
    var x = lk.d && lk.o ? lk.o[lk.o.length - 1] : lk;
    if (x.r >= 30) return 4; if (x.r >= 20) return 3;
    if (x.r >= 10 || x.m || x.s >= 3 || x.b >= 10 || x.t >= 4 || x.e >= 3 || x.g >= 3) return 2;
    return 1;
  }
  var RAR_N = [null, ["Ovanlig", "Uncommon"], ["Sällsynt", "Rare"], ["Episk", "Epic"], ["Legendarisk", "Legendary"]];
  function rankTitle(idx) {
    var T = window.SOCIAL && window.SOCIAL.TITLES;
    return T && T[idx - 1] ? T[idx - 1][1] : L("grad ", "rank ") + idx;
  }
  function medalName(id) { try { return window.MEDALS.info(id).name; } catch (e) { return id; } }
  var MON = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"], MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dayTxt(md) { var m = +md.slice(0, 2) - 1, d = +md.slice(3, 5); return sv() ? d + " " + MON[m] : MON_EN[m] + " " + d; }
  function winTxt(w) { return dayTxt(w.slice(0, 5)) + "–" + dayTxt(w.slice(6, 11)); }
  function needTxt(lk) {   // one need, no "Låses upp" prefix
    if (lk.r) return L("vid ", "at ") + rankTitle(lk.r);
    if (lk.m) return L("med medaljen ", "with the medal ") + medalName(lk.m);
    if (lk.s) return L("vid " + lk.s + " helger i rad", "at a " + lk.s + "-weekend streak");
    if (lk.b) return L("vid " + lk.b + " krogar i Ölpasset", "at " + lk.b + " bars in the passport");
    if (lk.t) return L("vid " + lk.t + " orter", "at " + lk.t + " towns");
    if (lk.e) return L("när du gått på " + (lk.e === 1 ? "ett event" : lk.e + " event"), "after " + lk.e + " event(s)");
    if (lk.g) return L("när du är med i " + (lk.g === 1 ? "en grupp" : lk.g + " grupper"), "when you are in " + lk.g + " group(s)");
    if (lk.k) return L("när du tagit " + (lk.k === 1 ? "en bild" : lk.k + " bilder") + " med engångskameran", "after " + lk.k + " disposable camera shot(s)");
    if (lk.d) return L("under ", "during ") + winTxt(lk.d);
    return "";
  }
  function lockText(lk) {
    if (lk.d) {
      var t = (SEASON[lk.d] ? SEASON[lk.d] + " " : "") + L("Säsong: ", "Season: ") + winTxt(lk.d);
      if (lk.o) t += L(" · annars ", " · or ") + lk.o.map(function (x) { return x.d ? L("under ", "during ") + winTxt(x.d) : needTxt(x); }).join(L(" eller ", " or "));
      return t;
    }
    return L("Låses upp ", "Unlocks ") + needTxt(lk);
  }
  function shortLock(lk) {
    if (lk.d) return (SEASON[lk.d] || "📅") + " " + dayTxt(lk.d.slice(0, 5));
    if (lk.r) { var t = rankTitle(lk.r); return t.split(" ")[0]; }
    if (lk.m) return medalName(lk.m);
    if (lk.s) return lk.s + L(" helger", " weekends");
    if (lk.b) return lk.b + L(" krogar", " bars");
    if (lk.t) return lk.t + L(" orter", " towns");
    if (lk.e) return lk.e + " event";
    if (lk.g) return lk.g + L(lk.g === 1 ? " grupp" : " grupper", " groups");
    if (lk.k) return "📸 " + lk.k;
    return "";
  }

  /* ---------- Editor: category chips + sub-tabs, lazy tile grid, live preview, 🎲 with "lock this slot", "Nytt" dots ---------- */
  var FACE_VB = "24 20 52 52", EYE_VB = "31 33 38 24", NECK_VB = "22 58 56 42", HAND_VB = "0 46 54 54";
  var TABS = [
    ["face", "Ansikte", "Face", [["sk", "Hudton", "Skin", "sw"], ["fs", "Form", "Shape"], ["ey", "Ögon", "Eyes", FACE_VB], ["ec", "Ögonfärg", "Eye colour", "sw"], ["br", "Bryn", "Brows", FACE_VB],
      ["ns", "Näsa", "Nose", FACE_VB], ["mt", "Mun", "Mouth", FACE_VB], ["ck", "Kinder", "Cheeks", FACE_VB]]],
    ["det", "Detaljer", "Details", [["fm", "Märken", "Marks", FACE_VB], ["fp", "Målning", "Paint", FACE_VB], ["er", "Öron", "Ears", FACE_VB]]],
    ["hair", "Hår", "Hair", [["hr", "Frisyr", "Style"], ["hc", "Färg", "Colour", "sw"]]],
    ["beard", "Skägg", "Beard", [["fh", "Skägg & mustasch", "Beard & mustache", FACE_VB]]],
    ["head", "Huvud", "Hat", [["hw", "Huvudbonad", "Headwear"]]],
    ["acc", "Glasögon", "Glasses", [["gl", "Glasögon & masker", "Glasses & masks", FACE_VB]]],
    ["uni", "Kläder", "Clothes", [["up", "Överdel", "Top"], ["uc", "Färg", "Colour", "sw"], ["nk", "Hals", "Neck", NECK_VB], ["md", "Medaljer", "Medals"]]],
    ["hand", "Hand", "Hand", [["hi", "Håller i", "Holding", HAND_VB]]],
    ["bg", "Bakgrund", "Background", [["bg", "Bakgrund", "Background"], ["fr", "Ram", "Frame"]]]
  ];
  // avt07: ONE row of parts (was categories + a second row of sub-tabs). Each part = its own tab with one sub (sub row hidden).
  TABS = (function () {
    var out = [], one = { beard: 1, head: 1, acc: 1, hand: 1 }, REN = { hc: ["Hårfärg", "Hair colour"], uc: ["Klädfärg", "Clothes colour"] };
    TABS.forEach(function (t) { t[3].forEach(function (sd) { var nm = one[t[0]] ? [t[1], t[2]] : REN[sd[0]] || [sd[1], sd[2]]; out.push([t[0] + "-" + sd[0], nm[0], nm[1], [sd]]); }); });
    return out;
  })();
  // avt07: the rank name from the client ladder (social.js, ladder 15) like Profil; the server's facts.title can be an old name
  function myTitle(f) { try { if (f && f.mer != null && window.SOCIAL && window.SOCIAL.titleFor) return window.SOCIAL.titleFor(f.mer | 0).title; } catch (e) {} return (f && f.title) || rankTitle((f && f.r) || 1); }
  var COLOR_OF = { hc: ["hx", HAIRC], uc: ["ux", TOPC] };   // palette slot → its "egen färg" key
  var KEEP_LINK = { hc: ["hx", "h2", "ht"], uc: ["ux"], bg: ["bx"] };
  function tileVB(k) { for (var i = 0; i < TABS.length; i++) for (var j = 0; j < TABS[i][3].length; j++) if (TABS[i][3][j][0] === k) return TABS[i][3][j][3] && TABS[i][3][j][3] !== "sw" ? TABS[i][3][j][3] : ""; return ""; }
  var SAVE_SV = ["Snyggt! Nu känner gänget igen dä.", "Sparat. Spegeln säger tack.", "Uniformen sitter. Ut å visa dä!",
    "Klart! Nu ä du snyggast på kartan.", "Sparad, soldat. Lagom stilig.", "Ny look inskriven i liggaren.", "Dä va fint, dä. Sparat!"];
  var DICE_SV = ["Tärningen har talat!", "Slumpen ä din stylist ikväll.", "Ny agent, samma törst.", "Hemlig identitet: klar.", "Inkognito? Ja, typ."];
  var lastSave = -1, lastDice = -1;
  function pickLine(a, last) { var i = Math.floor(Math.random() * a.length); if (a.length > 1 && i === last) i = (i + 1) % a.length; return i; }
  function lsGet(k, d) { try { return U.ls.getJSON(k, d); } catch (e) { return d; } }
  function lsSet(k, v) { try { if (U.ls.setJSON) U.ls.setJSON(k, v); else U.ls.set(k, JSON.stringify(v)); } catch (e) {} }
  var edTab = "face", edSub = { };
  var keep = lsGet("olnu.avKeep", {}) || {};   // slots the 🎲 must not change
  /* "Nytt": an item shows a dot until you have seen its sub-tab while it was usable. First run: every v1 item counts as seen. */
  var seen = null;
  function seenLoad() {
    if (seen) return seen;
    var x = lsGet("olnu.avSeen", null);
    if (x && x.v === 2 && x.s) { seen = x; return seen; }
    seen = { v: 2, s: {} };
    Object.keys(V1MAX).forEach(function (k) { var a = []; for (var i = 0; i <= V1MAX[k]; i++) a.push(i); seen.s[k] = a; });
    lsSet("olnu.avSeen", seen);
    return seen;
  }
  function isNew(k, i, f) { if (isRetired(k, i)) return false; if (!LOCKS[k + ":" + i] && (k in V1MAX)) return false; if (!usable(k, i, f)) return false; var a = seenLoad().s[k]; return !a || a.indexOf(i) < 0; }
  function markSeen(k, f) {
    if (!(k in N)) return;
    var a = seenLoad().s[k] = seenLoad().s[k] || [], ch = false;
    for (var i = 0; i <= MAX[k]; i++) if (usable(k, i, f) && a.indexOf(i) < 0) { a.push(i); ch = true; }
    if (ch) lsSet("olnu.avSeen", seen);
  }
  function newIn(k, f) { if (!(k in N)) return 0; var n = 0; for (var i = 0; i <= MAX[k]; i++) if (isNew(k, i, f)) n++; return n; }
  function openEditor(opts) {
    if (off || !A || !A.openSheet) return;
    var go = function () {
      if (!me) { A.toast(L("Kunde int' hämta din avatar. Prova igen.", "Could not load your avatar."), { err: true }); return; }
      if (!me.spec && !(opts && opts.full) && window.AVWIZ && window.AVWIZ.open) { window.AVWIZ.open(); return; }   // v3
      A.openSheet(L("Min karaktär", "My character"), build);
    };
    if (me) go(); else loadMe().then(go);
  }
  function build(body) {
    var f = me.facts || {}, saved = me.spec ? JSON.stringify(clean(me.spec)) : "";
    var draft = migrate(JSON.parse(JSON.stringify(me.spec || defaultSpec(me.seed, f.r))));
    if (draft.ms == null) draft.ms = 1;
    var wrap = document.createElement("div"); wrap.className = "ave";
    var unl = 0, tot = 0;
    Object.keys(LOCKS).forEach(function (k) { var kk = k.split(":"); if (isRetired(kk[0], +kk[1])) return; tot++; if (unlocked(LOCKS[k], f)) unl++; });
    var items = 0; SLOTS.forEach(function (k) { items += MAX[k] + 1; });
    wrap.innerHTML =
      '<div class="ave-top"><div class="ave-prev" aria-live="polite"></div></div>' +   // avt07: actions in one row under the preview
      '<div class="ave-acts"><button type="button" class="btn ave-dice">' + ic("game") + esc(L("Slumpa", "Randomise")) + "</button>" +
      (window.AVWIZ ? '<button type="button" class="btn ave-wiz">' + ic("compass") + esc(L("Steg för steg", "Step by step")) + "</button>" : "") + "</div>" +
      '<p class="ave-rank"><b>🎖️ ' + esc(myTitle(f)) + "</b> · " + esc(L(unl + " av " + tot + " specialgrejer upplåsta", unl + " of " + tot + " special items unlocked")) + "</p>" +
      '<div class="ave-nav"><div class="ave-tabs" role="tablist"></div><div class="ave-subs" role="tablist"></div></div><div class="ave-body"></div>' +
      '<div class="ave-bar"><button type="button" class="btn btn-amber btn-block ave-save">' + esc(L("Spara", "Save")) + "</button></div>";
    body.appendChild(wrap);
    var bar = wrap.querySelector(".ave-bar"), prev = wrap.querySelector(".ave-prev"), tabs = wrap.querySelector(".ave-tabs"), subs = wrap.querySelector(".ave-subs"), pane = wrap.querySelector(".ave-body"), save = wrap.querySelector(".ave-save");
    function md() { return draft.ms === 0 ? [] : draft.md && draft.md.length ? draft.md : myMedals(null, f); }
    var pvT = 0;
    function paintPrev() {
      if (pvT) return;
      pvT = requestAnimationFrame(function () {
        pvT = 0;
        prev.innerHTML = svg(draft, { r: f.r, md: md() });
        var dirty = JSON.stringify(clean(draft)) !== saved;
        save.disabled = !dirty; bar.hidden = !dirty;   // avt07: the Spara bar shows only when there is something to save
        save.textContent = dirty ? L("Spara", "Save") : L("Sparad ✓", "Saved ✓");
      });
    }
    function ic(n) { try { return window.PNI && window.PNI.has(n) ? window.PNI.svg(n, "ave-ic") : ""; } catch (e) { return ""; } }
    function tabDef() { for (var i = 0; i < TABS.length; i++) if (TABS[i][0] === edTab) return TABS[i]; return TABS[0]; }
    function subDef() { var t = tabDef(), k = edSub[t[0]]; for (var j = 0; j < t[3].length; j++) if (t[3][j][0] === k) return t[3][j]; return t[3][0]; }
    TABS.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "ave-tab"; b.setAttribute("role", "tab"); b.setAttribute("data-t", t[0]);
      b.innerHTML = esc(sv() ? t[1] : t[2]) + '<i class="ave-dot" aria-hidden="true"></i>';
      b.addEventListener("click", function () { edTab = t[0]; paintTabs(); paintPane(); try { b.scrollIntoView({ block: "nearest", inline: "center", behavior: reduced() ? "auto" : "smooth" }); } catch (e) {} });
      tabs.appendChild(b);
    });
    function paintTabs() {
      tabs.querySelectorAll(".ave-tab").forEach(function (b) {
        var t = null; TABS.forEach(function (x) { if (x[0] === b.getAttribute("data-t")) t = x; });
        var on = t[0] === edTab, nw = t[3].some(function (sd) { return newIn(sd[0], f) > 0; });
        b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false"); b.classList.toggle("has-new", nw);
      });
      var t = tabDef(), cur = subDef()[0];
      subs.innerHTML = "";
      subs.hidden = t[3].length < 2;
      t[3].forEach(function (sd) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "ave-sub" + (sd[0] === cur ? " on" : "") + (newIn(sd[0], f) ? " has-new" : "");
        b.setAttribute("role", "tab"); b.setAttribute("aria-selected", sd[0] === cur ? "true" : "false"); b.setAttribute("data-k", sd[0]);
        b.innerHTML = esc(sv() ? sd[1] : sd[2]) + '<i class="ave-dot" aria-hidden="true"></i>';
        b.addEventListener("click", function () { edSub[t[0]] = sd[0]; paintTabs(); paintPane(); });
        subs.appendChild(b);
      });
    }
    // lazy tiles: the SVG is drawn when the tile comes near the screen (smooth scroll with ~40 tiles)
    var io = null;
    try { io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { fill(e.target); io.unobserve(e.target); } }); }, { root: body, rootMargin: "240px 0px" }); } catch (e) { io = null; }
    function fill(b) {
      var art = b.querySelector(".ave-art"); if (!art || art.firstChild) return;
      var k = b.getAttribute("data-k"), i = +b.getAttribute("data-i"), t = JSON.parse(JSON.stringify(draft)); t[k] = i;
      if (k === "bg" && i === 16 && !t.bx) t.bx = valOf("#f5a623");
      art.innerHTML = svg(t, { r: f.r, md: md(), vb: b.getAttribute("data-vb") || "" });
    }
    function tile(k, i, mode) {
      var lk = lockOf(k, i), ok = usable(k, i, f), sel = (draft[k] | 0) === i, rar = rarity(k, i);
      var b = document.createElement("button");
      b.type = "button"; b.className = "ave-tile" + (sel ? " on" : "") + (ok ? "" : " locked") + (mode === "sw" ? " sw" : "") + (rar ? " r" + rar : "") + (isNew(k, i, f) ? " is-new" : "");
      b.setAttribute("aria-pressed", sel ? "true" : "false"); b.setAttribute("data-k", k); b.setAttribute("data-i", i);
      var nm = (N[k][i] || ["", ""])[sv() ? 0 : 1];
      b.setAttribute("aria-label", nm + (rar ? " (" + RAR_N[rar][sv() ? 0 : 1] + ")" : "") + (ok ? "" : " — " + lockText(lk)) + (ok && lk && lk.d ? " — " + lockText(lk) : ""));
      var art;
      if (mode === "sw") {
        var col = k === "sk" ? SKIN[i] : k === "hc" ? HAIRC[i] : k === "ec" ? EYEC[i] : TOPC[i];
        art = '<span class="ave-sw" style="background:' + col + '"></span>';
      } else {
        art = '<span class="ave-art"></span>';
        if (mode) b.setAttribute("data-vb", mode);
      }
      b.innerHTML = art + (rar ? '<span class="ave-gem" aria-hidden="true"></span>' : "") + (lk && lk.d ? '<span class="ave-sz" aria-hidden="true">' + (SEASON[lk.d] || "📅") + "</span>" : "") +
        '<i class="ave-dot" aria-hidden="true"></i>' +
        (ok ? '<span class="ave-nm">' + esc(nm) + "</span>" : '<span class="ave-lk" aria-hidden="true">🔒</span><span class="ave-nm">' + esc(shortLock(lk)) + "</span>");
      b.addEventListener("click", function () {
        if (!ok) { A.toast("🔒 " + lockText(lk), { ms: 3800, id: "ave-lock" }); return; }
        draft[k] = i;
        if (COLOR_OF[k]) delete draft[COLOR_OF[k][0]];
        if (k === "bg" && i === 16 && !draft.bx) draft.bx = valOf("#f5a623");
        if (lk && lk.d && unlocked({ d: lk.d }, f)) A.toast((SEASON[lk.d] || "📅") + " " + L("Säsongsgrej! Spara nu så behåller du den.", "Seasonal! Save now and you keep it."), { ms: 3000, id: "ave-season" });
        paintPrev();
        var grid = b.parentNode;
        grid.querySelectorAll(".ave-tile.on").forEach(function (x) { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); });
        b.classList.add("on"); b.setAttribute("aria-pressed", "true");
        if (mode === "sw" || k === "hr" || k === "up" || k === "nk" || k === "bg" && i === 16) paintPane(true);   // colours / styles change other tiles' art
      });
      if (mode !== "sw") { if (io) io.observe(b); else fill(b); }
      return b;
    }
    function swatchRow(k, title) {   // compact colour row (palette + egen färg) on top of the hair / top grid
      var sec = document.createElement("div"); sec.className = "ave-cols";
      var pal = k === "hc" ? HAIRC : k === "uc" ? TOPC : null, ck = COLOR_OF[k] ? COLOR_OF[k][0] : "bx", cur = hexOf(draft[ck]);
      if (title) { var h = document.createElement("h4"); h.textContent = title; sec.appendChild(h); }
      var row = document.createElement("div"); row.className = "ave-colrow";
      (pal ? visible(k) : []).forEach(function (i) {
        var c = pal[i], lk = lockOf(k, i), ok = usable(k, i, f), b = document.createElement("button");
        b.type = "button"; b.className = "ave-cs" + (!cur && (draft[k] | 0) === i ? " on" : "") + (ok ? "" : " locked");
        b.style.background = c; b.setAttribute("aria-label", N[k][i][sv() ? 0 : 1] + (ok ? "" : " — " + lockText(lk)));
        if (!ok) b.textContent = "🔒";
        b.addEventListener("click", function () { if (!ok) { A.toast("🔒 " + lockText(lk), { ms: 3800, id: "ave-lock" }); return; } draft[k] = i; delete draft[ck]; paintPrev(); paintPane(true); });
        row.appendChild(b);
      });
      row.appendChild(customBtn(ck, cur || (pal ? pal[draft[k] | 0] : "#f5a623"), !!cur, function () { if (k === "bg") draft.bg = 16; }));
      sec.appendChild(row);
      return sec;
    }
    function customBtn(ck, val, on, pre) {
      var lab = document.createElement("label"); lab.className = "ave-cs ave-own" + (on ? " on" : "");
      lab.setAttribute("title", L("Egen färg", "Own colour"));
      lab.innerHTML = '<span aria-hidden="true">🎨</span><input type="color" aria-label="' + esc(L("Egen färg", "Own colour")) + '" value="' + esc(val) + '">';
      if (on) lab.style.background = val;
      var inp = lab.querySelector("input");
      inp.addEventListener("input", function () { if (pre) pre(); draft[ck] = valOf(inp.value); lab.style.background = inp.value; lab.classList.add("on"); paintPrev(); });
      inp.addEventListener("change", function () { if (pre) pre(); draft[ck] = valOf(inp.value); paintPrev(); paintPane(true); });
      return lab;
    }
    function keepBtn(k) {
      var on = !!keep[k], b = document.createElement("button");
      b.type = "button"; b.className = "ave-keep" + (on ? " on" : ""); b.setAttribute("aria-pressed", on ? "true" : "false");
      b.innerHTML = (on ? "🔒 " : "🔓 ") + esc(on ? L("Låst vid 🎲", "Kept on 🎲") : L("Lås vid 🎲", "Keep on 🎲"));
      b.addEventListener("click", function () { if (keep[k]) delete keep[k]; else keep[k] = 1; lsSet("olnu.avKeep", keep); paintPane(true); });
      return b;
    }
    function paintPane(keepScroll) {
      var st = keepScroll ? body.scrollTop : 0, sd = subDef(), k = sd[0];
      pane.innerHTML = "";
      var sec = document.createElement("section"); sec.className = "ave-sec";
      var hd = document.createElement("div"); hd.className = "ave-hd";
      var h = document.createElement("h3"); h.textContent = (sv() ? sd[1] : sd[2]) + (k in N ? " · " + visible(k).length : ""); hd.appendChild(h);
      if (k !== "md") hd.appendChild(keepBtn(k === "md" ? "ms" : k));
      sec.appendChild(hd);
      if (k === "md") { pane.appendChild(medalSec()); if (keepScroll) body.scrollTop = st; return; }
      if (k === "uc" && draft.up >= 4 && draft.up <= 14 && [4, 5, 6, 7, 8, 9, 10, 12, 13, 14].indexOf(draft.up) >= 0) {
        var p = document.createElement("p"); p.className = "muted ave-note"; p.textContent = L("Färgen gäller civila kläder och kepsar.", "Colour is for civilian tops and caps."); sec.appendChild(p);
      }
      if (k === "hr") sec.appendChild(swatchRow("hc"));
      if (k === "up") sec.appendChild(swatchRow("uc"));
      if (k === "nk") sec.appendChild(layerSeg());
      var grid = document.createElement("div"); grid.className = "ave-grid" + (sd[3] === "sw" ? " ave-grid-sw" : "");
      visible(k).forEach(function (i) { grid.appendChild(tile(k, i, sd[3] || "")); });
      if (k === "hc" || k === "uc") grid.appendChild(customBtn(COLOR_OF[k][0], hexOf(draft[COLOR_OF[k][0]]) || COLOR_OF[k][1][draft[k] | 0], !!draft[COLOR_OF[k][0]]));
      sec.appendChild(grid);
      if (k === "hc") sec.appendChild(twoTone());
      if (k === "bg") { var bc = swatchRow("bg", L("Egen färg (även Ränder, Prickar, Rutig duk, Dalahästar)", "Own colour (also Stripes, Dots, Gingham, Dala horses)")); sec.appendChild(bc); }
      pane.appendChild(sec);
      if (keepScroll) body.scrollTop = st;
      markSeen(k, f);
    }
    function layerSeg() {   // avt01: Utanpå / Instoppad for scarves and chains (DESIGN.md: the one segmented control)
      var box = document.createElement("div"); box.className = "ave-layer";
      if (!NKL[draft.nk | 0]) { box.hidden = true; return box; }
      var seg = document.createElement("div"); seg.className = "ds-seg ave-seg"; seg.setAttribute("role", "radiogroup"); seg.setAttribute("aria-label", L("Hur bärs den?", "How is it worn?"));
      [[0, L("Utanpå", "Over")], [1, L("Instoppad", "Tucked in")]].forEach(function (o) {
        var on = (draft.nl | 0) === o[0], b = document.createElement("button");
        b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", on ? "true" : "false"); b.setAttribute("data-nl", o[0]); b.textContent = o[1];
        b.addEventListener("click", function () { if (o[0]) draft.nl = 1; else delete draft.nl; paintPrev(); paintPane(true); });
        seg.appendChild(b);
      });
      box.appendChild(seg);
      return box;
    }
    function twoTone() {
      var sec = document.createElement("div"); sec.className = "ave-cols";
      var h = document.createElement("h4"); h.textContent = L("Tvåfärgat hår", "Two-tone hair"); sec.appendChild(h);
      var row = document.createElement("div"); row.className = "ave-colrow";
      var off0 = document.createElement("button"); off0.type = "button"; off0.className = "ave-cs ave-none" + (!draft.h2 ? " on" : ""); off0.textContent = L("Av", "Off");
      off0.addEventListener("click", function () { delete draft.h2; delete draft.ht; paintPrev(); paintPane(true); }); row.appendChild(off0);
      visible("hc").forEach(function (i) {
        var c = HAIRC[i], lk = lockOf("hc", i), ok = usable("hc", i, f), b = document.createElement("button");
        b.type = "button"; b.className = "ave-cs" + ((draft.h2 | 0) === i + 1 ? " on" : "") + (ok ? "" : " locked"); b.style.background = c;
        b.setAttribute("aria-label", L("Andra färg: ", "Second colour: ") + N.hc[i][sv() ? 0 : 1]); if (!ok) b.textContent = "🔒";
        b.addEventListener("click", function () { if (!ok) { A.toast("🔒 " + lockText(lk), { ms: 3800, id: "ave-lock" }); return; } draft.h2 = i + 1; paintPrev(); paintPane(true); });
        row.appendChild(b);
      });
      sec.appendChild(row);
      if (draft.h2) {
        var g = document.createElement("div"); g.className = "ave-grid";
        N.ht.forEach(function (nm, i) {
          var b = document.createElement("button"); b.type = "button"; b.className = "ave-tile" + ((draft.ht | 0) === i ? " on" : ""); b.setAttribute("aria-pressed", (draft.ht | 0) === i ? "true" : "false");
          var t = JSON.parse(JSON.stringify(draft)); t.ht = i; t.hw = 0;
          b.innerHTML = '<span class="ave-art">' + svg(t, { r: f.r, md: md() }) + '</span><span class="ave-nm">' + esc(nm[sv() ? 0 : 1]) + "</span>";
          b.addEventListener("click", function () { draft.ht = i; paintPrev(); paintPane(true); });
          g.appendChild(b);
        });
        sec.appendChild(g);
      }
      return sec;
    }
    function medalSec() {
      var sec = document.createElement("section"); sec.className = "ave-sec";
      var h = document.createElement("h3"); h.textContent = L("Medaljer på bröstet", "Medals on the chest"); sec.appendChild(h);
      var row = document.createElement("div"); row.className = "toggle-row ave-ms";
      row.innerHTML = '<span>' + esc(L("Visa mina medaljer", "Show my medals")) + '</span><button type="button" class="switch" role="switch" aria-checked="' + (draft.ms === 0 ? "false" : "true") + '" aria-label="' + esc(L("Visa mina medaljer", "Show my medals")) + '"></button>';
      row.addEventListener("click", function () { draft.ms = draft.ms === 0 ? 1 : 0; paintPrev(); paintPane(true); });
      sec.appendChild(row);
      var mine = (f.m || []).filter(function (x) { return !HIDDEN_MEDALS[x]; });
      if (!mine.length) {
        var p0 = document.createElement("p"); p0.className = "muted ave-note"; p0.textContent = L("Inga medaljer än. Ut å förtjäna dom!", "No medals yet."); sec.appendChild(p0);
        return sec;
      }
      if (draft.ms === 0) return sec;
      var pick = draft.md || [];
      var p = document.createElement("p"); p.className = "muted ave-note";
      p.textContent = pick.length ? L("Valda: " + pick.length + " av 6", "Picked: " + pick.length + " of 6") : L("Välj upp till 6. Annars syns dina 5 senaste.", "Pick up to 6. Otherwise your 5 newest show.");
      sec.appendChild(p);
      var grid = document.createElement("div"); grid.className = "ave-medals";
      mine.forEach(function (id) {
        var on = pick.indexOf(id) >= 0, b = document.createElement("button");
        b.type = "button"; b.className = "ave-md" + (on ? " on" : ""); b.setAttribute("aria-pressed", on ? "true" : "false");
        var bg = ""; try { bg = window.MEDALS.ribbonBg(id); } catch (e) {}
        b.innerHTML = '<span class="ave-rb" style="background:' + esc(bg || "#666") + '"></span><span>' + esc(medalName(id)) + "</span>";
        b.addEventListener("click", function () {
          var cur = (draft.md || []).slice(), at = cur.indexOf(id);
          if (at >= 0) cur.splice(at, 1);
          else { if (cur.length >= 6) { A.toast(L("Max 6 medaljer på bröstet. Ta bort en först.", "Max 6 medals."), { id: "ave-md" }); return; } cur.push(id); }
          if (cur.length) draft.md = cur; else delete draft.md;
          paintPrev(); paintPane(true);
        });
        grid.appendChild(b);
      });
      sec.appendChild(grid);
      return sec;
    }
    var wz = wrap.querySelector(".ave-wiz");
    if (wz) wz.addEventListener("click", function () { try { window.AVWIZ.open({ from: draft }); } catch (e) {} });
    wrap.querySelector(".ave-dice").addEventListener("click", function () {
      var RR = Math.random, kept = { ms: draft.ms, md: draft.md };
      nice(draft, f, null, keep);   // avt01: nice looks, the top stands out from the background
      if (draft.bg === 16 && !draft.bx) draft.bx = valOf(["#f5a623", "#1fa45c", "#2f6fb8", "#d9578f"][Math.floor(RR() * 4)]);
      draft.ms = kept.ms; if (kept.md) draft.md = kept.md;
      paintPrev(); paintPane(true);
      lastDice = pickLine(DICE_SV, lastDice);
      A.toast(sv() ? "🎲 " + DICE_SV[lastDice] : "🎲 New look!", { ms: 2200, id: "ave-dice" });
      try { prev.animate && !reduced() && prev.animate([{ transform: "rotate(-8deg) scale(.94)" }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.05,.7,.1,1)" }); } catch (e) {}
    });
    save.addEventListener("click", function () {
      if (save.disabled) return;
      save.disabled = true; save.textContent = "…";
      var spec = clean(draft);
      setSpec(spec).then(function (r) {
        if (r.error) {
          var c = codeOf(r.error);
          A.toast(c === "locked" ? L("Dä där ä låst än. Samla fler meriter!", "That item is still locked.") : c === "slow_down" ? L("Lugna dä, prova igen om en sekund.", "Slow down, try again.") : L("Kunde int' spara. Prova igen.", "Could not save. Try again."), { err: true });
          saved = ""; paintPrev(); return;
        }
        var d = parse(r.data);
        afterSave(d.spec || spec); saved = JSON.stringify(clean(me.spec));
        paintPrev();
        lastSave = pickLine(SAVE_SV, lastSave);
        A.toast(r.noNl ? L("👤 Sparat utanpå. Instoppad kommer i nästa uppdatering.", "👤 Saved as over. Tucked in comes in the next update.") : sv() ? "👤 " + SAVE_SV[lastSave] : "👤 Saved!", { ms: r.noNl ? 4200 : 3000 });   // avt01
        try { if (window.FX && window.FX.vibrate) window.FX.vibrate(12); } catch (e) {}
      });
    });
    paintTabs(); paintPane(); paintPrev();
  }
  function clean(d) {   // v1 keys always (old clients), v2 keys only when set (small spec)
    d = migrate(JSON.parse(JSON.stringify(d || {})));   // avt01: retired items → kept items
    var o = { v: 2 };
    V1KEYS.forEach(function (k) { o[k] = clamp(d, k); });
    Object.keys(MAX).forEach(function (k) { if (V1KEYS.indexOf(k) < 0 && k !== "ms") { var v = clamp(d, k); if (v) o[k] = v; } });
    if (!o.h2) delete o.ht;
    if (d.ms === 0) o.ms = 0;
    if (d.md && d.md.length) o.md = d.md.slice(0, 6);
    return o;
  }
  function reduced() { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }

  window.AVATAR = {
    svg: svg, defaultSpec: defaultSpec, LOCKS: LOCKS, MAX: MAX, NAMES: N, SLOTS: SLOTS, PREMIUM_LATER: PREMIUM_LATER,
    unlocked: unlocked, lockText: lockText, rarity: rarity, tileVB: tileVB, clean: clean,
    me: function () { return me && me.spec ? me : null; }, on: function () { return !off; },
    // v3 (avwiz.js)
    meRaw: function () { return me; }, loadMe: loadMe, saveSpec: saveSpec, usable: usable, lockOf: lockOf, shortLock: shortLock,
    visible: visible, migrate: migrate, nice: nice, isRetired: isRetired, RETIRED: RETIRED, ORDER: ORDER, NKL: NKL, HCLIP: HCLIP, HAIRTOP: HAIRTOP, contrastOk: contrastOk, _layers: layerSVGs, _oldFit: function (v) { OLDFIT = !!v; svgMemo = {}; },
    gf: function () { return grandfathered(me && me.facts); }, PAL: { SKIN: SKIN, HAIRC: HAIRC, TOPC: TOPC, EYEC: EYEC, BGC: BGC },
    VB: { FACE: FACE_VB, EYE: EYE_VB, NECK: NECK_VB, HAND: HAND_VB }, rankTitle: rankTitle,
    chatSeen: chatSeen, statusRow: statusRow, friendRow: friendRow, faces: faces, profileAv: profileAv,
    openEditor: openEditor, forGroup: forGroup, forFriends: forFriends, repaint: repaint,
    // avpins.js (map pins): the loaded caches {at, byName, byK, me}, friends first
    _caches: function () { var o = []; if (friends && friends.data) o.push(friends.data); Object.keys(groups || {}).forEach(function (g) { if (groups[g] && groups[g].data) o.push(groups[g].data); }); return o; },
    init: function (api) { A = api; },
    onAuthed: function () { loadMe(true); setTimeout(retryLoads, 0); },
    onPoll: function () { retryLoads(); }
  };
})();
