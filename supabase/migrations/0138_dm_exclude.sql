-- Öl Nu — 💬 PRIVATA MEDDELANDEN part 3: DMs never count for duels, meriter, medals or gang missions.
-- Re-created from the deployed versions (2026-10-22) with ONE change each: a row in a DM group (0136 olnu_dm_is)
-- is skipped. Same names, signatures and results. Group chats and event chats are unchanged. Needs 0136.

create or replace function public.olnu_duel_photo_tg()
returns trigger language plpgsql security definer set search_path = public as $function$
begin
  begin
    if public.olnu_dm_is(new.group_id) then return new; end if;
    insert into public.duel_log (user_id, kind, n) values (new.user_id, 'photo', 1);
  exception when others then null;
  end;
  return new;
end; $function$;

create or replace function public.olnu_mer_photo_tg()
returns trigger language plpgsql security definer set search_path = public as $function$
begin
  begin
    if public.olnu_dm_is(new.group_id) then return null; end if;
    if new.msg_id is not null and exists (select 1 from public.group_msgs m where m.id = new.msg_id
                                            and m.body like '📷 🎖️ Lägesrapport%') then
      return null;
    end if;
    perform public.olnu_mer_add(new.user_id, public.olnu_night_of(new.created_at), 'photo', new.id::text, 2, 10);
  exception when others then
    null;
  end;
  return null;
end; $function$;

create or replace function public.olnu_medal_msg_tg()
returns trigger language plpgsql security definer set search_path = public as $function$
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

create or replace function public.olnu_g_progress(p_uid uuid, p_night timestamp with time zone, p_kind text, p_now timestamp with time zone)
returns integer language plpgsql stable security definer set search_path = public as $function$
declare
  v      int := 0;
  v_from timestamptz := p_night - interval '30 hours';
  v_eve  timestamp := public.olnu_evening(p_night)::timestamp;
  v_beers int; v_others int; v_first timestamptz; v_home timestamptz;
begin
  begin
    if p_kind = 'checkin_bars' then
      select count(distinct c.bar_id) into v from public.medal_checkins c where c.user_id = p_uid and c.night = p_night;
    elsif p_kind = 'skal_give' then
      select count(*) into v from public.skals s
       where s.user_id = p_uid and s.created_at > v_from and public.olnu_night_of(s.created_at) = p_night;
    elsif p_kind = 'skal_get' then
      select count(distinct s.user_id) into v from public.skals s join public.beers b on b.id = s.beer_id
       where b.user_id = p_uid and b.expires_at = p_night and s.user_id <> p_uid;
    elsif p_kind = 'chat' then
      select count(*) into v from public.group_msgs m
       where m.user_id = p_uid and m.created_at > v_from and public.olnu_night_of(m.created_at) = p_night
         and not exists (select 1 from public.dm_threads d where d.group_id = m.group_id);
    elsif p_kind = 'rally_yes' then
      select count(*) into v from public.rally_answers a join public.rallies r on r.id = a.rally_id
       where a.user_id = p_uid and a.answer = 'yes' and r.user_id <> p_uid and r.expires_at = p_night;
    elsif p_kind = 'group_out' then
      select coalesce(max(x.n), 0) into v from (
        select gm.group_id, count(*) filter (where public.olnu_g_live(o.user_id, p_night, p_now)) as n
          from public.group_members gm join public.group_members o on o.group_id = gm.group_id
         where gm.user_id = p_uid
         group by gm.group_id) x;
    elsif p_kind = 'water' then
      select coalesce(max(f.water), 0) into v from public.game_facts f where f.user_id = p_uid and f.night = p_night;
    elsif p_kind = 'beer_type' then
      select count(distinct t.type) into v from public.beer_types t
       where t.user_id = p_uid and t.night = p_night and t.type <> 'annan';
    elsif p_kind = 'queue_report' then
      select count(*) into v from public.bar_queue q
       where q.user_id = p_uid and q.created_at > v_from and public.olnu_night_of(q.created_at) = p_night;
    elsif p_kind = 'tip' then
      select count(*) into v from public.bar_tips t
       where t.user_id = p_uid and t.created_at > v_from and public.olnu_night_of(t.created_at) = p_night;
    elsif p_kind in ('home', 'early', 'other_none') then
      select mn.beers, mn.others, mn.first_at into v_beers, v_others, v_first
        from public.medal_nights mn where mn.user_id = p_uid and mn.night = p_night;
      select f.home_at into v_home from public.game_facts f where f.user_id = p_uid and f.night = p_night;
      if p_kind = 'home' then
        if coalesce(v_beers, 0) >= 1 and v_first is not null and v_home is not null and v_home >= v_first
           and (v_home at time zone 'Europe/Stockholm') < (p_night at time zone 'Europe/Stockholm') - interval '3 hours' then
          v := 1;
        end if;
      elsif p_kind = 'early' then
        if coalesce(v_beers, 0) >= 1 and v_first is not null
           and (v_first at time zone 'Europe/Stockholm') < v_eve + interval '20 hours' then
          v := 1;
        end if;
      else
        if coalesce(v_beers, 0) >= 1 and coalesce(v_others, 0) = 0
           and ((p_now at time zone 'Europe/Stockholm') >= v_eve + interval '23 hours' or v_home is not null) then
          v := 1;
        end if;
      end if;
    end if;
  exception when others then
    v := 0;
  end;
  return coalesce(v, 0);
end;
$function$;
