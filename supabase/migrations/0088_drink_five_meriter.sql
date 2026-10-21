-- 0088 Owner: every drink gives 5 meriter (was 1). Old drink rows are counted again at 5, and totals are rebuilt.
create or replace function public.olnu_mer_add(p_uid uuid, p_night timestamptz, p_kind text, p_ref text, p_pts int,
                                               p_cap int default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used int;
  v_pts  int := p_pts;
  v_got  int;
begin
  if p_uid is null or p_night is null or p_kind is null or coalesce(p_pts, 0) <= 0 then
    return 0;
  end if;
  if p_kind = 'drink' then v_pts := 5; end if;   -- owner rule (0088): a drink is worth 5 meriter
  perform pg_advisory_xact_lock(hashtextextended('olnu-mer:' || p_uid::text, 0));
  if p_cap is not null then
    select coalesce(sum(l.pts), 0)::int into v_used
      from public.meriter_log l where l.user_id = p_uid and l.night = p_night and l.kind = p_kind;
    if v_used >= p_cap then return 0; end if;
    v_pts := least(v_pts, p_cap - v_used);
  end if;
  insert into public.meriter_log (user_id, night, kind, ref, pts)
  values (p_uid, p_night, p_kind, coalesce(p_ref, ''), v_pts)
  on conflict (user_id, night, kind, ref) do nothing
  returning pts into v_got;
  return coalesce(v_got, 0);
end; $$;

update public.meriter_log set pts = 5 where kind = 'drink' and pts < 5;

update public.meriter_totals t set total = s.total, updated_at = now()
  from (select user_id, coalesce(sum(pts), 0)::int as total from public.meriter_log group by user_id) s
 where s.user_id = t.user_id and t.total is distinct from s.total;

-- Quiet: ranks reached only by this recount are "already announced" (no surprise level-up pushes).
insert into public.push_sent (user_id, kind, night)
select t.user_id, 'title:' || r.title, '2100-01-01T00:00:00Z'::timestamptz
  from public.meriter_totals t cross join lateral public.olnu_rank_of(t.total) r
 where r.at > 0
on conflict do nothing;
