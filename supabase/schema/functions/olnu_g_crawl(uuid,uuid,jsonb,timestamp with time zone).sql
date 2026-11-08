-- public.olnu_g_crawl(p_uid uuid, p_group uuid, p_stops jsonb, p_now timestamp with time zone)
-- live md5(pg_get_functiondef) = 3988e179923521349ac909d38796b8b4
CREATE OR REPLACE FUNCTION public.olnu_g_crawl(p_uid uuid, p_group uuid, p_stops jsonb, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_stops jsonb;
  v_n int; v_ids int; v_bad int;
  v_id bigint;
begin
  if not public.olnu_g_member(p_group, p_uid) then
    raise exception 'not_member';
  end if;
  if p_stops is null or jsonb_typeof(p_stops) <> 'array' or jsonb_array_length(p_stops) not between 2 and 6 then
    raise exception 'invalid_crawl';
  end if;
  begin
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'lat', round(x.lat::numeric, 5)::float8,
             'lng', round(x.lng::numeric, 5)::float8) order by x.ord),
           count(*), count(distinct x.id),
           count(*) filter (where x.id is null or char_length(x.id) not between 1 and 80
                              or x.name is null or char_length(x.name) not between 1 and 60
                              or x.lat is null or x.lng is null
                              or x.lat not between -85.0 and 85.0 or x.lng not between -180.0 and 180.0)
      into v_stops, v_n, v_ids, v_bad
      from (select e.ord,
                   btrim(e.v->>'id') as id,
                   btrim(regexp_replace(regexp_replace(coalesce(e.v->>'name', ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g')) as name,
                   (e.v->>'lat')::float8 as lat, (e.v->>'lng')::float8 as lng
              from jsonb_array_elements(p_stops) with ordinality e(v, ord)) x;
  exception when others then
    raise exception 'invalid_crawl';
  end;
  if v_bad > 0 or v_ids <> v_n then
    raise exception 'invalid_crawl';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  if exists (select 1 from public.game_crawls c where c.user_id = p_uid and c.created_at > p_now - interval '2 minutes'
                                                  and c.created_at <= p_now) then
    raise exception 'slow_down';
  end if;
  update public.game_crawls c set closed = true where c.group_id = p_group and c.night = v_night and not c.closed;
  insert into public.game_crawls (group_id, user_id, night, stops, n, created_at)
  values (p_group, p_uid, v_night, v_stops, v_n, p_now)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'n', v_n);
end;
$function$;
