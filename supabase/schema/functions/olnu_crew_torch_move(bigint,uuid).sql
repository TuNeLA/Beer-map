-- public.olnu_crew_torch_move(p_torch bigint, p_skip uuid)
-- live md5(pg_get_functiondef) = acd221b916be281fd2cc634ebf89e15c
CREATE OR REPLACE FUNCTION public.olnu_crew_torch_move(p_torch bigint, p_skip uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t public.crew_torches;
  c record;
begin
  select * into t from public.crew_torches x where x.id = p_torch for update;
  if not found or t.pending is null then return; end if;
  select * into c from public.olnu_crew_town_groups(t.town, t.c_lat, t.c_lng) g
   where g.group_id is distinct from t.holder and g.group_id is distinct from p_skip
     and g.group_id is distinct from t.pending
   order by random() limit 1;
  if c.group_id is null then
    update public.crew_torches x set pending = null, pending_from = null, pending_at = null, pending_until = null,
           updated_at = now() where x.id = t.id;
    return;
  end if;
  insert into public.crew_torch_hops (torch_id, from_group, to_group, how, bar_id, bar_name, lat, lng)
  values (t.id, t.holder, c.group_id, 'random', c.bar_id, c.bar_name, c.bar_lat, c.bar_lng);
  update public.crew_torches x set holder = c.group_id, pending = null, pending_from = null, pending_at = null,
         pending_until = null, passes = x.passes + 1, updated_at = now() where x.id = t.id;
end; $function$;
