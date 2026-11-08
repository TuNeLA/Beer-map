-- public.olnu_mer_duel(p_duel bigint)
-- live md5(pg_get_functiondef) = 485814764681dabdc0d8643a5e9be535
CREATE OR REPLACE FUNCTION public.olnu_mer_duel(p_duel bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d     public.duels;
  r     record;
  v_n   int := 0;
  v_win text;
begin
  select * into d from public.duels x where x.id = p_duel;
  if not found or d.winner is null or d.accepted_at is null then return 0; end if;
  for r in
    with sides as (
      select 'a'::text as side, d.group_a as gid, d.group_b as oid
      union all select 'b', d.group_b, d.group_a
    ), mem as (
      select s.side, m.user_id
        from sides s join public.group_members m on m.group_id = s.gid
       where not exists (select 1 from public.group_members o where o.group_id = s.oid and o.user_id = m.user_id)
          or (select ds.side from public.duel_sides ds where ds.duel_id = d.id and ds.user_id = m.user_id) = s.side
    )
    select mem.side, mem.user_id,
           coalesce((select sum(l.n) from public.duel_log l where l.user_id = mem.user_id and l.kind = 'drink'
                      and l.at >= d.accepted_at and l.at <= d.ends_at), 0) as dr,
           exists (select 1 from public.duel_log l where l.user_id = mem.user_id
                    and l.at >= d.accepted_at and l.at <= d.ends_at) as act
      from mem
  loop
    v_win := case when d.winner = r.side then 'w' else '' end;
    if r.act then
      v_n := v_n + public.olnu_mer_add(r.user_id, public.olnu_night_of(d.ends_at - interval '1 second'), 'duel', d.id::text, 5, null);
    end if;
    if v_win = 'w' and r.dr > 0 then
      v_n := v_n + public.olnu_mer_add(r.user_id, public.olnu_night_of(d.ends_at - interval '1 second'), 'duel_win', d.id::text, 15, null);
    end if;
  end loop;
  return v_n;
end; $function$;
