/* Öl Nu v20 TRUPPEN — all texts for docs/js/crew.js (window.CREW_CONTENT).
   Swedish: dalmål + military humour (owner rule: "ä", not "é"). English fallback in "en".
   Placeholders: {namn} {bar} {tid} {min} {grupp} {stad} {n} {dag}. Never "drink more": care, meeting, moving. */
(function () {
  "use strict";
  window.CREW_CONTENT = {
    sv: {
      // 🚌 Avgångstavlan
      depSet: [
        "🚌 Avgång {tid} mot {bar}. Truppen ä informerad.",
        "📋 Marschorder utfärdad: {tid}, {bar}. Kängorna på!",
        "🚌 Tavlan ä uppdaterad. {tid} rullar vi, int' en minut senare.",
        "🪖 Avgång {tid}. Den som int' ä klar får gå själv, dä ä regeln.",
        "🎺 Revelj för förfesten: vi drar {tid} till {bar}.",
        "🚌 Bussen till {bar} går {tid}. Det finns ingen buss. Ni går.",
        "📯 Uppbrott {tid}! Packa leg, nycklar och humöret.",
        "🗺️ Mål: {bar}. Tid: {tid}. Uppdraget ä enkelt, soldat.",
        "⏱️ Klockan ä ställd. {tid} ä det avmarsch, hörru.",
        "🚌 Linje 1 mot {bar}, avgång {tid}. Ingen biljett, bara bra humör.",
        "🪖 Kapten har talat: {tid} lämnar vi skyttegraven.",
        "🚌 {tid} drar vi. Den som letar efter jackan då får skämmas lite.",
        "🧭 Kursen satt mot {bar}. Avgång {tid}, inga undantag.",
        "🚂 Malmtåget mot {bar} lämnar perrongen {tid}.",
        "📋 Order: alla vid dörren {tid}. Den som ä sist bjuder på vatten."
      ],
      depNew: [
        "🚌 {namn} har satt avgång {tid} → {bar}.",
        "📋 Ny marschorder från {namn}: {tid} mot {bar}.",
        "🪖 {namn} blåser till uppbrott {tid}. Vart? {bar}.",
        "🚌 Avgångstavlan: {tid} {bar} (av {namn}). Ä du med?",
        "📯 {namn}: \"Vi drar {tid}!\" Tryck Med! om du hänger på."
      ],
      depT5: [
        "🚌 5 min till avgång mot {bar}! Jackan, soldat. JACKAN.",
        "⏰ T minus 5. Leg, nycklar, mobil? Bra. Mot {bar}!",
        "🪖 Fem minuter kvar. Den som sitter ner nu står upp om fyra.",
        "🚌 Bussen till {bar} går om 5 min. Den finns fortfarande int'.",
        "🎺 5 min! Sista kollen i spegeln, sen marsch.",
        "📋 Nedräkning: 5 min till {bar}. Ingen lämnas kvar.",
        "⏱️ 5 min till avmarsch. Har du druckit vatten? Gör det nu.",
        "🧥 5 min. Garderobslappen? Nycklarna? Kompisen?"
      ],
      depGo: [
        "🚌 AVGÅNG! Mot {bar}. Den som int' ä klar får gå själv.",
        "🪖 Framåt marsch! {bar} väntar.",
        "📯 Nu drar vi! Håll ihop över gatan, soldater.",
        "🚌 Dörrarna stängs. Nästa stopp: {bar}.",
        "🎺 Uppbrott! Den som ligger efter får bära kartan.",
        "🚂 Tuuut! Malmtåget har lämnat förfesten."
      ],
      medJa: [
        "🙋 Du ä med! Ställ dig i ledet.",
        "✅ Inskriven på listan. Ingen återvändo.",
        "🪖 Anmäld till marschen. Bra jobbat, menig.",
        "🙋 Med! Ölguden nickar gillande.",
        "✅ Du ä på bussen. Den osynliga bussen."
      ],
      medNej: [
        "🙅 Avanmäld. Vi saknar dig redan lite.",
        "🫡 Okej, du stannar i förrådet.",
        "🙅 Ingen fara. Vila ä också en order."
      ],
      depNone: "Ingen avgång satt. Vem tar befälet?",
      // 🗓️ Vilken kväll?
      datesNew: [
        "🗓️ {namn} undrar: vilken kväll kör vi? Rösta i Truppen.",
        "📅 Planeringsmöte! {namn} har lagt ut datum.",
        "🗓️ Ny omröstning: {namn} vill veta när truppen ä ledig.",
        "📋 Kallelse till planering från {namn}. Kan du?"
      ],
      datesWin: [
        "🏆 Det blir {dag}! Skriv in det i almanackan, soldat.",
        "🗓️ Truppen har bestämt: {dag}. Ingen backar nu.",
        "📌 {dag} ä spikat. Dä ä bara att stå på sig.",
        "🎖️ Segrare: {dag}. Demokratin har talat."
      ],
      datesVoted: [
        "🗳️ Röst registrerad. Tack för din tjänst.",
        "✅ Noterat i protokollet.",
        "🗳️ Klart! Nu väntar vi på resten av plutonen."
      ],
      // 👋 Ingen lämnas kvar
      bye: [
        "👋 Hej då! Skriv \"hemma\" när du ä framme, soldat.",
        "🫡 Avtackad. Gå raka vägen hem, int' via kebaben. Eller okej, via kebaben.",
        "👋 Truppen vet att du drar. Ha det gött!",
        "🏠 Reträtt godkänd. Drick ett glas vatten innan du somnar.",
        "👋 Du ä avmönstrad för ikväll. Ta taxi om dä ä långt.",
        "🫡 Hej då! Ingen lämnas kvar, och du lämnade ingen. Snyggt.",
        "👋 Utcheckad. Mobilen laddad? Nycklarna i fickan?",
        "🌙 Godnatt, menig. Vi ses på bakisbrunchen."
      ],
      byeSeen: [
        "👋 {namn} drog hem {tid}.",
        "🫡 {namn} har avmönstrat ({tid}).",
        "🏠 {namn} ä på väg hem ({tid}).",
        "👋 {namn} sa hej då {tid}. Bra stil."
      ],
      byeUndo: "↩️ Okej, du ä kvar ute. Kul!",
      alone: [
        "{namn} ä kvar ensam på {bar} — nån som hänger kvar eller följer hem?",
        "🫂 {namn} ä sista soldaten på {bar}. Nån som tar ett snack eller följer hem?",
        "🪖 Ingen lämnas kvar: {namn} ä ensam kvar på {bar}. Vem kollar läget?",
        "📻 Radiokontakt: {namn} håller ställningen ensam på {bar}. Förstärkning eller hemfölje?",
        "🫂 {namn} ä ensam ute på {bar}. Ett samtal eller ett sms gör mycket."
      ],
      aloneNoBar: [
        "{namn} ä kvar ensam ute — nån som hänger kvar eller följer hem?",
        "🫂 {namn} ä sista soldaten ute. Nån som ringer eller följer hem?"
      ],
      aloneMe: [
        "🫂 Du ä sist kvar ute. Vill du ha sällskap hem? Ring en kompis eller ta taxi.",
        "🪖 Du håller ställningen ensam. Hemfölje? Skriv till truppen.",
        "🫂 Alla andra har dragit. Dags att ta sig hem säkert, soldat?"
      ],
      aloneToast: "🫂 {namn} ä kvar ensam på {bar}. Kolla läget?",
      // 💬 Hur mår truppen?
      moodAsk: [
        "💬 {namn} undrar: hur mår truppen?",
        "📻 Statusrapport begärd av {namn}. Hur ä läget?",
        "🪖 {namn} gör mönstring: bra, snurrigt eller hem snart?",
        "💬 Läget, soldater? {namn} vill veta.",
        "📋 {namn} räknar huvuden. Hur mår du?"
      ],
      moodBra: ["👍 Grymt! Fortsätt så, men glöm int' vattnet.", "👍 Stridsduglig. Noterat.", "👍 Toppen. Du ä kvällens moralofficer."],
      moodSnurr: [
        "😵 Okej, snurrigt. Vatten, nåt att äta och en stol. Truppen ser dig.",
        "😵 Noterat. Ta en paus, drick vatten. Det ä ingen tävling.",
        "😵 Snurrigt ä ingen skam. Sätt dig, drick vatten, säg till nån nära.",
        "😵 Sjukvårdare kallad! (En kompis med ett glas vatten.)"
      ],
      moodHem: ["🏠 Bra beslut. Säg hej då till gänget när du drar.", "🏠 Hem snart, noterat. Ta taxi om dä ä långt.", "🏠 Reträtten planeras. Ingen lämnas kvar."],
      moodSum: {
        allBra: ["💪 Hela truppen ä stridsduglig. Ölguden ä nöjd.", "👍 Alla mår bra. Drick vatten ändå, för sakens skull."],
        snurr: ["😵 {n} känner sig snurrig. Vatten, mat och sällskap — ta hand om varandra.", "🫂 {n} snurrig i ledet. Kolla till dem, bjud på vatten."],
        hem: ["🏠 {n} drar hem snart. Följs ni åt?", "🏠 {n} på väg hem snart. Gå tillsammans om ni kan."],
        mixed: ["📋 Blandad rapport. Ta hand om varandra, soldater.", "📻 Läget ä blandat. Den som mår bäst kollar på resten."]
      },
      snurrTips: [
        "💧 Ett stort glas vatten nu, ett till om en kvart.",
        "🍞 Ät nåt — kebab, macka, pizza. Allt räknas.",
        "🪑 Sätt dig en stund, gärna ute i friska luften.",
        "🚕 Ta taxi hem om dä ä långt. Gå int' ensam.",
        "📞 Säg till en kompis var du ä."
      ],
      // 🕺 Dansgolvsmätaren
      danceLv: ["Tomt", "Lite rörelse", "Fullt ös"],
      danceEmoji: ["🪑", "💃", "🪩"],
      danceThanks: [
        "🕺 Rapport mottagen. Dansgolvet tackar.",
        "🪩 Spaning noterad, agent.",
        "🕺 Tack! Nu vet stan hur golvet mår.",
        "📡 Signal mottagen från dansgolvet."
      ],
      danceNone: "Ingen har rapporterat dansgolvet än.",
      danceFar: "🕺 Du måste vara på plats (inom 300 m) för att rapportera.",
      // 🔥 Skålstafetten (40)
      torch: {
        lit: [
          "🔥 Facklan ä tänd i {stad}! Ni bär den först.",
          "🔥 {grupp} tände kvällens fackla. Ära och ansvar!",
          "🔥 Elden ä er! Håll den, eller skicka den vidare.",
          "🔥 Facklan brinner. {stad} har en stafett ikväll.",
          "🕯️ Från en gnista till en fackla: {grupp} startar stafetten."
        ],
        held: [
          "🔥 Ni bär facklan. Ge den till en annan grupp i stan när ni vill.",
          "🔥 Facklan ä i era händer. Skicka den vidare och bli legender.",
          "🔥 Ni håller elden. Ett gott skål-gäng förtjänar den härnäst.",
          "🔥 Facklan väntar på att resa vidare. Vem får den?"
        ],
        offer: [
          "🔥 Facklan kommer! {grupp} vill ge den till er. Ta emot?",
          "📯 Stafett! {grupp} räcker över facklan. 10 min att svara.",
          "🔥 {grupp} pekar på er. Tar ni elden?",
          "🔥 Inkommande fackla från {grupp}! Svara innan den slocknar.",
          "🪖 {grupp} skickar förstärkning: facklan! Ta emot?"
        ],
        sent: [
          "🔥 Facklan ä skickad. Nu väntar vi på svar.",
          "📯 Överlämning pågår. 10 minuter, sen går den vidare själv.",
          "🔥 Elden ä på väg. Håll tummarna.",
          "🔥 Skickad! Ölguden övervakar överlämningen."
        ],
        got: [
          "🔥 Ni har facklan! Håll den högt.",
          "🎖️ Facklan ä er. {stad} tittar på er nu.",
          "🔥 Mottagen! Elden lever vidare.",
          "🔥 Facklan ä i säkert förvar hos {grupp}.",
          "🏅 Stafetten fortsätter — med er.",
          "🔥 Facklan landade hos er. Bär den med stolthet, int' med promille."
        ],
        random: [
          "🎲 Ingen svarade, så facklan vandrade vidare på egen hand.",
          "🌬️ Vinden tog facklan till en annan grupp.",
          "🎲 Facklan blev uttråkad och hittade ett nytt gäng.",
          "🔥 Facklan väntar int' på nån. Den har gått vidare."
        ],
        declined: [
          "🔥 Ni lät facklan gå vidare. Ädelt.",
          "🫡 Överlämnad till slumpen. Lycka till, fackla.",
          "🔥 Facklan fortsätter sin resa utan er. Ingen fara."
        ],
        none: [
          "🔥 Ingen fackla tänd i {stad} än. Bli först!",
          "🕯️ Det ä mörkt i {stad}. Tänd kvällens fackla?",
          "🔥 Facklan ligger och väntar. Nån måste tända den.",
          "🕯️ Inga flammor än. Er grupp kan starta stafetten."
        ],
        lonely: [
          "🔥 Ingen annan grupp ä ute i stan just nu. Facklan stannar hos er.",
          "🌙 Tomt på grupper i stan. Facklan vilar hos er.",
          "🔥 Inga mottagare i sikte. Håll elden vid liv."
        ],
        route: [
          "🗺️ Facklans väg ikväll i {stad} ({n} överlämningar).",
          "🔥 Stafetten i {stad}: {n} överlämningar hittills."
        ]
      },
      anonGroup: "en grupp",
      anonAt: "en grupp vid {bar}",
      anonTown: "en grupp i stan",
      // 📼 Kvällsrepris
      replayEnd: [
        "📼 Kvällen ä återspelad. Bra jobbat, soldater.",
        "🎬 SLUT. Regissör: Ölguden. Skådespelare: ni.",
        "📼 Så såg kvällen ut. Ingen lämnades kvar (hoppas vi).",
        "🎖️ Uppdraget dokumenterat för eftervärlden.",
        "📼 Repris klar. Nu ä det bakisbrunch som gäller.",
        "🎞️ Kvällen i backspegeln. Vackert, på sitt sätt."
      ],
      replayClosed: "📼 Reprisen öppnar 05:00 dagen efter och ä öppen till 18:00.",
      replayEmpty: "📼 Inga incheckningar eller pins från gruppen igår. Ingen film att visa."
    },
    en: {
      depSet: ["🚌 Departure {tid} to {bar}. The squad is informed.", "📋 Marching orders: {tid}, {bar}. Boots on!", "🪖 We leave {tid}. Whoever is not ready walks alone."],
      depNew: ["🚌 {namn} set a departure {tid} → {bar}.", "📋 New orders from {namn}: {tid} to {bar}."],
      depT5: ["🚌 5 min to departure for {bar}! Jacket, soldier.", "⏰ T minus 5. ID, keys, phone? Go!"],
      depGo: ["🚌 DEPARTURE! To {bar}.", "🪖 Forward march! {bar} awaits."],
      medJa: ["🙋 You're in! Fall in line.", "✅ Signed up. No way back."],
      medNej: ["🙅 Signed off. We miss you a bit already."],
      depNone: "No departure set. Who takes command?",
      datesNew: ["🗓️ {namn} asks: which night? Vote in the Squad."],
      datesWin: ["🏆 It's {dag}! Put it in the calendar.", "🗓️ The squad decided: {dag}."],
      datesVoted: ["🗳️ Vote registered. Thanks for your service."],
      bye: ["👋 Bye! Text the squad when you're home.", "🏠 Retreat approved. Drink a glass of water before bed.", "👋 Checked out. Phone charged? Keys in pocket?"],
      byeSeen: ["👋 {namn} went home {tid}."],
      byeUndo: "↩️ OK, you're still out. Nice!",
      alone: ["{namn} is the last one out at {bar} — anyone staying or walking them home?"],
      aloneNoBar: ["{namn} is the last one still out — anyone staying or walking them home?"],
      aloneMe: ["🫂 You're the last one out. Want company home? Call a friend or take a taxi."],
      aloneToast: "🫂 {namn} is alone at {bar}. Check in?",
      moodAsk: ["💬 {namn} asks: how is the squad?", "📻 Status report requested by {namn}."],
      moodBra: ["👍 Great! Keep it up, and remember water."],
      moodSnurr: ["😵 OK, dizzy. Water, some food and a chair. The squad sees you.", "😵 Take a break, drink water. It's not a contest."],
      moodHem: ["🏠 Good call. Say bye to the group when you go."],
      moodSum: {
        allBra: ["💪 The whole squad is fit for duty."],
        snurr: ["😵 {n} feeling dizzy. Water, food and company — look after each other."],
        hem: ["🏠 {n} heading home soon. Go together?"],
        mixed: ["📋 Mixed report. Look after each other."]
      },
      snurrTips: ["💧 A big glass of water now, another in 15 min.", "🍞 Eat something.", "🪑 Sit down for a while, fresh air helps.", "🚕 Take a taxi if it's far. Don't walk alone.", "📞 Tell a friend where you are."],
      danceLv: ["Empty", "Some moves", "Packed"],
      danceEmoji: ["🪑", "💃", "🪩"],
      danceThanks: ["🕺 Report received. The dance floor thanks you."],
      danceNone: "Nobody has reported the dance floor yet.",
      danceFar: "🕺 You must be there (within 300 m) to report.",
      torch: {
        lit: ["🔥 The torch is lit in {stad}! You carry it first."],
        held: ["🔥 You hold the torch. Pass it to another group in town when you like."],
        offer: ["🔥 Torch incoming! {grupp} wants to pass it to you. Accept?"],
        sent: ["🔥 Torch sent. Waiting for an answer."],
        got: ["🔥 You have the torch! Hold it high."],
        random: ["🎲 Nobody answered, so the torch wandered on by itself."],
        declined: ["🔥 You let the torch move on."],
        none: ["🔥 No torch lit in {stad} yet. Be first!"],
        lonely: ["🔥 No other group is out in town right now. The torch stays with you."],
        route: ["🗺️ The torch's route tonight in {stad} ({n} handovers)."]
      },
      anonGroup: "a group",
      anonAt: "a group at {bar}",
      anonTown: "a group in town",
      replayEnd: ["📼 The night has been replayed. Well done, soldiers.", "🎬 THE END. Director: the Beer God. Cast: you."],
      replayClosed: "📼 The replay opens at 05:00 the day after and stays open until 18:00.",
      replayEmpty: "📼 No check-ins or pins from the group last night. Nothing to show."
    }
  };
})();
