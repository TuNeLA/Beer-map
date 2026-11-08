-- public.olnu_crew_torch_json(p_torch bigint, p_uid uuid, p_cands boolean)
-- live md5(pg_get_functiondef) = 8feeacf802b8a1accac05ef113080107
CREATE OR REPLACE FUNCTION public.olnu_crew_torch_json(p_torch bigint, p_uid uuid, p_cands boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t public.crew_torches;
  v_hops jsonb; v_cands jsonb := '[]'::jsonb; v_mine boolean;
  v_hb record;
begin
  select * into t from public.crew_torches x where x.id = p_torch;
  if not found then return null; end if;
  v_mine := t.holder is not null and public.olnu_crew_member(t.holder, p_uid);
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', h.created_at, 'how', h.how, 'bar_name', h.bar_name, 'lat', h.lat, 'lng', h.lng,
           'to', public.olnu_crew_glabel(h.to_group, p_uid),
           'by', case when h.by_user is not null and public.olnu_crew_member(h.to_group, p_uid)
                      then public.olnu_crew_name(h.to_group, h.by_user) end) order by h.id), '[]'::jsonb)
    into v_hops from public.crew_torch_hops h where h.torch_id = t.id;
  select h.bar_name into v_hb from public.crew_torch_hops h where h.torch_id = t.id and h.to_group = t.holder
   order by h.id desc limit 1;
  if p_cands and v_mine and t.pending is null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', left(md5('crewt:' || t.id::text || ':' || g.group_id::text), 12),
             'label', public.olnu_crew_glabel(g.group_id, p_uid), 'bar_name', g.bar_name, 'n', g.n)
             order by g.n desc, g.bar_name), '[]'::jsonb)
      into v_cands from public.olnu_crew_town_groups(t.town, t.c_lat, t.c_lng) g
     where g.group_id is distinct from t.holder;
  end if;
  return jsonb_build_object(
    'id', t.id, 'town', t.town_name, 'night', t.night, 'passes', t.passes,
    'holder', public.olnu_crew_glabel(t.holder, p_uid), 'holder_bar', v_hb.bar_name,
    'holder_group', case when v_mine then t.holder end,
    'pending', case when t.pending is null then null else jsonb_build_object(
        'to', public.olnu_crew_glabel(t.pending, p_uid),
        'to_group', case when public.olnu_crew_member(t.pending, p_uid) then t.pending end,
        'from', public.olnu_crew_glabel(t.pending_from, p_uid),
        'at', t.pending_at, 'until', t.pending_until) end,
    'hops', v_hops, 'cands', v_cands);
end; $function$;
