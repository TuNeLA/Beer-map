-- 0508 · UNLOCKS: 37 achievements that unlock avatar clothes (lane unlocks, 13 Nov 2026). OWNER-RUN, after the release.
-- Owner (13 Nov 00:34): "you unlock outfits, hats and so on; when I unlock a new hat or shirt a sheet comes up".
-- Store rule (owner): no reward for drinking more. NOTHING here reads beers, medal_nights, drink_log, week_beers,
-- beer_types or olnu_lifetime. The achievements count going out WITH friends, new bars and towns, safety (Följ mig hem,
-- rides, water, läsk), games, price reports, events, Skåltimmen and seasons with the gang.
-- What it adds (all additive, CREATE OR REPLACE only, no table change):
--   1. olnu_unlock_list()          : the catalog {medal id: [count key, need]} (same list as docs/js/unlock-parts.js).
--   2. olnu_unlock_counts(uid)     : the counts per key (each count in its own block: a missing table = 0).
--   3. olnu_unlock_medals(uid)     : table(medal, n). NOT named olnu_medal_eval_* on purpose: 0509 wires it in after the
--                                    new client is live (an old client would show an unknown medal id). Same as 0347/0348.
--   4. my_unlock_progress()        : {v, c: counts} for the "Garderob" view (progress bars). authenticated only.
--   5. olnu_avatar_locks4()        : the locks of the 12 new items + one more way to unlock 25 old items ("alt" path).
--   6. olnu_avatar_max()           : + the 12 new items (hw 44-47, up 31-32, nk 16-17, gl 30, fr 11-12, bg 39); keeps nl (0397).
--   7. olnu_avatar_clean(uid,spec) : same text as live (0252) + ONE change: an item is open when its old lock is open OR
--                                    its locks4 path is open. A new item (no old lock) needs its locks4 lock.
-- Safe to run many times. Check after the run (expect t, t, t, t):
--   select (public.olnu_avatar_max()->>'hw')::int = 47, jsonb_typeof(public.olnu_avatar_locks4()) = 'object',
--          (select count(*) from jsonb_object_keys(public.olnu_unlock_list())) = 37,
--          has_function_privilege('authenticated', 'public.my_unlock_progress()', 'execute');

create or replace function public.olnu_unlock_list()
returns jsonb language sql immutable set search_path to 'public' as $$
  select '{
    "u_pass5": ["pass", 5], "u_pass10": ["pass", 10], "u_pass25": ["pass", 25],
    "u_town2": ["town", 2], "u_town5": ["town", 5], "u_town10": ["town", 10],
    "u_lan3": ["lan", 3], "u_lan8": ["lan", 8],
    "u_gang1": ["gang", 1], "u_gang5": ["gang", 5], "u_gang20": ["gang", 20],
    "u_event1": ["event", 1], "u_event5": ["event", 5], "u_host": ["host", 1],
    "u_play1": ["play", 1], "u_play10": ["play", 10], "u_win5": ["win", 5],
    "u_price1": ["price", 1], "u_price10": ["price", 10],
    "u_ci1": ["ci", 1], "u_ci25": ["ci", 25],
    "u_home1": ["home", 1], "u_home10": ["home", 10], "u_escort3": ["escort", 3], "u_buddy3": ["buddy", 3],
    "u_ride1": ["ride", 1], "u_ride5": ["ride", 5], "u_driver3": ["driver", 3],
    "u_water5": ["water", 5], "u_lask5": ["lask", 5],
    "u_skal1": ["skal", 1], "u_skal10": ["skal", 10], "u_photo10": ["photo", 10],
    "u_lucia": ["lucia", 1], "u_jul": ["jul", 1], "u_nyar": ["nyar", 1], "u_mids": ["mids", 1]
  }'::jsonb;
$$;

