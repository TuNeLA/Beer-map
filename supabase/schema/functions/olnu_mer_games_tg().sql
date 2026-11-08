-- public.olnu_mer_games_tg()
-- live md5(pg_get_functiondef) = e6272c71a09171fb51c70937c266823e
CREATE OR REPLACE FUNCTION public.olnu_mer_games_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_u uuid;
begin
  begin
    if tg_table_name = 'game_missions' then
      if new.done_at is not null and (tg_op = 'INSERT' or old.done_at is null) then
        perform public.olnu_mer_add(new.user_id, new.night, 'game', 'm' || new.slot::text, 3, 9);
      end if;
    elsif tg_table_name = 'game_bingo_cards' then
      if new.bingo_at is not null and (tg_op = 'INSERT' or old.bingo_at is null) then
        for v_u in select distinct t.user_id from public.game_bingo_ticks t
                    where t.group_id = new.group_id and t.night = new.night and t.ticked loop
          perform public.olnu_mer_add(v_u, new.night, 'game', 'b:' || new.group_id::text, 3, 9);
        end loop;
      end if;
    elsif tg_table_name = 'game_oracles' then
      perform public.olnu_mer_add(new.user_id, new.night, 'game', 'o:' || new.group_id::text, 3, 9);
    end if;
  exception when others then
    null;
  end;
  return null;
end; $function$;
