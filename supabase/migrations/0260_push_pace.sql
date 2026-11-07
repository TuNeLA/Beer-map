-- 0260 🔕 LUGNA NOTISER (owner 2026-11-07; additive: one new table + two new service-role RPCs; notify-group v28).
-- Pace per RECIPIENT for the social push kinds (ute, kaos, bar, kul, film): max 1 per gap (default 600 s) and max
-- p_max per night (olnu_night_of). A push inside the gap is HELD (its short line saved, last 4 kept); the next allowed
-- push, or push_pace_due (called by notify-group in any later call and by the cron), sends ONE digest with the lines.
-- No existing table or function is changed. No row is removed: a new night resets the row in place.
-- Rerun = no change (create ... if not exists / create or replace).

create table if not exists public.push_pace (
  user_id uuid primary key,
  night timestamptz not null,
  n int not null default 0,                 -- paced pushes sent this night (a digest counts as one)
  last_at timestamptz,                       -- last paced push sent
  held int not null default 0,               -- pushes held since last_at
  lines text[] not null default '{}',        -- held lines "HH:MM|text" (oldest first, max 4)
  grp text,                                  -- group name for the digest title (when known)
  over_cap int not null default 0,            -- pushes over the night max (not sent, not held)
  updated_at timestamptz not null default now()
);
alter table public.push_pace enable row level security;
revoke all on table public.push_pace from public, anon, authenticated;

-- Service role only. One verdict per user: 'send' (nothing held), 'digest' (send now + the held lines), 'hold', 'cap'.
create or replace function public.push_pace_take(p_uids uuid[], p_lines text[], p_grps text[], p_gaps int[], p_maxes int[])
returns table (uid uuid, verdict text, held_n int, held_lines text[], held_grp text)
language plpgsql volatile security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_night timestamptz := public.olnu_night_of(now());
  i int; r public.push_pace%rowtype; v_u uuid; v_gap int; v_max int; v_line text; v_l text[];
begin
  for i in 1 .. least(coalesce(array_length(p_uids, 1), 0), 2000) loop
    v_u := p_uids[i];
    if v_u is null then continue; end if;
    v_gap := greatest(0, least(3600, coalesce(p_gaps[i], 600)));
    v_max := greatest(1, least(99, coalesce(p_maxes[i], 8)));
    v_line := left(coalesce(p_lines[i], ''), 90);
    insert into public.push_pace (user_id, night) values (v_u, v_night) on conflict (user_id) do nothing;
    select * into r from public.push_pace where user_id = v_u for update;
    if r.night is distinct from v_night then
      r.night := v_night; r.n := 0; r.last_at := null; r.held := 0; r.lines := '{}'; r.grp := null; r.over_cap := 0;
    end if;
    if r.n >= v_max then
      update public.push_pace set night = r.night, n = r.n, last_at = r.last_at, held = 0, lines = '{}', grp = null,
        over_cap = r.over_cap + 1, updated_at = now() where user_id = v_u;
      uid := v_u; verdict := 'cap'; held_n := 0; held_lines := '{}'; held_grp := null; return next;
    elsif r.last_at is not null and r.last_at > now() - make_interval(secs => v_gap) then
      v_l := r.lines || v_line;
      if cardinality(v_l) > 4 then v_l := v_l[cardinality(v_l) - 3 : cardinality(v_l)]; end if;
      update public.push_pace set night = r.night, n = r.n, last_at = r.last_at, held = r.held + 1, lines = v_l,
        grp = coalesce(nullif(left(coalesce(p_grps[i], ''), 60), ''), r.grp), over_cap = r.over_cap, updated_at = now()
        where user_id = v_u;
      uid := v_u; verdict := 'hold'; held_n := r.held + 1; held_lines := v_l; held_grp := null; return next;
    else
      uid := v_u; verdict := case when r.held > 0 then 'digest' else 'send' end;
      held_n := r.held; held_lines := r.lines; held_grp := r.grp;
      update public.push_pace set night = r.night, n = r.n + 1, last_at = now(), held = 0, lines = '{}', grp = null,
        over_cap = r.over_cap, updated_at = now() where user_id = v_u;
      return next;
    end if;
  end loop;
end $$;

-- Service role only. Users with held lines from THIS night whose gap is over: claim (count one push, reset) and return.
create or replace function public.push_pace_due(p_gap int default 600, p_limit int default 25)
returns table (uid uuid, verdict text, held_n int, held_lines text[], held_grp text)
language plpgsql volatile security definer set search_path to 'public' as $$
#variable_conflict use_column
declare v_night timestamptz := public.olnu_night_of(now());
begin
  return query
  with due as (
    select p.user_id from public.push_pace p
    where p.night = v_night and p.held > 0 and cardinality(p.lines) > 0
      and p.last_at < now() - make_interval(secs => greatest(60, least(3600, coalesce(p_gap, 600))))
    order by p.last_at
    limit greatest(1, least(100, coalesce(p_limit, 25)))
    for update skip locked
  ), old as (
    select p.user_id, p.held, p.lines, p.grp from public.push_pace p join due d on d.user_id = p.user_id
  ), upd as (
    update public.push_pace p set n = p.n + 1, last_at = now(), held = 0, lines = '{}', grp = null, updated_at = now()
    from due d where p.user_id = d.user_id
    returning p.user_id
  )
  select o.user_id, 'digest'::text, o.held, o.lines, o.grp from old o join upd u on u.user_id = o.user_id;
end $$;

revoke all on function public.push_pace_take(uuid[], text[], text[], int[], int[]) from public, anon, authenticated;
revoke all on function public.push_pace_due(int, int) from public, anon, authenticated;
grant execute on function public.push_pace_take(uuid[], text[], text[], int[], int[]) to service_role;
grant execute on function public.push_pace_due(int, int) to service_role;
