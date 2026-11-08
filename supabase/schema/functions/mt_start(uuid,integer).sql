-- public.mt_start(p_group_id uuid, p_n integer)
-- live md5(pg_get_functiondef) = f5dd6ceaedb8dc650deacefe7a4d14f6
CREATE OR REPLACE FUNCTION public.mt_start(p_group_id uuid, p_n integer DEFAULT 120)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_n int := least(greatest(coalesce(p_n, 120), 1), 10000);
  r public.gang_mt_rounds;
  v_q int;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if (select count(*) from public.group_members m where m.group_id = p_group_id) < 2 then raise exception 'not_enough'; end if;
  perform public.olnu_gang_rl('mt:' || p_group_id::text);
  for r in select * from public.gang_mt_rounds x where x.group_id = p_group_id and x.closed_at is null and x.ends_at > now() loop
    if not public.olnu_gang_mt_done(r) then raise exception 'round_open'; end if;
  end loop;
  if exists (select 1 from public.gang_mt_rounds x where x.user_id = v_uid and x.created_at > now() - interval '15 seconds') then
    raise exception 'slow_down';
  end if;
  select g.i into v_q from generate_series(0, v_n - 1) g(i)
   where g.i not in (select x.q from public.gang_mt_rounds x where x.group_id = p_group_id and x.created_at > now() - interval '30 days')
   order by random() limit 1;
  if v_q is null then v_q := floor(random() * v_n)::int; end if;
  insert into public.gang_mt_rounds (group_id, user_id, q, night, ends_at)
  values (p_group_id, v_uid, v_q, public.olnu_night_of(now()), now() + interval '10 minutes')
  returning * into r;
  return jsonb_build_object('id', r.id, 'q', r.q);
end; $function$;