create or replace function public.olnu_unlock_counts(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  c jsonb := '{}'::jsonb; n int; a int; b int; d int; e int;
begin
  if p_uid is null then return c; end if;
  -- Ölpasset: different bars, and bar nights (one per bar and night)
  begin
    select count(distinct mc.bar_id)::int, count(distinct (mc.bar_id, mc.night))::int into n, a
      from public.medal_checkins mc where mc.user_id = p_uid;
    c := c || jsonb_build_object('pass', n, 'ci', a);
  exception when others then null; end;
  -- towns (the morning report's town per night)
  begin
    select count(distinct an.town)::int into n from public.after_nights an where an.user_id = p_uid and an.town is not null;
    c := c || jsonb_build_object('town', n);
  exception when others then null; end;
  -- län (regions): the places of my check-ins (bar position from bars_lite + check-in position), max 300 spots
  begin
    select count(distinct zk.ln)::int into n
      from (select distinct round(x.lat::numeric, 2) as la, round(x.lng::numeric, 2) as lo
              from (select bl.lat, bl.lng from public.medal_checkins mc join public.bars_lite bl on bl.id = mc.bar_id where mc.user_id = p_uid
                    union all
                    select ci.lat, ci.lng from public.checkins ci where ci.user_id = p_uid and ci.lat is not null and ci.lng is not null) x
             limit 300) p
      join public.olnu_zone_kommun zk on zk.kn = public.olnu_kommun_of(p.la::float8, p.lo::float8);
    c := c || jsonb_build_object('lan', n);
  exception when others then null; end;
  -- with the gang: nights with a friend close by (meriter 'squad'), + the season nights with the gang
  begin
    select count(distinct l.night)::int into n from public.meriter_log l where l.user_id = p_uid and l.kind = 'squad';
    select count(distinct extract(year from x.ev)) filter (where to_char(x.ev, 'MM-DD') = '12-13'),
           count(distinct extract(year from x.ev)) filter (where to_char(x.ev, 'MM-DD') between '12-01' and '12-24'),
           count(distinct extract(year from x.ev)) filter (where to_char(x.ev, 'MM-DD') = '12-31'),
           count(distinct extract(year from x.ev)) filter (where to_char(x.ev, 'MM-DD') between '06-19' and '06-25' and extract(isodow from x.ev) = 5)
      into a, b, d, e
      from (select public.olnu_evening(l.night) as ev from public.meriter_log l where l.user_id = p_uid and l.kind = 'squad') x;
    c := c || jsonb_build_object('gang', n, 'lucia', a, 'jul', b, 'nyar', d, 'mids', e);
  exception when others then null; end;
  -- events: yes to someone else's invite that has started; host: my own invite with 3+ yes
  begin
    select count(*)::int into n from public.invite_people p join public.invites i on i.id = p.invite_id
     where p.user_id = p_uid and p.answer = 'yes' and i.creator <> p_uid and i.starts_at < now();
    select count(*)::int into a from public.invites i
     where i.creator = p_uid and i.starts_at < now()
       and (select count(*) from public.invite_people p where p.invite_id = i.id and p.answer = 'yes' and p.user_id <> p_uid) >= 3;
    c := c || jsonb_build_object('event', n, 'host', a);
  exception when others then null; end;
  -- party games played / won
  begin
    select count(*)::int, count(*) filter (where pr.won)::int into n, a from public.party_results pr where pr.user_id = p_uid;
    c := c || jsonb_build_object('play', n, 'win', a);
  exception when others then null; end;
  -- price reports (one per bar, kind and day)
  begin
    select count(distinct (bp.bar_id, bp.kind, bp.day))::int into n from public.bar_prices bp where bp.user_id = p_uid;
    c := c || jsonb_build_object('price', n);
  exception when others then null; end;
  -- safety: Följ mig hem walks that ended home; a friend's walk I watched until home; "kolla läget" on a friend
  begin
    select count(*)::int into n from public.walks w where w.user_id = p_uid and w.end_reason = 'home';
    select count(distinct v.walk_id)::int into a from public.walk_views v join public.walks w on w.id = v.walk_id
     where v.user_id = p_uid and w.user_id <> p_uid and w.end_reason = 'home';
    c := c || jsonb_build_object('home', n, 'escort', a);
  exception when others then null; end;
  begin
    select count(*) filter (where l.kind = 'buddy')::int, count(*) filter (where l.kind = 'photo')::int,
           count(distinct l.night) filter (where l.kind = 'water')::int
      into n, a, b from public.meriter_log l where l.user_id = p_uid and l.kind in ('buddy', 'photo', 'water');
    c := c || jsonb_build_object('buddy', n, 'photo', a, 'water', b);
  exception when others then null; end;
  -- rides: "Jag kommer" on a friend's Hämta mig; nights with "Jag kör ikväll"; nights with a läsk logged (0495)
  begin
    select count(distinct pa.req_id)::int into n from public.pickup_answers pa join public.pickup_reqs r on r.id = pa.req_id
     where pa.user_id = p_uid and pa.ans = 'kommer' and r.user_id <> p_uid;
    c := c || jsonb_build_object('ride', n);
  exception when others then null; end;
  begin
    select count(distinct ds.night)::int into n from public.driver_status ds where ds.user_id = p_uid;
    c := c || jsonb_build_object('driver', n);
  exception when others then null; end;
  begin
    execute 'select count(distinct rl.night)::int from public.ride_lask rl where rl.user_id = $1' into n using p_uid;
    c := c || jsonb_build_object('lask', n);
  exception when others then null; end;
  -- Skåltimmen: hours I joined in time
  begin
    select count(distinct sp.hour_id)::int into n from public.skal_hour_posts sp where sp.user_id = p_uid and sp.in_time;
    c := c || jsonb_build_object('skal', n);
  exception when others then null; end;
  return c;
end; $function$;

-- n = 1 when the need is met (the season ones: one per year). olnu_medal_store keeps rows with n >= 1.
create or replace function public.olnu_unlock_medals(p_uid uuid)
returns table (medal text, n integer)
language plpgsql stable security definer set search_path to 'public' as $function$
declare v_c jsonb := public.olnu_unlock_counts(p_uid);
begin
  if p_uid is null then return; end if;
  return query
  select e.key::text,
         (case when coalesce((v_c->>(e.value->>0))::int, 0) >= (e.value->>1)::int
               then (case when e.value->>0 in ('lucia', 'jul', 'nyar', 'mids') then coalesce((v_c->>(e.value->>0))::int, 0) else 1 end)
               else 0 end)::int
    from jsonb_each(public.olnu_unlock_list()) e;
end; $function$;

create or replace function public.my_unlock_progress()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object('v', 1, 'c', public.olnu_unlock_counts(v_uid));
end; $function$;

-- New items (index = place in the client catalog, docs/js/unlock-parts.js) + one more path for 25 old items.
create or replace function public.olnu_avatar_locks4()
returns jsonb language sql immutable set search_path to 'public' as $$
  select '{
    "hw:44": {"m": "u_pass25"}, "hw:45": {"m": "u_home10"}, "hw:46": {"m": "u_ride5"}, "hw:47": {"m": "u_jul"},
    "up:31": {"m": "u_town10"}, "up:32": {"m": "u_gang20"}, "nk:16": {"m": "u_home1"}, "nk:17": {"m": "u_gang5"},
    "gl:30": {"m": "u_win5"}, "fr:11": {"m": "u_pass10"}, "fr:12": {"m": "u_lan8"}, "bg:39": {"m": "u_water5"},
    "bg:36": {"m": "u_pass5"}, "hw:27": {"m": "u_town2"}, "up:27": {"m": "u_town5"}, "nk:5": {"m": "u_lan3"},
    "nk:8": {"m": "u_gang1"}, "bg:34": {"m": "u_event1"}, "up:15": {"m": "u_event5"}, "hw:26": {"m": "u_host"},
    "gl:19": {"m": "u_play1"}, "bg:35": {"m": "u_play10"}, "gl:10": {"m": "u_price1"}, "hw:25": {"m": "u_price10"},
    "bg:24": {"m": "u_ci1"}, "up:14": {"m": "u_ci25"}, "nk:13": {"m": "u_escort3"}, "hw:42": {"m": "u_buddy3"},
    "up:30": {"m": "u_ride1"}, "gl:5": {"m": "u_driver3"}, "hi:16": {"m": "u_lask5"}, "mt:21": {"m": "u_skal1"},
    "fr:6": {"m": "u_skal10"}, "hi:10": {"m": "u_photo10"}, "hw:19": {"m": "u_lucia"}, "hw:35": {"m": "u_nyar"},
    "hw:18": {"m": "u_mids"}
  }'::jsonb;
$$;

create or replace function public.olnu_avatar_max()
returns jsonb language sql immutable set search_path to 'public' as $$
  select '{"ms":1,"nl":1,"hx":16777216,"ux":16777216,"bx":16777216,"h2":22,"ht":3,"sk":22,"fs":7,"ey":21,"ec":11,"br":14,"ns":11,"mt":21,"ck":6,"fm":11,"fp":11,"er":12,"hr":33,"hc":21,"fh":25,"hw":47,"gl":30,"nk":17,"up":32,"uc":19,"bg":39,"hi":16,"fr":12}'::jsonb;
$$;

-- Live text (0252, schema snapshot md5 eeceef04…) + unl0508: the locks4 path.
create or replace function public.olnu_avatar_clean(p_uid uuid, p_spec jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_max jsonb := public.olnu_avatar_max();
  v_locks jsonb := public.olnu_avatar_locks() || public.olnu_avatar_locks3();
  v_alt jsonb := public.olnu_avatar_locks4();   -- unl0508
  v_f jsonb := public.olnu_avatar_facts(p_uid);
  v_cur jsonb;
  v_out jsonb := jsonb_build_object('v', 2);
  k text; val jsonb; n int; lk jsonb; al jsonb; md jsonb := '[]'::jsonb; x jsonb;
begin
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' or octet_length(p_spec::text) > 1024 then
    raise exception 'invalid_avatar';
  end if;
  select a.spec into v_cur from public.avatars a where a.user_id = p_uid;
  for k, val in select * from jsonb_each(p_spec) loop
    if k = 'v' then continue; end if;
    if k = 'md' then
      if jsonb_typeof(val) <> 'array' or jsonb_array_length(val) > 6 then raise exception 'invalid_avatar'; end if;
      for x in select * from jsonb_array_elements(val) loop
        if jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') > 24 or (x #>> '{}') in ('het', 'medevac')
           or not (v_f->'m') ? (x #>> '{}') then raise exception 'invalid_avatar'; end if;
        if not md ? (x #>> '{}') then md := md || jsonb_build_array(x); end if;
      end loop;
      continue;
    end if;
    if not v_max ? k or jsonb_typeof(val) <> 'number' then raise exception 'invalid_avatar'; end if;
    n := (val #>> '{}')::numeric::int;
    if n::numeric <> (val #>> '{}')::numeric or n < 0 or n > (v_max->>k)::int then raise exception 'invalid_avatar'; end if;
    lk := v_locks->(k || ':' || n);
    al := v_alt->(k || ':' || n);
    if (lk is not null or al is not null)
       and not (lk is not null and public.olnu_avatar_lock_ok(lk, v_f))
       and not (al is not null and public.olnu_avatar_lock_ok(al, v_f))
       and not (case when jsonb_typeof(v_cur->k) = 'number' then (v_cur->>k)::numeric = n else false end) then
      raise exception 'locked';
    end if;
    v_out := v_out || jsonb_build_object(k, n);
  end loop;
  if jsonb_array_length(md) > 0 then v_out := v_out || jsonb_build_object('md', md); end if;
  return v_out;
end; $function$;

revoke all on function public.olnu_unlock_list() from public, anon, authenticated;
revoke all on function public.olnu_unlock_counts(uuid) from public, anon, authenticated;
revoke all on function public.olnu_unlock_medals(uuid) from public, anon, authenticated;
revoke all on function public.olnu_avatar_locks4() from public, anon, authenticated;
revoke all on function public.olnu_avatar_clean(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.my_unlock_progress() from public, anon;
grant execute on function public.my_unlock_progress() to authenticated;

select public.olnu_strip_cr();
