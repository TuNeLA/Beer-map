-- public.olnu_medal_msg_tg()
-- live md5(pg_get_functiondef) = b9d962622b0853baf2330ff0edca6a1b
CREATE OR REPLACE FUNCTION public.olnu_medal_msg_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if public.olnu_dm_is(new.group_id) then return new; end if;
    insert into public.medal_counts as c (user_id, msgs) values (new.user_id, 1)
    on conflict (user_id) do update set msgs = c.msgs + 1;
  exception when others then
    null;
  end;
  return new;
end; $function$;
