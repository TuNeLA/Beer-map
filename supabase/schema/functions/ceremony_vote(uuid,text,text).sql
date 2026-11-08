-- public.ceremony_vote(p_group_id uuid, p_cat text, p_k text)
-- live md5(pg_get_functiondef) = c225b9c25e08d1083d1600fc4a5c131c
CREATE OR REPLACE FUNCTION public.ceremony_vote(p_group_id uuid, p_cat text, p_k text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_now timestamptz := public.olnu_cer_now();
  v_night timestamptz := public.olnu_cer_night(v_now);
  v_st jsonb;
  v_target uuid;
  v_rl int;
begin
  if not exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if p_cat is null or not (p_cat = any (public.olnu_cer_cats())) then raise exception 'invalid_cat'; end if;
  v_st := public.olnu_cer_json(p_group_id, v_uid, false);
  if v_st->>'phase' = 'done' then raise exception 'ceremony_done'; end if;
  if v_st->>'phase' <> 'open' then raise exception 'not_open'; end if;
  if not coalesce((v_st->>'eligible')::boolean, false) then raise exception 'not_out'; end if;
  select o.user_id into v_target from public.olnu_cer_out(p_group_id, v_night) o
   where public.olnu_cer_k(p_group_id, o.user_id) = p_k limit 1;
  if v_target is null then raise exception 'invalid_member'; end if;
  if v_target = v_uid then raise exception 'self_vote'; end if;
  insert into public.cer_rl as c (group_id, night, user_id, n) values (p_group_id, v_night, v_uid, 1)
    on conflict (group_id, night, user_id) do update set n = c.n + 1
    returning c.n into v_rl;
  if v_rl > 120 then raise exception 'slow_down'; end if;
  insert into public.cer_votes as v (group_id, night, voter, cat, target)
  values (p_group_id, v_night, v_uid, p_cat, v_target)
  on conflict (group_id, night, voter, cat) do update set target = excluded.target, updated_at = now();
  return public.olnu_cer_json(p_group_id, v_uid, true);
end;
$function$;
