-- public.bar_norm(p_bar_ids text[])
-- live md5(pg_get_functiondef) = 45b616f123f088aa608621cf1a486089
CREATE OR REPLACE FUNCTION public.bar_norm(p_bar_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(now());
  v_into interval := now() - (v_night - interval '24 hours');
  v_out jsonb;
begin
  if public.olnu_uid() is null then raise exception 'not_authed'; end if;
  if p_bar_ids is null or cardinality(p_bar_ids) = 0 then return jsonb_build_object('v', 1, 'bars', '{}'::jsonb); end if;
  with ids as (select distinct x as bar_id from unnest(p_bar_ids[1:40]) x where x is not null and char_length(x) <= 80),
  nights as (select ((v_night at time zone 'Europe/Stockholm') - (i * interval '7 days')) at time zone 'Europe/Stockholm' as night
               from generate_series(1, 8) i),
  per as (
    select d.bar_id, n.night, count(distinct d.user_id) as users
      from nights n join public.drink_log d on d.night = n.night
      join ids on ids.bar_id = d.bar_id
     where not coalesce(d.undone, false) and not coalesce(d.ghost, false)
       and d.at <= n.night - interval '24 hours' + v_into
       and not public.olnu_is_test_user(d.user_id)
     group by d.bar_id, n.night
  )
  select coalesce(jsonb_object_agg(a.bar_id, jsonb_build_object('usual', a.usual, 'nights', a.nights)), '{}'::jsonb)
    into v_out
    from (select p.bar_id, round(sum(p.users)::numeric / 8, 1) as usual, count(*) as nights
            from per p group by p.bar_id having count(*) >= 3) a;
  return jsonb_build_object('v', 1, 'bars', coalesce(v_out, '{}'::jsonb));
end; $function$;
