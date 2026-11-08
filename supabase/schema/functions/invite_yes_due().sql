-- public.invite_yes_due()
-- live md5(pg_get_functiondef) = 508d676a84c3afc8e261e1d1dde2c461
CREATE OR REPLACE FUNCTION public.invite_yes_due()
 RETURNS SETOF bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select x.id from public.invites x
   where x.status = 'open' and x.ends_at > now() and x.created_at > now() - interval '31 days'
     and x.yes_push_at is not null and x.yes_push_at < now() - interval '10 minutes'
     and exists (select 1 from public.invite_people p where p.invite_id = x.id and p.answer = 'yes'
                   and p.yes_pushed = false and p.user_id <> x.creator)
   limit 50;
$function$;
