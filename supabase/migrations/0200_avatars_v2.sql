-- 0200 👤 AVATAR v2 (owner 2026-11-07: "MANY more items so everyone gets a unique character").
-- Additive and backward compatible: CREATE OR REPLACE of the 0172 validation functions + one new helper. No table change, no row removed.
-- Every v1 spec stays valid and looks the same: v1 keys keep their indexes (new items are added at the end) and the v1 locks are
-- unchanged. New keys: ec ns ck fm fp er nk hi fr (items), h2 ht (two-tone hair), hx ux bx ("egen färg": 0 or 0xRRGGBB + 1).
-- New lock kinds: g groups ≥ (group_members, DM/temp groups not counted), k engångskamera shots ≥ (snap_photos kind 'film'),
-- d date window "MM-DD:MM-DD" (Europe/Stockholm, may wrap the new year), o = alternatives (any one is enough).
-- The value a user already wears stays valid (a seasonal item is kept after its window).
-- olnu_avatar_max() / olnu_avatar_locks() are generated from docs/js/avatar.js (AVATAR.MAX / AVATAR.LOCKS): same data.

create or replace function public.olnu_avatar_max()
returns jsonb language sql immutable set search_path to 'public' as $$
  select '{"ms":1,"hx":16777216,"ux":16777216,"bx":16777216,"h2":22,"ht":3,"sk":22,"fs":7,"ey":21,"ec":11,"br":14,"ns":11,"mt":21,"ck":6,"fm":11,"fp":11,"er":12,"hr":33,"hc":21,"fh":25,"hw":43,"gl":29,"nk":15,"up":30,"uc":19,"bg":38,"hi":16,"fr":10}'::jsonb;
$$;

