-- public.invite_push_claim(p_id bigint, p_uid uuid)
-- live md5(pg_get_functiondef) = f12b9b19c4877d25e0fb85a0f9d4de75
CREATE OR REPLACE FUNCTION public.invite_push_claim(p_id bigint, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  i public.invites;
  v_to uuid[];
begin
  select * into i from public.invites x where x.id = p_id and x.status = 'open' and x.ends_at > now();
  if not found then return null; end if;
  if not exists (select 1 from public.invite_people p where p.invite_id = p_id and p.user_id = p_uid) then return null; end if;
  with c as (
    update public.invite_people p set notified = true
     where p.invite_id = p_id and p.invited_by = p_uid and p.notified = false and p.user_id <> p_uid
    returning p.user_id
  ) select coalesce(array_agg(c.user_id), '{}'::uuid[]) into v_to from c;
  return jsonb_build_object('id', i.id, 'title', i.title, 'kind', i.kind, 'place', i.place, 'starts_at', i.starts_at,
    'from_name', coalesce(public.olnu_friend_name(p_uid), 'En kompis'), 'to', to_jsonb(v_to));
end; $function$;
