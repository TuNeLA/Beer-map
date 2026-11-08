-- public.olnu_tg_ans()
-- live md5(pg_get_functiondef) = e5ff506bdb690ee8e61935c68551f4eb
CREATE OR REPLACE FUNCTION public.olnu_tg_ans()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_g uuid;
begin
  if new.answer in ('yes', 'maybe') and new.answer is distinct from old.answer then
    begin
      select t.group_id into v_g from public.temp_groups t
       where t.invite_id = new.invite_id and t.closed_at is null and now() < t.open_until;
      if v_g is not null then
        insert into public.temp_group_said (group_id, user_id, kind) values (v_g, new.user_id, new.answer)
        on conflict do nothing;
        if found then perform public.olnu_tg_say(v_g, new.user_id, new.answer); end if;
      end if;
    exception when others then
      raise warning 'olnu_tg_ans: %', sqlerrm;
    end;
  end if;
  return null;
end; $function$;
