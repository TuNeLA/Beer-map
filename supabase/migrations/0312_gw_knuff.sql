-- 0312 👋 KNUFF (competitor research idea 6, Zenly / Bump). Additive only.
-- A gentle nudge to a friend who is out: from the friend's pin sheet. 1 per pair per 30 min, max 20 sent per hour.
-- Only to a friend or a group-mate (shared group), never when one of you blocked the other, only to a live, visible pin.
--   knuff_send(p_beer_id)          → {ok, id} | {ok:false, why:'slow_down', wait_s} (authenticated)
--                                    errors: not_authenticated, beer_not_found, not_friends, blocked
--   knuff_inbox()                  → [{id, name, at}] unseen nudges to me (last 2 h); marks them seen (authenticated)
--   knuff_push_claim(p_id, p_from) → {to, name} once per knuff, < 5 min old (service_role; notify-group {event:"knuff"})
-- The in-app toast (knuff_inbox on the app poll) works without the push. No row is ever removed here. Safe to run again.

create table if not exists public.gw_knuffs (
  id         bigserial primary key,
  from_uid   uuid not null,
  to_uid     uuid not null,
  beer_id    bigint,
  created_at timestamptz not null default now(),
  seen_at    timestamptz,
  pushed     boolean not null default false
);
create index if not exists gw_knuffs_pair on public.gw_knuffs (from_uid, to_uid, created_at desc);
create index if not exists gw_knuffs_to on public.gw_knuffs (to_uid, created_at desc);
alter table public.gw_knuffs enable row level security;
revoke all on table public.gw_knuffs from public, anon, authenticated;

create or replace function public.olnu_gw_mates(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_a is not null and p_b is not null and p_a <> p_b and (
    public.olnu_are_friends(p_a, p_b)
    or exists (select 1 from public.group_members x join public.group_members y on y.group_id = x.group_id
                where x.user_id = p_a and y.user_id = p_b and not public.olnu_is_temp_group(x.group_id)));
$$;

-- The name the receiver knows the sender by: friend name, else the name in a shared group.
create or replace function public.olnu_gw_name_for(p_who uuid, p_viewer uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select m.display_name from public.group_members m join public.group_members v on v.group_id = m.group_id
      where m.user_id = p_who and v.user_id = p_viewer and nullif(btrim(m.display_name), '') is not null
      order by m.joined_at limit 1),
    nullif(btrim(public.olnu_friend_name(p_who)), ''), 'En kompis');
$$;

create or replace function public.knuff_send(p_beer_id bigint)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare
  v_uid uuid := public.olnu_uid(); v_to uuid; v_last timestamptz; v_id bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select b.user_id into v_to from public.beers b
   where b.id = p_beer_id and b.expires_at > now() and not coalesce(b.stopped, false) and not coalesce(b.ghost, false);
  if v_to is null or v_to = v_uid then raise exception 'beer_not_found'; end if;
  if not public.olnu_gw_mates(v_uid, v_to) then raise exception 'not_friends'; end if;
  if public.olnu_dm_blocked(v_uid, v_to) then raise exception 'blocked'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-knuff:' || v_uid::text, 0));
  select max(k.created_at) into v_last from public.gw_knuffs k
   where k.from_uid = v_uid and k.to_uid = v_to and k.created_at > now() - interval '30 minutes';
  if v_last is not null then
    return jsonb_build_object('ok', false, 'why', 'slow_down',
      'wait_s', greatest(1, ceil(extract(epoch from (v_last + interval '30 minutes' - now()))))::int);
  end if;
  if (select count(*) from public.gw_knuffs k where k.from_uid = v_uid and k.created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('ok', false, 'why', 'slow_down', 'wait_s', 600);
  end if;
  insert into public.gw_knuffs (from_uid, to_uid, beer_id) values (v_uid, v_to, p_beer_id) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.knuff_inbox()
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); v jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  with x as (
    update public.gw_knuffs k set seen_at = now()
     where k.to_uid = v_uid and k.seen_at is null and k.created_at > now() - interval '2 hours'
       and not public.olnu_dm_blocked(k.from_uid, v_uid)
    returning k.id, k.from_uid, k.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', public.olnu_card_first(public.olnu_gw_name_for(x.from_uid, v_uid)),
           'at', x.created_at) order by x.created_at), '[]'::jsonb) into v from x;
  return v;
end $$;

create or replace function public.knuff_push_claim(p_id bigint, p_from uuid)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare v_to uuid;
begin
  update public.gw_knuffs k set pushed = true
   where k.id = p_id and k.from_uid = p_from and not k.pushed and k.created_at > now() - interval '5 minutes'
  returning k.to_uid into v_to;
  if v_to is null then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'to', v_to, 'name', public.olnu_card_first(public.olnu_gw_name_for(p_from, v_to)));
end $$;

revoke all on function public.olnu_gw_mates(uuid, uuid) from public, anon, authenticated;
revoke all on function public.olnu_gw_name_for(uuid, uuid) from public, anon, authenticated;
revoke all on function public.knuff_send(bigint) from public, anon;
revoke all on function public.knuff_inbox() from public, anon;
revoke all on function public.knuff_push_claim(bigint, uuid) from public, anon, authenticated;
grant execute on function public.knuff_send(bigint) to authenticated;
grant execute on function public.knuff_inbox() to authenticated;
grant execute on function public.knuff_push_claim(bigint, uuid) to service_role;
