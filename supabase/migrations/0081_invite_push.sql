-- Öl Nu — 📨 invite pushes: atomic claims for notify-group (service_role only). Additive.
-- invite      : the invitees a sender added and that were not pushed yet (notified=false → true).
-- invite_yes  : creator push "✅ Lisa kommer", max 1 per 10 min per invite (yes_push_at claim); the yeses that
--               came in meanwhile ride along in the next one (cron flushes them via invite_yes_due).
-- invite_due  : "⏰ Om 1 timme" once per invite (reminded_at claim), starts in 50–70 min. Called by the cron
--               (GitHub Actions → notify-group with the service key) and by participants' apps as a fallback.

create or replace function public.invite_push_claim(p_id bigint, p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  i public.invites;
  v_to uuid[];
begin
  select * into i from public.invites x where x.id = p_id and x.status = 'open' and x.ends_at > now();
  if not found then return null; end if;
  if not exists (select 1 from public.invite_people p where p.invite_id = p_id and p.user_id = p_uid) then return null; end if;
  with c as (
    update public.invite_people p set notified = true
     where p.invite_id = p_id and p.invited_by = p_uid and p.notified = false and p.user_id <> p_uid
    returning p.user_id
  ) select coalesce(array_agg(c.user_id), '{}'::uuid[]) into v_to from c;
  return jsonb_build_object('id', i.id, 'title', i.title, 'kind', i.kind, 'place', i.place, 'starts_at', i.starts_at,
    'from_name', coalesce(public.olnu_friend_name(p_uid), 'En kompis'), 'to', to_jsonb(v_to));
end; $$;

create or replace function public.invite_yes_claim(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  i public.invites;
  v_names jsonb;
  v_yes int;
begin
  update public.invites x set yes_push_at = now()
   where x.id = p_id and x.status = 'open' and x.ends_at > now()
     and (x.yes_push_at is null or x.yes_push_at < now() - interval '10 minutes')
     and exists (select 1 from public.invite_people p where p.invite_id = x.id and p.answer = 'yes'
                   and p.yes_pushed = false and p.user_id <> x.creator)
  returning * into i;
  if not found then return null; end if;
  with c as (
    update public.invite_people p set yes_pushed = true
     where p.invite_id = p_id and p.answer = 'yes' and p.yes_pushed = false and p.user_id <> i.creator
    returning p.user_id, p.answered_at
  ) select coalesce(jsonb_agg(coalesce(public.olnu_friend_name(c.user_id), '?') order by c.answered_at), '[]'::jsonb) into v_names from c;
  select count(*) into v_yes from public.invite_people p where p.invite_id = p_id and p.answer = 'yes';
  return jsonb_build_object('id', i.id, 'title', i.title, 'place', i.place, 'starts_at', i.starts_at,
    'creator', i.creator, 'names', v_names, 'yes', v_yes);
end; $$;

-- Invites with yeses that waited for the 10 min window (cron flush).
create or replace function public.invite_yes_due()
returns setof bigint language sql security definer set search_path = public as $$
  select x.id from public.invites x
   where x.status = 'open' and x.ends_at > now() and x.created_at > now() - interval '31 days'
     and x.yes_push_at is not null and x.yes_push_at < now() - interval '10 minutes'
     and exists (select 1 from public.invite_people p where p.invite_id = x.id and p.answer = 'yes'
                   and p.yes_pushed = false and p.user_id <> x.creator)
   limit 50;
$$;

-- Claim due reminders. p_id null = every due invite (cron); else only that one, and only when p_uid is in it.
create or replace function public.invite_due_claim(p_id bigint default null, p_uid uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
begin
  if p_id is not null and (p_uid is null or not exists (
       select 1 from public.invite_people p where p.invite_id = p_id and p.user_id = p_uid)) then
    return '[]'::jsonb;
  end if;
  with c as (
    update public.invites x set reminded_at = now()
     where x.status = 'open' and x.reminded_at is null
       and x.starts_at between now() + interval '50 minutes' and now() + interval '70 minutes'
       and (p_id is null or x.id = p_id)
    returning x.id, x.title, x.place, x.starts_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'place', c.place, 'starts_at', c.starts_at,
           'yes', (select count(*) from public.invite_people p where p.invite_id = c.id and p.answer = 'yes'),
           'maybe', (select count(*) from public.invite_people p where p.invite_id = c.id and p.answer = 'maybe'),
           'to', (select coalesce(jsonb_agg(p.user_id), '[]'::jsonb) from public.invite_people p
                   where p.invite_id = c.id and p.answer in ('yes', 'maybe')))), '[]'::jsonb)
    into v from c;
  return v;
end; $$;

do $$
declare
  v_fns text := 'public.invite_push_claim(bigint, uuid), public.invite_yes_claim(bigint), public.invite_yes_due(), '
    || 'public.invite_due_claim(bigint, uuid)';
begin
  execute 'revoke all on function ' || v_fns || ' from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function ' || v_fns || ' from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function ' || v_fns || ' from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function ' || v_fns || ' to service_role'; end if;
end $$;
