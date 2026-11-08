-- public.invite_due_claim(p_id bigint, p_uid uuid)
-- live md5(pg_get_functiondef) = 7e7e9aca1c514ee2ce67d7c10f596409
CREATE OR REPLACE FUNCTION public.invite_due_claim(p_id bigint DEFAULT NULL::bigint, p_uid uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v jsonb;
begin
  if p_id is not null and (p_uid is null or not exists (
       select 1 from public.invite_people p where p.invite_id = p_id and p.user_id = p_uid)) then
    return '[]'::jsonb;
  end if;
  with c as (
    update public.invites x set reminded_at = now()
     where x.status = 'open' and x.reminded_at is null
       and x.starts_at between now() + interval '50 minutes' and now() + interval '70 minutes'
       and (p_id is null or x.id = p_id)
    returning x.id, x.title, x.place, x.starts_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'place', c.place, 'starts_at', c.starts_at,
           'yes', (select count(*) from public.invite_people p where p.invite_id = c.id and p.answer = 'yes'),
           'maybe', (select count(*) from public.invite_people p where p.invite_id = c.id and p.answer = 'maybe'),
           'to', (select coalesce(jsonb_agg(p.user_id), '[]'::jsonb) from public.invite_people p
                   where p.invite_id = c.id and p.answer in ('yes', 'maybe')))), '[]'::jsonb)
    into v from c;
  return v;
end; $function$;
