-- public.film_react(p_photo_id bigint, p_emoji text)
-- live md5(pg_get_functiondef) = 5ab27dfc97e18d6207b76203c234c4cf
CREATE OR REPLACE FUNCTION public.film_react(p_photo_id bigint, p_emoji text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_row public.snap_photos;
  v_cur public.film_reacts;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_row from public.snap_photos sp
   where sp.id = p_photo_id and sp.kind = 'film' and sp.reveal_at <= now() and sp.bytes is not null and sp.expires_at > now();
  if not found then raise exception 'photo_not_found'; end if;
  if not exists (select 1 from public.group_members m where m.group_id = v_row.group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if p_emoji is null or not (p_emoji = any (public.olnu_film_emojis())) then raise exception 'invalid_emoji'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_film_r:' || v_uid::text, 0));
  if (select count(*) from public.film_reacts r where r.user_id = v_uid and r.updated_at > now() - interval '1 minute') >= 60 then
    raise exception 'slow_down';
  end if;
  select * into v_cur from public.film_reacts r where r.photo_id = p_photo_id and r.user_id = v_uid;
  if found and v_cur.active and v_cur.emoji = p_emoji then
    update public.film_reacts r set active = false, updated_at = now() where r.photo_id = p_photo_id and r.user_id = v_uid;
  else
    insert into public.film_reacts as r (photo_id, user_id, emoji, active, updated_at)
    values (p_photo_id, v_uid, p_emoji, true, now())
    on conflict (photo_id, user_id) do update set emoji = p_emoji, active = true, updated_at = now();
  end if;
  return public.olnu_film_photo_json(v_row, v_uid);
end; $function$;
