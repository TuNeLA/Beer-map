-- public.olnu_ev_kind(p_title text, p_kind text)
-- live md5(pg_get_functiondef) = cc580b576cf04830fced1b3c39202ef4
CREATE OR REPLACE FUNCTION public.olnu_ev_kind(p_title text, p_kind text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when lower(coalesce(p_kind, '')) in ('quiz', 'live', 'dj', 'karaoke', 'sport', 'standup', 'party', 'other') then lower(p_kind)
    when p_title ~* '(quiz|frågesport|trivia|bingo)' then 'quiz'
    when p_title ~* '(karaoke|sjung)' then 'karaoke'
    when p_title ~* '(stand.?up|komik|comedy)' then 'standup'
    when p_title ~* '(\mdj\M|klubb|club night|disco)' then 'dj'
    when p_title ~* '(match|fotboll|hockey|shl|allsvensk|premier league|champions league|\mvm\M|\mem\M|ufc|f1)' then 'sport'
    when p_title ~* '(live|konsert|concert|spelar|band|trubadur|akustisk|jazz|blues|rock)' then 'live'
    when p_title ~* '(fest|party|afterwork|\maw\M|release)' then 'party'
    else 'other' end;
$function$;
