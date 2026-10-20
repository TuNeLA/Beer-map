-- Öl Nu — meriter `invite_show` (CONTRACT v26 ledger, 0036 olnu_mer_add): +3 when you said ✅ Kommer and then
-- showed up (a check-in at the invite's bar, or a check-in / precise drink within 150 m of the invite spot) within
-- ±2 h of the start. Max 2 per night (cap 6). Ref = 'inv:<id>' (once per invite). Additive; triggers catch
-- their own errors so a check-in or a beer never fails because of this.

create or replace function public.olnu_inv_show(p_uid uuid, p_night timestamptz, p_lat double precision, p_lng double precision,
                                                p_bar text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if p_uid is null or p_night is null then return; end if;
  for r in
    select i.id from public.invite_people p join public.invites i on i.id = p.invite_id
     where p.user_id = p_uid and p.answer = 'yes' and i.status = 'open'
       and now() between i.starts_at - interval '2 hours' and i.starts_at + interval '2 hours'
       and ((p_bar is not null and i.bar_id = p_bar)
            or (p_lat is not null and i.lat is not null
                and power((i.lat - p_lat) * 111195, 2) + power((i.lng - p_lng) * 111195 * cos(radians(p_lat)), 2) <= 22500))
     limit 3
  loop
    perform public.olnu_mer_add(p_uid, p_night, 'invite_show', 'inv:' || r.id::text, 3, 6);
  end loop;
end; $$;

create or replace function public.olnu_mer_inv_ci_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'UPDATE' and old.created_at = new.created_at and old.bar_id = new.bar_id then return null; end if;
    if new.expires_at <= now() or (new.lat = 0 and new.lng = 0) then return null; end if;
    perform public.olnu_inv_show(new.user_id, new.expires_at, new.lat, new.lng, new.bar_id);
  exception when others then null;
  end;
  return null;
end; $$;
create or replace trigger olnu_zz_mer_inv_ci after insert or update on public.checkins
  for each row execute function public.olnu_mer_inv_ci_tg();

create or replace function public.olnu_mer_inv_beer_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old int := 0; v_new int;
begin
  begin
    v_new := new.beer_count + coalesce(new.other_count, 0);
    if tg_op = 'UPDATE' and old.expires_at = new.expires_at then v_old := old.beer_count + coalesce(old.other_count, 0); end if;
    if v_new > v_old and new.expires_at > now() and new.precise and not coalesce(new.ghost, false) and not coalesce(new.stopped, false) then
      perform public.olnu_inv_show(new.user_id, new.expires_at, new.lat, new.lng, new.snap_bar);
    end if;
  exception when others then null;
  end;
  return null;
end; $$;
create or replace trigger olnu_zz_mer_inv_beer after insert or update on public.beers
  for each row execute function public.olnu_mer_inv_beer_tg();

revoke all on function public.olnu_inv_show(uuid, timestamptz, double precision, double precision, text) from public, anon, authenticated;
revoke all on function public.olnu_mer_inv_ci_tg() from public, anon, authenticated;
revoke all on function public.olnu_mer_inv_beer_tg() from public, anon, authenticated;