create or replace function public.olnu_avatar_locks()
returns jsonb language sql immutable set search_path to 'public' as $$
  select '{
    "sk:7":{"r":6},
    "ey:6":{"r":8},
    "mt:6":{"m":"radio"},
    "hr:9":{"r":5},
    "hr:10":{"b":5},
    "hc:7":{"m":"sr10"},
    "hc:8":{"s":3},
    "fh:7":{"r":7},
    "fh:8":{"t":2},
    "hw:5":{"r":3},
    "hw:6":{"r":4},
    "hw:7":{"r":6},
    "hw:8":{"r":9},
    "hw:9":{"e":1},
    "hw:10":{"t":3},
    "hw:11":{"r":12},
    "hw:12":{"m":"lucia"},
    "hw:13":{"m":"kung"},
    "gl:5":{"r":7},
    "gl:6":{"r":5},
    "gl:7":{"e":1},
    "gl:8":{"m":"uggla"},
    "gl:9":{"r":14},
    "gl:10":{"r":17},
    "up:3":{"m":"sg10"},
    "up:4":{"r":4},
    "up:5":{"r":12},
    "up:6":{"r":20},
    "up:7":{"r":25},
    "up:8":{"s":4},
    "bg:8":{"r":3},
    "bg:9":{"s":2},
    "bg:10":{"t":2},
    "bg:11":{"r":15},
    "sk:18":{"r":10},
    "sk:19":{"g":3},
    "sk:20":{"d":"10-20:11-08"},
    "sk:21":{"d":"12-01:01-06","o":[{"m":"lucia"}]},
    "sk:22":{"r":35},
    "ey:12":{"m":"sr10"},
    "ey:17":{"m":"krogrunda"},
    "ey:18":{"d":"10-20:11-08"},
    "ey:19":{"e":3},
    "ey:20":{"r":30},
    "ey:21":{"d":"10-20:11-08","o":[{"r":20}]},
    "ec:8":{"s":2},
    "ec:9":{"r":8},
    "ec:10":{"d":"10-20:11-08","o":[{"m":"spoke"}]},
    "ec:11":{"m":"kung"},
    "br:10":{"r":6},
    "ns:9":{"e":2},
    "ns:10":{"d":"12-01:01-06"},
    "mt:16":{"d":"10-20:11-08"},
    "mt:19":{"b":15},
    "mt:20":{"m":"dagsljus"},
    "mt:21":{"m":"liga"},
    "fp:3":{"r":5},
    "fp:4":{"r":11},
    "fp:5":{"e":1},
    "fp:6":{"d":"10-20:11-08"},
    "fp:8":{"d":"06-10:06-30","o":[{"m":"midsommar"}]},
    "fp:9":{"d":"12-01:01-06","o":[{"m":"lucia"}]},
    "fp:11":{"m":"m50"},
    "er:5":{"m":"faltresa"},
    "er:7":{"m":"m100"},
    "er:8":{"r":25},
    "er:11":{"d":"10-20:11-08"},
    "hr:27":{"r":8},
    "hr:28":{"s":2},
    "hr:32":{"b":10},
    "hc:16":{"g":2},
    "hc:17":{"r":9},
    "hc:18":{"t":3},
    "hc:19":{"d":"10-20:11-08","o":[{"r":16}]},
    "hc:21":{"e":2},
    "fh:13":{"r":22},
    "fh:18":{"d":"12-01:01-06","o":[{"m":"lucia"}]},
    "fh:21":{"t":5},
    "fh:24":{"d":"10-20:11-08"},
    "hw:14":{"d":"05-20:06-20","o":[{"d":"04-25:05-02"},{"r":11}]},
    "hw:16":{"g":2},
    "hw:17":{"b":3},
    "hw:18":{"d":"06-10:06-30","o":[{"m":"midsommar"}]},
    "hw:19":{"d":"12-01:12-20","o":[{"m":"lucia"}]},
    "hw:23":{"t":4},
    "hw:25":{"s":3},
    "hw:26":{"r":16},
    "hw:27":{"r":7},
    "hw:28":{"r":8},
    "hw:29":{"d":"11-15:03-15","o":[{"r":13}]},
    "hw:30":{"r":18},
    "hw:31":{"e":1},
    "hw:32":{"m":"m100"},
    "hw:33":{"d":"10-20:11-08"},
    "hw:34":{"d":"10-20:11-08"},
    "hw:35":{"d":"12-27:01-06","o":[{"m":"nyar"}]},
    "hw:36":{"d":"12-01:01-06"},
    "hw:37":{"e":2},
    "hw:41":{"m":"komhem"},
    "hw:42":{"r":15},
    "hw:43":{"r":30},
    "gl:14":{"m":"sg10"},
    "gl:15":{"e":3},
    "gl:20":{"m":"m50"},
    "gl:21":{"r":12},
    "gl:22":{"t":3},
    "gl:23":{"m":"spion"},
    "gl:24":{"d":"12-27:01-06","o":[{"m":"nyar"}]},
    "gl:25":{"r":20},
    "gl:28":{"r":10},
    "gl:29":{"r":26},
    "nk:5":{"m":"faltresa"},
    "nk:8":{"g":2},
    "nk:9":{"r":6},
    "nk:10":{"m":"m10"},
    "nk:12":{"m":"liga"},
    "nk:13":{"m":"trumslag"},
    "nk:14":{"d":"12-01:01-06"},
    "nk:15":{"r":24},
    "up:9":{"e":2},
    "up:11":{"b":8},
    "up:14":{"r":9},
    "up:15":{"s":2},
    "up:21":{"g":3},
    "up:22":{"d":"06-10:06-30","o":[{"m":"midsommar"}]},
    "up:23":{"d":"12-01:01-06","o":[{"m":"lucia"}]},
    "up:24":{"d":"10-20:11-08"},
    "up:25":{"r":10},
    "up:26":{"r":8},
    "up:27":{"r":18},
    "up:28":{"r":28},
    "up:29":{"b":20},
    "up:30":{"m":"hemvarn"},
    "bg:19":{"b":2},
    "bg:20":{"g":1},
    "bg:22":{"d":"06-10:06-30","o":[{"m":"midsommar"}]},
    "bg:23":{"t":5},
    "bg:24":{"m":"n5"},
    "bg:25":{"b":3},
    "bg:29":{"d":"04-20:05-03","o":[{"m":"valborg"}]},
    "bg:30":{"d":"10-20:11-08"},
    "bg:31":{"d":"12-01:01-06","o":[{"m":"lucia"}]},
    "bg:32":{"d":"12-27:01-06","o":[{"m":"nyar"}]},
    "bg:33":{"t":3},
    "bg:34":{"e":2},
    "bg:35":{"m":"n25"},
    "bg:36":{"b":15},
    "bg:37":{"r":33},
    "bg:38":{"m":"m10"},
    "hi:5":{"e":3},
    "hi:8":{"b":2},
    "hi:9":{"m":"signal"},
    "hi:10":{"k":1},
    "hi:11":{"d":"06-10:06-30","o":[{"m":"midsommar"},{"d":"12-15:12-26"}]},
    "hi:12":{"d":"10-20:11-08"},
    "hi:13":{"d":"12-01:01-06"},
    "hi:14":{"r":12},
    "hi:15":{"m":"liga"},
    "hi:16":{"m":"vatten"},
    "fr:2":{"r":11},
    "fr:3":{"r":21},
    "fr:4":{"r":31},
    "fr:5":{"r":40},
    "fr:6":{"m":"liga"},
    "fr:8":{"e":3},
    "fr:9":{"s":5},
    "fr:10":{"m":"n100"}
  }'::jsonb;
