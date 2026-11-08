-- public.submit_bar_area(p_bar_id text, p_polygon jsonb)
-- live md5(pg_get_functiondef) = 9ac1e0c18cb7b4647b6d61d286039217
CREATE OR REPLACE FUNCTION public.submit_bar_area(p_bar_id text, p_polygon jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_pos double precision[];
  v_chk jsonb;
  v_trust boolean;
  v_id bigint;
  v_status text;
begin
  if p_bar_id is null or char_length(p_bar_id) not between 1 and 80 then raise exception 'unknown_bar'; end if;
  v_pos := public.olnu_area_bar_pos(p_bar_id);
  if v_pos is null then raise exception 'unknown_bar'; end if;
  v_chk := public.olnu_area_check(p_polygon, v_pos[1], v_pos[2]);
  perform pg_advisory_xact_lock(hashtextextended('olnu-area:' || v_uid::text, 0));
  if (select count(*) from public.bar_areas a where a.created_by = v_uid and a.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'slow_down';
  end if;
  v_trust := exists (select 1 from public.bar_area_trusted t where t.user_id = v_uid and t.active);
  v_status := case when v_trust then 'ok' else 'pending' end;
  -- my older pending drafts of this bar are replaced by this one
  update public.bar_areas a set superseded_at = now()
   where a.created_by = v_uid and a.bar_id = p_bar_id and a.status = 'pending' and a.superseded_at is null;
  insert into public.bar_areas (bar_id, polygon, area_m2, n_pts, bar_lat, bar_lng, created_by, status, auto, status_at)
  values (p_bar_id, v_chk -> 'pts', (v_chk ->> 'area')::real, (v_chk ->> 'n')::int, v_pos[1], v_pos[2], v_uid, v_status, v_trust,
          case when v_trust then now() end)
  returning id into v_id;
  if v_trust then perform public.olnu_area_supersede(p_bar_id, v_id); end if;
  return jsonb_build_object('id', v_id, 'bar_id', p_bar_id, 'status', v_status, 'auto', v_trust, 'area_m2', (v_chk ->> 'area')::numeric,
                            'polygon', v_chk -> 'pts');
end; $function$;
