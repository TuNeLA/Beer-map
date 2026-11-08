-- public.invite_yes_claim(p_id bigint)
-- live md5(pg_get_functiondef) = 3752da3562f71609852d036e7da428b6
CREATE OR REPLACE FUNCTION public.invite_yes_claim(p_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  i public.invites;
  v_names jsonb;
  v_yes int;
begin
  update public.invites x set yes_push_at = now()
   where x.id = p_id and x.status = 'open' and x.ends_at > now()
     and (x.yes_push_at is null or x.yes_push_at < now() - interval '10 minutes')
     and exists (select 1 from public.invite_people p where p.invite_id = x.id and p.answer = 'yes'
                   and p.yes_pushed = false and p.user_id <> x.creator)
  returning * into i;
  if not found then return null; end if;
  with c as (
    update public.invite_people p set yes_pushed = true
     where p.invite_id = p_id and p.answer = 'yes' and p.yes_pushed = false and p.user_id <> i.creator
    returning p.user_id, p.answered_at
  ) select coalesce(jsonb_agg(coalesce(public.olnu_friend_name(c.user_id), '?') order by c.answered_at), '[]'::jsonb) into v_names from c;
  select count(*) into v_yes from public.invite_people p where p.invite_id = p_id and p.answer = 'yes';
  return jsonb_build_object('id', i.id, 'title', i.title, 'place', i.place, 'starts_at', i.starts_at,
    'creator', i.creator, 'names', v_names, 'yes', v_yes);
end; $function$;
