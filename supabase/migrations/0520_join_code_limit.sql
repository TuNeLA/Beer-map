-- 0520 · group codes: a day limit per IP and a global soft limit for wrong codes (lane srv1, security test 14 Nov, finding 6). OWNER-RUN. Staging first. Run AFTER 0510.
-- Check after the run (expect t, t, t, t):
--   select position('/*s520*/' in pg_get_functiondef('public.join_group(text, text)'::regprocedure)) > 0,
--     position('/*s520*/' in pg_get_functiondef('public.join_preview(text)'::regprocedure)) > 0,
--     position('/*s510*/' in pg_get_functiondef('public.join_group(text, text)'::regprocedure)) > 0,
--     to_regprocedure('public.olnu_s520_join_limited()') is not null;
--
-- Why: the guess limit was 8 wrong codes per user per 10 minutes, and a new anonymous user is free. 0510 added
-- 60 wrong codes per IP per 10 minutes. That still lets one IP try 8 640 codes per day, and many IPs at the same time
-- are not seen at all.
-- What changes (join_group and join_preview: same names, parameters, answers; the refusal is slow_down as before):
--   1. per IP and 10 minutes: 60 wrong codes (the 0510 rule, same counter rows 'j510:<ip key>' in gw_link_hits).
--   2. per IP and 24 hours: 200 wrong codes.
--   3. global soft limit: when all callers together sent 400 or more wrong codes in the last 10 to 20 minutes, the
--      limit per IP is 10 wrong codes per 10 minutes until the guessing stops (counter row 'j520:all').
-- A person who types a wrong code a few times still gets in: a correct code is refused only while that person's own
-- IP is over its limit, and the per-user rule (8 per 10 minutes) is as before.
-- Not done: a limit per code prefix. It would let a stranger lock real people out of a real code (he sends wrong codes
-- with the same first letters). The global soft limit gives the same slow-down without that.
-- Functions replaced (snapshot these first = the rollback): join_group(text, text), join_preview(text)
--   [full replace; the text must be the 0510 text: md5 3e3a2fca… and 0979c287…. If the guard stops the file, run 0510 first].
-- The 0510 helpers olnu_s510_join_limited / olnu_s510_join_fail stay (not used any more; 0510 may run again, it skips).
-- New internal helpers (no grant to anon / authenticated): olnu_s520_join_limited(), olnu_s520_join_fail().
-- Additive. Safe to run twice. CR LF safe. Needs: 0510, olnu_gw_client_key, gw_link_hits, olnu_strip_cr (0436).

create or replace function public.olnu_fn_expect(p_fn regprocedure, p_marker text, p_md5 text[])
returns text language plpgsql set search_path = public as $$
declare
  v_def text := replace(pg_get_functiondef(p_fn), chr(13), '');
begin
  if position(p_marker in v_def) > 0 then return 'has ' || p_marker || ' ' || p_fn::text; end if;
  if md5(v_def) = any (p_md5) then return 'ok ' || p_fn::text; end if;
  raise exception 'olnu_fn_expect %: this function is not the text that the file was made from (md5 %). Stop and tell the coordinator.', p_fn::text, md5(v_def);
end $$;
revoke all on function public.olnu_fn_expect(regprocedure, text, text[]) from public, anon, authenticated;

create or replace function public.olnu_s520_join_limited()
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_k    text := public.olnu_gw_client_key();
  v_slot bigint := floor(extract(epoch from now()) / 600)::bigint;
  v_ip   int;
  v_day  int;
  v_all  int;
begin
  if v_k is null or v_k = 'none' then return false; end if;
  select coalesce(sum(h.bad) filter (where h.slot = v_slot), 0), coalesce(sum(h.bad), 0) into v_ip, v_day
    from public.gw_link_hits h where h.k = 'j510:' || v_k and h.slot > v_slot - 144;
  select coalesce(sum(h.bad), 0) into v_all
    from public.gw_link_hits h where h.k = 'j520:all' and h.slot >= v_slot - 1;
  return v_ip >= (case when v_all >= 400 then 10 else 60 end) or v_day >= 200;
