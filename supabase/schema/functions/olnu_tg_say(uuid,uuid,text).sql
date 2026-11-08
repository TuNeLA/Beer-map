-- public.olnu_tg_say(p_gid uuid, p_uid uuid, p_kind text)
-- live md5(pg_get_functiondef) = 3ad91267f5b37543436a4e05798c2ef6
CREATE OR REPLACE FUNCTION public.olnu_tg_say(p_gid uuid, p_uid uuid, p_kind text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_l text[] := public.olnu_tg_lines(p_kind);
  v_at timestamptz;
  v_body text;
begin
  select i.starts_at into v_at from public.temp_groups t join public.invites i on i.id = t.invite_id where t.group_id = p_gid;
  if v_at is null or p_uid is null then return; end if;
  v_body := chr(8291) || replace(v_l[1 + floor(random() * array_length(v_l, 1))::int], '{namn}',
                                 coalesce(left(public.olnu_friend_name(p_uid), 24), 'Nån'));
  insert into public.group_msgs (group_id, user_id, body, expires_at)
  values (p_gid, p_uid, left(v_body, 140), greatest(public.olnu_next_expiry(), public.olnu_tg_night_end(v_at)));
end; $function$;
