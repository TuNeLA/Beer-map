# scripts/bots — fake test friends on STAGING

For the owner's hand test of the whole app in TESTLÄGE (https://tunela.github.io/pintsnow-beta/test/).
Everything here talks to the **staging** Supabase project `vdtmzsxajpvzwwbhnfmr` only. Nothing touches live.

| File | What |
|---|---|
| `runner.py` | the bots (Python 3.8+, standard library only). Same RPCs as the app. |
| `staging-testkit.sql` | STAGING ONLY. Test kit: per-user flags + moment clock, shared Testgänget, "open a moment now". Stops at once on any project without the `staging_tools` schema. |
| `staging-testkit-undo.sql` | STAGING ONLY. Puts back the 11 original function bodies. |
| `../../.github/workflows/bots.yml` | Actions → bots → Run workflow (30–120 min). Also in TuNeLA/pintsnow-beta (shows in the Actions tab today). |

## The bots
Bot-Oskar (leader), Bot-Lisa, Bot-Erik (drives: "Jag kör ikväll", takes "Hämta mig"), Bot-Sara (asks for rides),
Bot-Johan, Bot-Mia. Anonymous staging users, marked as test users (`test: true`, `olnu_test_users`, `testkit_users`).
Group **Testgänget** (the code is in the run log and in the test panel).

They: reply in Testgänget and in DMs (short lines in the app's tone + keyword reactions), react to messages, set
Ikväll, check in at Ludvika bars (Pitchers, Lobbybaren, La Parma …), move their pins, log a beer every 15–35 min
(Bot-Erik never drinks), join every Spel and Party room in Testgänget and make valid moves until the round ends, answer
moments (bets, Klart, agent votes), say Skål to your beers, accept friend requests.

## Chat commands (write in Testgänget)
`bots: hjälp` · `bots: kom till Pitchers` (or Lobbybaren, La Parma, Grekiska, Blackstone) · `bots: spela` (Hellre;
`bots: spela vem` / `aldrig`) · `bots: tyst` · `bots: prata` · `bots: hem` · `bots: ute` · `bots: skjuts` (Bot-Sara asks
for a ride) · `bots: kör inte` / `bots: kör` (Bot-Erik stops / starts driving, so YOU can take the rides) · `bots: vänner` (friend codes) · `bots: moment vad|halvtid|bord|agent` · `bots: status` · `bots: stopp`

## Run
- Phone / PC: GitHub → Actions → **bots** → Run workflow → minutes (+ your friend code if you want two bot friends).
- Local: `python3 scripts/bots/runner.py --minutes 30 [--friend ABC123] [--quiet]` (Ctrl+C stops).
  The bot sessions are saved in `~/.pintsnow-bots/state.json` (local) or the Actions cache. A run with no saved
  sessions makes new bots; the old bots with the same names then leave Testgänget (`zz_test_retire`).
- Only one bot run at a time. A newer run takes over; the older one stops by itself.

## Safety
Only the staging URL and its public anon key (role anon). The runner exits if the URL is not the staging project.
No service key, no password, no row-removing SQL in these files. The bots act only in Testgänget, its game rooms and
DM threads people open with them. No pushes: staging has no edge functions.