end $$;

create or replace function public.olnu_s520_join_fail()
returns void language plpgsql set search_path = public as $$
declare
  v_k    text := public.olnu_gw_client_key();
  v_slot bigint := floor(extract(epoch from now()) / 600)::bigint;
begin
  insert into public.gw_link_hits as h (k, slot, n, bad) values ('j520:all', v_slot, 1, 1)
  on conflict (k, slot) do update set n = h.n + 1, bad = h.bad + 1;
  if v_k is null or v_k = 'none' then return; end if;
  insert into public.gw_link_hits as h (k, slot, n, bad) values ('j510:' || v_k, v_slot, 1, 1)
  on conflict (k, slot) do update set n = h.n + 1, bad = h.bad + 1;
end $$;

revoke all on function public.olnu_s520_join_limited() from public, anon, authenticated;
revoke all on function public.olnu_s520_join_fail() from public, anon, authenticated;

select public.olnu_fn_expect('public.join_group(text, text)', '/*s520*/', array['3e3a2fca70dfffa50bac85c68cc438ad']);
CREATE OR REPLACE FUNCTION public.join_group(p_code text, p_display_name text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     uuid := public.olnu_uid();
  v_code    text := upper(btrim(coalesce(p_code, '')));
  v_display text := public.olnu_clean_display_name(p_display_name);
  v_group   public.groups%rowtype;
begin
  if public.olnu_s520_join_limited() /*s510*/ /*s520*/ or (select count(*) from public.join_fails f where f.user_id = v_uid and f.at > now() - interval '10 minutes') >= 8 then
    raise exception 'slow_down';
  end if;
  select * into v_group from public.groups g where g.code = v_code;
  if not found then
    insert into public.join_fails (user_id) values (v_uid);
    perform public.olnu_s520_join_fail();
    perform set_config('response.status', '400', true);
    return json_build_object('code', 'P0001', 'message', 'group_not_found', 'details', null, 'hint', null);
  end if;
  insert into public.group_members (group_id, user_id, display_name)
  values (v_group.id, v_uid, v_display)
  on conflict (group_id, user_id) do update set display_name = excluded.display_name;
  return json_build_object('id', v_group.id, 'name', v_group.name, 'code', v_group.code);
end;
$function$;

select public.olnu_fn_expect('public.join_preview(text)', '/*s520*/', array['0979c28719fddfe0122108baa5997928']);
CREATE OR REPLACE FUNCTION public.join_preview(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_g    public.groups%rowtype;
  v_n    int;
  v_mem  boolean;
  v_faces jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if public.olnu_s520_join_limited() /*s510*/ /*s520*/ or (select count(*) from public.join_fails f where f.user_id = v_uid and f.at > now() - interval '10 minutes') >= 8 then
    return jsonb_build_object('ok', false, 'why', 'slow_down');
  end if;
  if char_length(v_code) <> 6 then
    return jsonb_build_object('ok', false, 'why', 'group_not_found');
  end if;
  select * into v_g from public.groups g where g.code = v_code;
  if not found then
    insert into public.join_fails (user_id) values (v_uid);
    perform public.olnu_s520_join_fail();
    return jsonb_build_object('ok', false, 'why', 'group_not_found');
  end if;
  select count(*)::int, coalesce(bool_or(m.user_id = v_uid), false) into v_n, v_mem
    from public.group_members m where m.group_id = v_g.id;
  select coalesce(jsonb_agg(f.i), '[]'::jsonb) into v_faces from (
    select upper(left(btrim(coalesce(m.display_name, '?')), 1)) as i
      from public.group_members m
      left join public.beers b on b.user_id = m.user_id and b.expires_at > now() and not coalesce(b.stopped, false) and not coalesce(b.ghost, false)
     where m.group_id = v_g.id
     order by (b.user_id is not null) desc, m.joined_at
     limit 4) f;
  return jsonb_build_object('ok', true, 'name', v_g.name, 'members', v_n, 'member', v_mem,
    'out', public.olnu_card_out(v_g.id), 'faces', v_faces);
end;
$function$;

select public.olnu_strip_cr();
