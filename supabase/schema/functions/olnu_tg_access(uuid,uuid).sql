-- public.olnu_tg_access(p_gid uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = b0d474f2a0aa8a3e07bcccb4fb236e53
CREATE OR REPLACE FUNCTION public.olnu_tg_access(p_gid uuid, p_uid uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t public.temp_groups;
  v_a text;
  v_st text;
begin
  select * into t from public.temp_groups x where x.group_id = p_gid;
  if not found then return null; end if;
  if p_uid is null then return 'none'; end if;
  select p.answer into v_a from public.invite_people p where p.invite_id = t.invite_id and p.user_id = p_uid;
  if v_a is null or now() >= t.hide_at then return 'none'; end if;
  select i.status into v_st from public.invites i where i.id = t.invite_id;
  if t.closed_at is not null or coalesce(v_st, 'cancelled') <> 'open' or now() >= t.open_until then return 'read'; end if;
  return case when v_a in ('yes', 'maybe') then 'write' else 'read' end;
end; $function$;
