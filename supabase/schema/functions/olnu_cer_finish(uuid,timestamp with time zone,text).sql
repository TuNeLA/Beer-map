-- public.olnu_cer_finish(p_gid uuid, p_night timestamp with time zone, p_how text)
-- live md5(pg_get_functiondef) = 527d5d20ecdff7e3cf86dd177b8f6d59
CREATE OR REPLACE FUNCTION public.olnu_cer_finish(p_gid uuid, p_night timestamp with time zone, p_how text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ins int := 0;
  v_n int := 0;
begin
  select count(*) into v_n from public.olnu_cer_out(p_gid, p_night);
  insert into public.cer_done (group_id, night, how, voters) values (p_gid, p_night, p_how, v_n)
    on conflict (group_id, night) do nothing;
  get diagnostics v_ins = row_count;
  if v_ins = 0 then return; end if;
  insert into public.cer_results (group_id, night, cat, winner, votes)
  select p_gid, p_night, x.cat, x.target, x.n from (
    select v.cat, v.target, count(*)::int as n, max(count(*)) over (partition by v.cat) as top
      from public.cer_votes v
     where v.group_id = p_gid and v.night = p_night and v.voter <> v.target
       and v.cat = any (public.olnu_cer_cats())
       and v.voter in (select o.user_id from public.olnu_cer_out(p_gid, p_night) o)
       and v.target in (select o.user_id from public.olnu_cer_out(p_gid, p_night) o)
     group by v.cat, v.target) x
   where x.n = x.top and x.n >= 1
  on conflict do nothing;
end;
$function$;
