-- 0123 (social2) "Nu" strip on the group page + richer join_preview for the invite welcome card.
-- group_now(p_group_id): who in the group is out right now, where (only a check-in or a PRECISE pin snapped to a bar;
--   an approximate pin never names a place; a ghost pin = not out), drinks tonight, and the newest beer/check-in.
--   Members only. Read-only.
-- join_preview(p_code): same signature and fields as 0086, plus 'out' (members out now, ghost pins not counted)
--   and 'faces' (up to 4 first letters, people out first). Additive: old clients ignore the new fields.
-- No row is ever removed by this file. Safe to run again.

create or replace function public.group_now(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.olnu_uid();
  v_out jsonb;
  v_last jsonb;
  v_n int;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select count(*)::int into v_n from public.group_members m where m.group_id = p_group_id;
  with mem as (
    select gm.user_id, gm.display_name from public.group_members gm where gm.group_id = p_group_id
  ), live as (
    select m.user_id, m.display_name, b.beer_count, b.other_count, b.precise, b.snap_bar,
           greatest(coalesce(b.beer_at, b.created_at), coalesce(b.other_at, b.created_at), b.updated_at) as at,
           (select c.bar_name from public.checkins c where c.user_id = m.user_id and c.expires_at > now()
             order by c.created_at desc limit 1) as ci_name,
           (select c.created_at from public.checkins c where c.user_id = m.user_id and c.expires_at > now()
             order by c.created_at desc limit 1) as ci_at
      from mem m
      join public.beers b on b.user_id = m.user_id
     where b.expires_at > now() and not coalesce(b.stopped, false) and not coalesce(b.ghost, false)
       and coalesce(b.beer_count, 0) + coalesce(b.other_count, 0) > 0
  ), rr as (
    select l.*, coalesce(l.ci_name,
             case when l.precise and l.snap_bar is not null then (select bl.name from public.bars_lite bl where bl.id = l.snap_bar) end) as place,
           case when l.ci_name is null and l.precise then l.snap_bar end as bar_id
      from live l
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', r.display_name, 'i', upper(left(btrim(coalesce(r.display_name, '?')), 1)),
           'place', r.place, 'bar_id', r.bar_id,
           'drinks', coalesce(r.beer_count, 0) + coalesce(r.other_count, 0),
           'at', greatest(r.at, coalesce(r.ci_at, r.at)), 'me', r.user_id = v_uid)
           order by greatest(r.at, coalesce(r.ci_at, r.at)) desc), '[]'::jsonb)
    into v_out from rr r;
  -- newest event tonight: a drink or a check-in (check-ins without a live pin count too)
  select x.j into v_last from (
    select jsonb_build_object('name', m.display_name, 'kind', 'checkin', 'place', c.bar_name, 'at', c.created_at, 'me', m.user_id = v_uid) as j, c.created_at as at
      from public.group_members m join public.checkins c on c.user_id = m.user_id
     where m.group_id = p_group_id and c.expires_at > now()
       and not exists (select 1 from public.beers b where b.user_id = m.user_id and coalesce(b.ghost, false) and b.expires_at > now())
    union all
    select jsonb_build_object('name', m.display_name, 'kind', case when coalesce(b.other_at, '-infinity') > coalesce(b.beer_at, '-infinity') then 'other' else 'beer' end,
             'place', case when b.precise and b.snap_bar is not null then (select bl.name from public.bars_lite bl where bl.id = b.snap_bar) end,
             'at', greatest(coalesce(b.beer_at, b.created_at), coalesce(b.other_at, b.created_at)), 'me', m.user_id = v_uid),
           greatest(coalesce(b.beer_at, b.created_at), coalesce(b.other_at, b.created_at))
      from public.group_members m join public.beers b on b.user_id = m.user_id
     where m.group_id = p_group_id and b.expires_at > now() and not coalesce(b.stopped, false) and not coalesce(b.ghost, false)
       and coalesce(b.beer_count, 0) + coalesce(b.other_count, 0) > 0
  ) x order by x.at desc limit 1;
  return jsonb_build_object('v', 1, 'now', now(), 'members', v_n, 'out', v_out, 'last', v_last);
end;
$$;

create or replace function public.join_preview(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_g    public.groups%rowtype;
  v_n    int;
  v_mem  boolean;
  v_faces jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if (select count(*) from public.join_fails f where f.user_id = v_uid and f.at > now() - interval '10 minutes') >= 8 then
    return jsonb_build_object('ok', false, 'why', 'slow_down');
  end if;
  if char_length(v_code) <> 6 then
    return jsonb_build_object('ok', false, 'why', 'group_not_found');
  end if;
  select * into v_g from public.groups g where g.code = v_code;
  if not found then
    insert into public.join_fails (user_id) values (v_uid);
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
$$;

revoke all on function public.group_now(uuid) from public;
revoke all on function public.join_preview(text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.group_now(uuid) from anon';
    execute 'revoke all on function public.join_preview(text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.group_now(uuid) to authenticated';
    execute 'grant execute on function public.join_preview(text) to authenticated';
  end if;
end $$;
