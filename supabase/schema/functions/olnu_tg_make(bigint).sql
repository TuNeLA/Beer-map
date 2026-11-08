-- public.olnu_tg_make(p_invite bigint)
-- live md5(pg_get_functiondef) = 8e30fbfeefdab6bc02afee53c90fd68c
CREATE OR REPLACE FUNCTION public.olnu_tg_make(p_invite bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  i public.invites;
  v_id uuid;
  v_code text;
  v_try int := 0;
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  select * into i from public.invites x where x.id = p_invite;
  if not found then return null; end if;
  select t.group_id into v_id from public.temp_groups t where t.invite_id = p_invite;
  if v_id is not null then return v_id; end if;
  loop
    v_try := v_try + 1;
    v_code := '';
    for k in 1..6 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random() * 32)::int, 1);
    end loop;
    insert into public.groups (name, code, created_by)
    values (public.olnu_tg_name(i.title, i.starts_at), v_code, null)
    on conflict (code) do nothing
    returning id into v_id;
    exit when v_id is not null;
    if v_try >= 20 then return null; end if;
  end loop;
  insert into public.temp_groups (group_id, invite_id, creator, open_until, hide_at, closed_at)
  values (v_id, i.id, i.creator, i.starts_at + interval '12 hours', i.starts_at + interval '12 hours' + interval '7 days',
          case when i.status <> 'open' then now() end);
  return v_id;
end; $function$;
