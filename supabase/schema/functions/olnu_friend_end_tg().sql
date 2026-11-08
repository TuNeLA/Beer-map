-- public.olnu_friend_end_tg()
-- live md5(pg_get_functiondef) = 55bf7283e4716d61d0e1fa6b9407a949
CREATE OR REPLACE FUNCTION public.olnu_friend_end_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.status = 'accepted' and new.status <> 'accepted' then
    update public.find_reqs r
       set status = case when r.status = 'pending' then 'cancelled' else r.status end,
           answer_by = least(r.answer_by, now()),
           until = case when r.until is null then null else least(r.until, now()) end
     where r.friendship_id = new.id
       and (r.answer_by > now() or r.until > now());
    update public.find_pos fp
       set expires_at = least(fp.expires_at, now())
     where ((fp.user_id = new.a and fp.target_uid = new.b) or (fp.user_id = new.b and fp.target_uid = new.a))
       and fp.expires_at > now();
  end if;
  return new;
end $function$;