$$;

-- One lock vs the facts: all plain needs met, or any alternative in lk.o (same as AVATAR.unlocked in avatar.js).
create or replace function public.olnu_avatar_lock_ok(p_lk jsonb, p_f jsonb)
returns boolean language plpgsql immutable set search_path to 'public' as $$
declare v_ok boolean := true; v_t text := coalesce(p_f->>'today', '01-01'); v_a text; v_b text; x jsonb;
begin
  if p_lk is null then return true; end if;
  if (p_lk ? 'r' and coalesce((p_f->>'r')::int, 1) < (p_lk->>'r')::int)
     or (p_lk ? 'm' and not coalesce(p_f->'m', '[]'::jsonb) ? (p_lk->>'m'))
     or (p_lk ? 's' and coalesce((p_f->>'s')::int, 0) < (p_lk->>'s')::int)
     or (p_lk ? 'b' and coalesce((p_f->>'b')::int, 0) < (p_lk->>'b')::int)
     or (p_lk ? 't' and coalesce((p_f->>'t')::int, 0) < (p_lk->>'t')::int)
     or (p_lk ? 'e' and coalesce((p_f->>'e')::int, 0) < (p_lk->>'e')::int)
     or (p_lk ? 'g' and coalesce((p_f->>'g')::int, 0) < (p_lk->>'g')::int)
     or (p_lk ? 'k' and coalesce((p_f->>'k')::int, 0) < (p_lk->>'k')::int) then
    v_ok := false;
  end if;
  if v_ok and p_lk ? 'd' then
    v_a := substr(p_lk->>'d', 1, 5); v_b := substr(p_lk->>'d', 7, 5);
    v_ok := case when v_a <= v_b then v_t between v_a and v_b else v_t >= v_a or v_t <= v_b end;
  end if;
  if v_ok then return true; end if;
  if jsonb_typeof(p_lk->'o') = 'array' then
    for x in select * from jsonb_array_elements(p_lk->'o') loop
      if public.olnu_avatar_lock_ok(x, p_f) then return true; end if;
    end loop;
  end if;
  return false;
end; $$;

