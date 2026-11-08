-- public.olnu_avatar_facts(p_uid uuid)
-- live md5(pg_get_functiondef) = 8bd9221ac79255bf3273343dfe8560a5
CREATE OR REPLACE FUNCTION public.olnu_avatar_facts(p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_m int := 0; v_r int := 1; v_n int := 42; v_title text; v_next text; v_next_at int;
  v_s int := 0; v_b int := 0; v_t int := 0; v_e int := 0; v_g int := 0; v_k int := 0; v_md jsonb := '[]'::jsonb; v_gf boolean := false;
begin
  begin v_m := coalesce(public.olnu_meriter(p_uid), 0); exception when others then v_m := 0; end;
  begin
    select ro.idx, ro.n, ro.title, ro.next_title, ro.next_at into v_r, v_n, v_title, v_next, v_next_at from public.olnu_rank_of(v_m) ro;
  exception when others then v_r := 1; end;
  begin v_s := coalesce((public.olnu_helg_calc(p_uid, now())->>'best')::int, 0); exception when others then v_s := 0; end;
  begin select count(distinct mc.bar_id)::int into v_b from public.medal_checkins mc where mc.user_id = p_uid; exception when others then v_b := 0; end;
  begin select count(distinct an.town)::int into v_t from public.after_nights an where an.user_id = p_uid and an.town is not null; exception when others then v_t := 0; end;
  begin
    select count(*)::int into v_e from public.invite_people p join public.invites i on i.id = p.invite_id
     where p.user_id = p_uid and p.answer = 'yes' and i.creator <> p_uid and i.starts_at < now();
  exception when others then v_e := 0; end;
  begin
    select count(*)::int into v_g from public.group_members gm
     where gm.user_id = p_uid and not public.olnu_is_temp_group(gm.group_id);
  exception when others then v_g := 0; end;
  begin select count(*)::int into v_k from public.snap_photos sp where sp.user_id = p_uid and sp.kind = 'film'; exception when others then v_k := 0; end;
  begin select exists (select 1 from public.avatar_grandfather x where x.user_id = p_uid) into v_gf; exception when others then v_gf := false; end;
  select coalesce(jsonb_agg(um.medal order by um.earned_at desc), '[]'::jsonb) into v_md
    from public.user_medals um where um.user_id = p_uid;
  return jsonb_build_object('mer', v_m, 'r', coalesce(v_r, 1), 'n', coalesce(v_n, 42), 'title', v_title,
    'next_title', v_next, 'next_at', v_next_at, 's', v_s, 'b', v_b, 't', v_t, 'e', v_e, 'g', v_g, 'k', v_k, 'm', v_md,
    'gf', coalesce(v_gf, false), 'today', to_char(now() at time zone 'Europe/Stockholm', 'MM-DD'));
end; $function$;
