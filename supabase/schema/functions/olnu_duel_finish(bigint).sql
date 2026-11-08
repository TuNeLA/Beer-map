-- public.olnu_duel_finish(p_duel bigint)
-- live md5(pg_get_functiondef) = 40805b79af90d33edc5e6738bf42e606
CREATE OR REPLACE FUNCTION public.olnu_duel_finish(p_duel bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d public.duels;
  sa jsonb; sb jsonb;
  w text;
begin
  select * into d from public.duels x where x.id = p_duel;
  if not found then return; end if;
  if d.status = 'pending' and (d.answer_by <= now() or d.ends_at <= now()) then
    update public.duels x set status = 'expired' where x.id = d.id and x.status = 'pending';
    return;
  end if;
  if d.status <> 'active' or d.ends_at > now() or d.finished_at is not null then return; end if;
  perform public.olnu_wd_rl('duel:' || d.id::text);
  select * into d from public.duels x where x.id = p_duel;
  if d.finished_at is not null then return; end if;
  sa := public.olnu_duel_side(d.id, 'a', d.ends_at);
  sb := public.olnu_duel_side(d.id, 'b', d.ends_at);
  w := case
         when public.olnu_store_on() then (case when (sa->>'spirit')::int > (sb->>'spirit')::int then 'a'
                                               when (sa->>'spirit')::int < (sb->>'spirit')::int then 'b' else 'draw' end)   -- 0211
         when (sa->>'drinks')::int > (sb->>'drinks')::int then 'a'
         when (sa->>'drinks')::int < (sb->>'drinks')::int then 'b'
         when (sa->>'spirit')::int > (sb->>'spirit')::int then 'a'
         when (sa->>'spirit')::int < (sb->>'spirit')::int then 'b'
         else 'draw' end;
  update public.duels x
     set finished_at = now(), drinks_a = (sa->>'drinks')::int, drinks_b = (sb->>'drinks')::int,
         spirit_a = (sa->>'spirit')::int, spirit_b = (sb->>'spirit')::int, winner = w
   where x.id = d.id and x.finished_at is null;
end; $function$;
