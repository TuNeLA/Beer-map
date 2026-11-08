-- public.my_invites()
-- live md5(pg_get_functiondef) = ef67c8aacfbf89204867805face202f0
CREATE OR REPLACE FUNCTION public.my_invites()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object('v', 1, 'now', now(), 'invites', coalesce((
    select jsonb_agg(public.olnu_inv_json(x.id, v_uid, false) order by x.starts_at)
      from (select i.id, i.starts_at from public.invites i
              join public.invite_people p on p.invite_id = i.id and p.user_id = v_uid
             where i.ends_at > now() and (i.status = 'open' or i.updated_at > now() - interval '12 hours')
             order by i.starts_at limit 30) x), '[]'::jsonb));
end; $function$;
