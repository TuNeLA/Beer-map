-- public.invite_answer(p_id bigint, p_answer text)
-- live md5(pg_get_functiondef) = 68947c241d2ce8a2fd550bebe0734737
CREATE OR REPLACE FUNCTION public.invite_answer(p_id bigint, p_answer text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_a text := lower(coalesce(p_answer, ''));
  v_old text;
  i public.invites;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_a not in ('yes', 'maybe', 'no') then raise exception 'invalid_answer'; end if;
  select * into i from public.invites x where x.id = p_id;
  select p.answer into v_old from public.invite_people p where p.invite_id = p_id and p.user_id = v_uid;
  if i.id is null or v_old is null then raise exception 'invite_not_found'; end if;
  if i.status <> 'open' or i.ends_at <= now() then raise exception 'invite_over'; end if;
  update public.invite_people p set answer = v_a, answered_at = now(),
         yes_pushed = case when v_a = 'yes' and v_old <> 'yes' then false else p.yes_pushed end
   where p.invite_id = p_id and p.user_id = v_uid;
  update public.invites set updated_at = now() where id = p_id;
  return public.olnu_inv_json(p_id, v_uid, true)
    || jsonb_build_object('push_yes', v_a = 'yes' and v_old <> 'yes' and v_uid <> i.creator);
end; $function$;