-- The unlock facts of one user (0172 + g groups, k film shots, today = MM-DD in Stockholm).
create or replace function public.olnu_avatar_facts(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_m int := 0; v_r int := 1; v_n int := 42; v_title text; v_next text; v_next_at int;
  v_s int := 0; v_b int := 0; v_t int := 0; v_e int := 0; v_g int := 0; v_k int := 0; v_md jsonb := '[]'::jsonb;
begin
  begin v_m := coalesce(public.olnu_meriter(p_uid), 0); exception when others then v_m := 0; end;
  begin
    select ro.idx, ro.n, ro.title, ro.next_title, ro.next_at into v_r, v_n, v_title, v_next, v_next_at from public.olnu_rank_of(v_m) ro;
  exception when others then v_r := 1; end;
  begin v_s := coalesce((public.olnu_helg_calc(p_uid, now())->>'best')::int, 0); exception when others then v_s := 0; end;
  begin select count(distinct mc.bar_id)::int into v_b from public.medal_checkins mc where mc.user_id = p_uid; exception when others then v_b := 0; end;
  begin select count(distinct an.town)::int into v_t from public.after_nights an where an.user_id = p_uid and an.town is not null; exception when others then v_t := 0; end;
  begin
    select count(*)::int into v_e from public.invite_people p join public.invites i on i.id = p.invite_id
     where p.user_id = p_uid and p.answer = 'yes' and i.creator <> p_uid and i.starts_at < now();
  exception when others then v_e := 0; end;
  begin
    select count(*)::int into v_g from public.group_members gm
     where gm.user_id = p_uid and not public.olnu_is_temp_group(gm.group_id);
  exception when others then v_g := 0; end;
  begin select count(*)::int into v_k from public.snap_photos sp where sp.user_id = p_uid and sp.kind = 'film'; exception when others then v_k := 0; end;
  select coalesce(jsonb_agg(um.medal order by um.earned_at desc), '[]'::jsonb) into v_md
    from public.user_medals um where um.user_id = p_uid;
  return jsonb_build_object('mer', v_m, 'r', coalesce(v_r, 1), 'n', coalesce(v_n, 42), 'title', v_title,
    'next_title', v_next, 'next_at', v_next_at, 's', v_s, 'b', v_b, 't', v_t, 'e', v_e, 'g', v_g, 'k', v_k, 'm', v_md,
    'today', to_char(now() at time zone 'Europe/Stockholm', 'MM-DD'));
end; $$;

-- Validate + clean a spec for one user. Raises invalid_avatar / locked. The value the user already wears is never "locked".
create or replace function public.olnu_avatar_clean(p_uid uuid, p_spec jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_max jsonb := public.olnu_avatar_max();
  v_locks jsonb := public.olnu_avatar_locks();
  v_f jsonb := public.olnu_avatar_facts(p_uid);
  v_cur jsonb;
  v_out jsonb := jsonb_build_object('v', 2);
  k text; val jsonb; n int; lk jsonb; md jsonb := '[]'::jsonb; x jsonb;
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
    if lk is not null and not public.olnu_avatar_lock_ok(lk, v_f)
       and not (v_cur is not null and jsonb_typeof(v_cur->k) = 'number' and (v_cur->>k)::numeric = n) then
      raise exception 'locked';
    end if;
    v_out := v_out || jsonb_build_object(k, n);
  end loop;
  if jsonb_array_length(md) > 0 then v_out := v_out || jsonb_build_object('md', md); end if;
  return v_out;
end; $$;

-- my_avatar() -> {v:2, spec|null, seed, facts:{… g, k, today}}
create or replace function public.my_avatar()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); v_spec jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select a.spec into v_spec from public.avatars a where a.user_id = v_uid;
  return jsonb_build_object('v', 2, 'spec', v_spec, 'seed', public.olnu_avatar_seed(v_uid),
                            'facts', public.olnu_avatar_facts(v_uid));
end; $$;

revoke all on function public.olnu_avatar_lock_ok(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.olnu_avatar_facts(uuid) from public, anon, authenticated;
revoke all on function public.olnu_avatar_clean(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.my_avatar() from public, anon;
grant execute on function public.my_avatar() to authenticated;
