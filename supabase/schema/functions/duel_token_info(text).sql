-- public.duel_token_info(p_token text)
-- live md5(pg_get_functiondef) = ca4f002258e62eaf1eb36ea9938f12fb
CREATE OR REPLACE FUNCTION public.duel_token_info(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  t public.duel_tokens;
begin
  select * into t from public.duel_tokens x where x.token = upper(btrim(coalesce(p_token, ''))) and x.expires_at > now();
  if not found then raise exception 'token_not_found'; end if;
  return jsonb_build_object(
    'group_name', (select g.name from public.groups g where g.id = t.group_id),
    'members', (select count(*) from public.group_members m where m.group_id = t.group_id)::int,
    'expires_at', t.expires_at,
    'mine', public.olnu_wd_member(t.group_id, v_uid),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name,
                'state', case when g.id = t.group_id then 'same'
                              when public.olnu_duel_pair(g.id, t.group_id) is not null then 'dueling'
                              when public.olnu_duel_open_n(g.id) >= 10 then 'full' else 'ok' end) order by m.joined_at)
              from public.group_members m join public.groups g on g.id = m.group_id where m.user_id = v_uid), '[]'::jsonb));
end; $function$;
