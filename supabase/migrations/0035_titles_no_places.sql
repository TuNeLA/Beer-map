-- 0035 v25 RANKS WITHOUT PLACE NAMES (owner decision 2026-10-20).
-- Same 36 thresholds, same order, same function name and return type as 0012. Only titles that named a
-- place (or a region) are new. Identical lists: docs/js/social.js TITLES, notify-group TITLES, CONTRACT.md.
-- my_stats / poll_v2.me / level-up push read olnu_titles(), so they follow at once. The level-up push only
-- fires when the rank was reached just now (total - rank_start <= 1), so the renaming itself sends no pushes.
-- Safe to run again.
create or replace function public.olnu_titles()
returns table(at integer, title text)
language sql immutable set search_path = public as $$
  select * from (values
    (0, 'Rekryt'), (3, 'Mönstrad Mellanöl'), (5, 'Menig Mjöd'), (7, 'Vicekorpral Kapsyl'),
    (10, 'Korpral Korkskruv'), (13, 'Skumsergeant'), (17, 'Furir Flaskhals'),
    (22, 'Överfurir Fatkran'), (28, 'Fanjunkare Flasköppnare'), (35, 'Fänrik Fatöl'),
    (43, 'Löjtnant Lager'), (52, 'Premiärlöjtnant Pilsner'), (62, 'Kapten Kaggen'),
    (75, 'Ryttmästare Humle'), (90, 'Major Mäsk'), (110, 'Överstelöjtnant Ölstop'),
    (130, 'Överste Ölkorv'), (155, 'Brigadgeneral Bärs'), (180, 'Generalmajor Gambrinus'),
    (210, 'Generallöjtnant Guldskum'), (245, 'General Gyllenbärs'), (285, 'Fältmarskalk Fradga'),
    (330, 'Riksmarskalk Rundtur'), (380, 'Baron av Bryggstugan'), (430, 'Hertig av Humlefältet'),
    (490, 'Ärkehertig av Ölkranen'), (560, 'Kung Kapsyl den Store'), (640, 'Ölkejsaren'),
    (730, 'Bryggerilegenden'), (830, 'Halvguden vid Jäskaret'), (920, 'Myten i Mässen'),
    (1000, 'Legenden vid Långbordet'), (1100, 'Sagofiguren i Skyttegraven'), (1200, 'Oraklet i Ölstugan'),
    (1300, 'Överbefälhavare Öl'), (1500, 'Ölguden')
  ) as t(at, title);
$$;
revoke all on function public.olnu_titles() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_titles() from anon';
  end if;
end $$;
