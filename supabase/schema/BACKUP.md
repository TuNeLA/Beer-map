# Backup av PintsNow-databasen (gör det själv på din Windows-dator)

Supabase Free har **ingen automatisk backup**. Om något går fel är datan borta.
Gör den här backupen nu, och sedan en gång i veckan (och alltid före en stor release).

Du gör allt själv. Claude ser inte din dator och ska aldrig få lösenordet.

## Det här behöver du (en gång)

1. **Node.js** (finns redan om du kan köra `npx`). Annars: <https://nodejs.org> → LTS.
2. **Docker Desktop**: <https://www.docker.com/products/docker-desktop/>. Installera och **starta** det.
   Supabase CLI kör `pg_dump` inne i Docker. Utan Docker fungerar inte kommandot.
3. **Databaslösenordet** för projektet. Har du glömt det: Dashboard → **Project Settings → Database → Reset database password**.
   Spara det i din lösenordshanterare.

## Steg 1 – hämta anslutningssträngen

1. Öppna <https://supabase.com/dashboard/project/wcdskpcevbhouvbytkhv>.
2. Klicka **Connect** (knappen högst upp).
3. Välj **Session pooler** (inte "Direct connection", den kräver IPv6).
4. Kopiera strängen. Den ser ut så här:
   `postgresql://postgres.wcdskpcevbhouvbytkhv:[YOUR-PASSWORD]@aws-X-eu-west-3.pooler.supabase.com:5432/postgres`
5. Byt `[YOUR-PASSWORD]` mot ditt lösenord (utan hakparenteser).

> **Klistra aldrig in strängen med lösenordet i chatten, i en issue, i Discord eller i en fil i repot.**
> Den ger full åtkomst till all data.

## Steg 2 – kör ETT kommando

1. Skapa en mapp **utanför** repot, till exempel `C:\PintsNow-backup`.
2. Öppna **PowerShell** i den mappen (Shift + högerklick → "Öppna i Terminal").
3. Klistra in hela raden nedan och tryck Enter:

```powershell
$u = Read-Host "Klistra in anslutningsstrangen (Session pooler, med losenord)"; $d = "pintsnow-" + (Get-Date -Format "yyyy-MM-dd"); mkdir $d | Out-Null; npx --yes supabase db dump --db-url "$u" -f "$d\roles.sql" --role-only; npx --yes supabase db dump --db-url "$u" -f "$d\schema.sql"; npx --yes supabase db dump --db-url "$u" -f "$d\data.sql" --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"; Remove-Variable u; Get-ChildItem $d
```

4. Klistra in anslutningssträngen när den frågar. (`Read-Host` sparar den inte i PowerShell-historiken.)
5. Vänta. Det tar 1–3 minuter. Sist visar den tre filer:

| Fil | Innehåll |
|---|---|
| `roles.sql` | databasroller |
| `schema.sql` | tabeller, funktioner, rättigheter, triggers |
| `data.sql` | all data (även `auth.users`, alltså alla konton) |

Kolla att `data.sql` inte är tom (den bör vara flera MB).

## Steg 3 – spara filerna säkert

`data.sql` innehåller **alla användares data**. Behandla den som ett lösenord.

- **Inte** i repot (repot är publikt). **Inte** i en delad mapp eller en publik länk.
- Packa mappen med lösenord: 7-Zip → "Lägg till i arkiv" → format **7z**, kryptering **AES-256**, kryssa **"Kryptera filnamn"**.
  Spara lösenordet i lösenordshanteraren.
- Ha **två kopior**: en på datorn (eller en USB-disk) och en i din privata molnlagring (bara den krypterade `.7z`-filen).
- Radera de okrypterade `.sql`-filerna efter att du har packat dem.
- Spara de 4 senaste backuperna. Radera äldre.

## Återställa till ett NYTT projekt (om olyckan händer)

Återställ aldrig ovanpå live-projektet. Gör så här:

1. Skapa ett nytt projekt i Supabase (samma region, `eu-west-3`).
2. I det nya projektet: **Database → Extensions** → slå på **pg_cron** (de andra finns redan).
3. Hämta det nya projektets Session pooler-sträng (som i steg 1).
4. Installera `psql` (PostgreSQL 17, "Command Line Tools" räcker): <https://www.postgresql.org/download/windows/>.
5. Packa upp backupen och kör i PowerShell i den mappen (en rad):

```powershell
$n = Read-Host "NYA projektets anslutningsstrang"; psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql --command "SET session_replication_role = replica" --file data.sql --dbname "$n"; Remove-Variable n
```

6. Efteråt:
   - Lägg tillbaka cron-jobbet: kör raden i `supabase/schema/12_cron.sql` i SQL Editor i det nya projektet.
   - Sätt samma inställningar under **Authentication** (anonym inloggning på, samma URL:er).
   - Deploya edge functions (`notify-group`, `card`) och sätt deras secrets igen.
   - Byt Supabase-URL och anon-nyckel i `docs/config.js`.
   - Kontrollera: `select count(*) from auth.users;` och `select count(*) from public.beers;` ska ge ungefär samma tal som förut.

`session_replication_role = replica` stänger av triggers under importen, så att inget körs två gånger.

## Källor

- Supabase – Backup and Restore using the CLI: <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>
- Supabase CLI – `supabase db dump`: <https://supabase.com/docs/reference/cli/supabase-db-dump>
- Supabase – Database Backups (Free har ingen automatisk backup): <https://supabase.com/docs/guides/platform/backups>
