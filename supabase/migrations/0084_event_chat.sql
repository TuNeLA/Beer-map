-- Öl Nu — 💬 EVENTCHATT (CONTRACT "v29 EVENTCHATT"). Additive only. Safe to run again.
-- Every invite (0080) gets a TEMPORARY GROUP: a `groups` row (name = invite title + day, created_by NULL so it is
-- never counted by the create_group limit) plus a `temp_groups` row. Nobody is ever put in group_members for it,
-- so it is invisible to everything that works on group membership (my_groups, friend lists, pins, duels, leagues,
-- boards, meriter, crew, gang ...). Chat access comes from invite_people instead (olnu_tg_access):
--   creator + ✅ yes + 🤔 maybe = write; invited without answer / ❌ no = read; after start + 12 h or a cancel = read
--   ("Arkiverad" / "inställt"); after start + 12 h + 7 d = no access, hidden from lists. Rows are never removed.
-- The chat RPCs (0085) accept group members OR this access. A BEFORE INSERT guard on group_members refuses
-- temp groups, so their 6-letter code can never be used to join.
-- System lines are group_msgs rows whose body starts with U+2063 (invisible separator); post_group_msg (0085)
-- strips that character from user text, so nobody can fake one.
-- Needs 0001 (groups, group_msgs, olnu_uid, olnu_next_expiry), 0045 (olnu_friend_name), 0080/0081 (invites).

create table if not exists public.temp_groups (
  group_id   uuid primary key references public.groups (id),
  invite_id  bigint not null unique references public.invites (id),
  creator    uuid not null,
  open_until timestamptz not null,           -- writable until start + 12 h
  hide_at    timestamptz not null,           -- read-only "Arkiverad" until then (open_until + 7 d), then hidden
  closed_at  timestamptz,                    -- invite cancelled -> read-only at once
  created_at timestamptz not null default now()
);
create index if not exists temp_groups_hide_idx on public.temp_groups (hide_at);

-- One answer line per person and kind (yes / maybe), so answer flipping cannot spam the chat.
create table if not exists public.temp_group_said (
  group_id uuid not null,
  user_id  uuid not null,
  kind     text not null,
  at       timestamptz not null default now(),
  primary key (group_id, user_id, kind)
);

alter table public.temp_groups enable row level security;
alter table public.temp_group_said enable row level security;
revoke all on public.temp_groups from anon, authenticated;
revoke all on public.temp_group_said from anon, authenticated;
grant all on public.temp_groups, public.temp_group_said to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- "🧠 Pubquiz på Pitchers · tors 22/10" (groups.name is 1–40 chars).
create or replace function public.olnu_tg_name(p_title text, p_at timestamptz)
returns text language sql stable set search_path = public as $$
  with x as (
    select (array['sön', 'mån', 'tis', 'ons', 'tors', 'fre', 'lör'])[extract(dow from p_at at time zone 'Europe/Stockholm')::int + 1]
             || ' ' || to_char(p_at at time zone 'Europe/Stockholm', 'FMDD/FMMM') as d,
           coalesce(nullif(btrim(coalesce(p_title, '')), ''), '📨 Event') as t)
  select case when char_length(t || ' · ' || d) <= 40 then t || ' · ' || d
              else left(t, greatest(1, 40 - char_length(d) - 4)) || '… · ' || d end
    from x;
$$;

-- The 05:00 (Stockholm) that ends the night p_at belongs to.
create or replace function public.olnu_tg_night_end(p_at timestamptz)
returns timestamptz language sql stable set search_path = public as $$
  select case when (p_at at time zone 'Europe/Stockholm') >= date_trunc('day', p_at at time zone 'Europe/Stockholm') + interval '5 hours'
              then (date_trunc('day', p_at at time zone 'Europe/Stockholm') + interval '1 day 5 hours') at time zone 'Europe/Stockholm'
              else (date_trunc('day', p_at at time zone 'Europe/Stockholm') + interval '5 hours') at time zone 'Europe/Stockholm' end;
$$;

-- null = not a temp group; 'none' | 'read' | 'write' for p_uid.
create or replace function public.olnu_tg_access(p_gid uuid, p_uid uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  t public.temp_groups;
  v_a text;
  v_st text;
begin
  select * into t from public.temp_groups x where x.group_id = p_gid;
  if not found then return null; end if;
  if p_uid is null then return 'none'; end if;
  select p.answer into v_a from public.invite_people p where p.invite_id = t.invite_id and p.user_id = p_uid;
  if v_a is null or now() >= t.hide_at then return 'none'; end if;
  select i.status into v_st from public.invites i where i.id = t.invite_id;
  if t.closed_at is not null or coalesce(v_st, 'cancelled') <> 'open' or now() >= t.open_until then return 'read'; end if;
  return case when v_a in ('yes', 'maybe') then 'write' else 'read' end;
end; $$;

-- The ONE membership test of the chat RPCs (0085): a real group member, or temp-group access.
create or replace function public.olnu_chat_can(p_gid uuid, p_uid uuid, p_write boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and (
    exists (select 1 from public.group_members m where m.group_id = p_gid and m.user_id = p_uid)
    or coalesce(public.olnu_tg_access(p_gid, p_uid), 'none') = any (case when p_write then array['write'] else array['read', 'write'] end));
$$;

create or replace function public.olnu_is_temp_group(p_gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.temp_groups t where t.group_id = p_gid);
$$;

-- Make the temp group of an invite (idempotent).
create or replace function public.olnu_tg_make(p_invite bigint)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  i public.invites;
  v_id uuid;
  v_code text;
  v_try int := 0;
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  select * into i from public.invites x where x.id = p_invite;
  if not found then return null; end if;
  select t.group_id into v_id from public.temp_groups t where t.invite_id = p_invite;
  if v_id is not null then return v_id; end if;
  loop
    v_try := v_try + 1;
    v_code := '';
    for k in 1..6 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random() * 32)::int, 1);
    end loop;
    insert into public.groups (name, code, created_by)
    values (public.olnu_tg_name(i.title, i.starts_at), v_code, null)
    on conflict (code) do nothing
    returning id into v_id;
    exit when v_id is not null;
    if v_try >= 20 then return null; end if;
  end loop;
  insert into public.temp_groups (group_id, invite_id, creator, open_until, hide_at, closed_at)
  values (v_id, i.id, i.creator, i.starts_at + interval '12 hours', i.starts_at + interval '12 hours' + interval '7 days',
          case when i.status <> 'open' then now() end);
  return v_id;
end; $$;

-- System lines (dalmål, 10+ each). {namn} = the person.
create or replace function public.olnu_tg_lines(p_kind text)
returns text[] language sql immutable set search_path = public as $$
  select case p_kind
    when 'made' then array[
      '📨 {namn} skapade eventet. Nu ä dä allvar!',
      '📨 {namn} skapade eventet. Generalstaben har talat.',
      '📨 {namn} har blåst till samling. Eventet ä skapat.',
      '📨 {namn} skapade eventet. Putsa kängorna, pojkar och jäntor.',
      '📨 Eventet ä skapat av {namn}. Hä ä bara å tacka ja.',
      '📨 {namn} skapade eventet. Ölguden ä underrättad.',
      '📨 {namn} drog igång eventet. Nu kör vi, int'' sant?',
      '📨 {namn} skapade eventet. Kallelsen ä ute i hela Dalom.',
      '📨 {namn} har skapat eventet. Ordern gäller tills vidare.',
      '📨 {namn} skapade eventet. Den som kommer sist bjuder på bärs.',
      '📨 {namn} skapade eventet. Hä blir gött, dä lovar vi.']
    when 'yes' then array[
      '✅ {namn} kommer! Truppen växer.',
      '✅ {namn} kommer. Hä ä klart som korvspad.',
      '✅ {namn} kommer ✅ Ställ fram ett glas till.',
      '✅ {namn} ä anmäld till tjänstgöring.',
      '✅ {namn} kommer. Nu börjar dä likna nåt!',
      '✅ {namn} kommer – mä kängorna på.',
      '✅ {namn} har sagt ja. Förstärkning på väg.',
      '✅ {namn} kommer. Int'' en chans att hen missar dä här.',
      '✅ {namn} kommer! Skål i förväg.',
      '✅ {namn} kommer. Generalen nickar gillande.',
      '✅ {namn} kommer. Ett streck till i liggaren.']
    when 'maybe' then array[
      '🤔 {namn} kanske. Vi håller en stol varm.',
      '🤔 {namn} kanske 🤔 Ett halvt ja ä oxå ett ja.',
      '🤔 {namn} kanske. Hä lutar åt ja, säger ryktet.',
      '🤔 {namn} funderar. Kanske, kanske int''.',
      '🤔 {namn} kanske. Övertala hen i chatten!',
      '🤔 {namn} ä kanske-med. Generalen väntar.',
      '🤔 {namn} kanske. Vi ställer fram ett glas för säkerhets skull.',
      '🤔 {namn} kanske. Hä avgörs nog vid fjärde ölen.',
      '🤔 {namn} har sagt kanske. Spaning pågår.',
      '🤔 {namn} kanske. Nån får locka mä en bärs.',
      '🤔 {namn} kanske. Stå på dig nu, korpral.']
    when 'soon' then array[
      '⏰ Om 1 timme! Dags att dra på sig kängorna.',
      '⏰ Om 1 timme! Sista chansen att duscha.',
      '⏰ Om 1 timme! Truppen samlas, inga ursäkter.',
      '⏰ Om 1 timme! Ladda telefonen å plånboken.',
      '⏰ Om 1 timme! Hä närmar sig, dä känns i magen.',
      '⏰ Om 1 timme! Ställ klockan, korpral.',
      '⏰ Om 1 timme! Ölen kallnar int'' av sig själv.',
      '⏰ Om 1 timme! Marschorder gäller från nu.',
      '⏰ Om 1 timme! Den som kommer sist bjuder, glöm int''.',
      '⏰ Om 1 timme! Nu ä dä bara att gå.',
      '⏰ Om 1 timme! Generalen räknar huvuden.']
    when 'cancel' then array[
      '🚫 Eventet ä inställt. Chatten ä stängd.',
      '🚫 Eventet ä inställt. Vila i baracken i stället.',
      '🚫 Eventet ä inställt. Ölguden gråter en skvätt.',
      '🚫 Eventet ä inställt. Reträtt, ingen skam i dä.',
      '🚫 Eventet ä inställt. Vi tar dä en annan kväll.',
      '🚫 Eventet ä inställt. Kängorna kan stå kvar i hallen.',
      '🚫 Eventet ä inställt. Ordern ä återkallad.',
      '🚫 Eventet ä inställt. Hä blev int'' nå den här gången.',
      '🚫 Eventet ä inställt. Truppen ä hemförlovad.',
      '🚫 Eventet ä inställt. Spara på bärsen till nästa gång.']
    else array['📨 {namn}'] end;
$$;

create or replace function public.olnu_tg_say(p_gid uuid, p_uid uuid, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
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
end; $$;

-- ---------------------------------------------------------------------------
-- Triggers (an error here never breaks the invite itself)
-- ---------------------------------------------------------------------------
create or replace function public.olnu_tg_inv_ins()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_g uuid;
begin
  begin
    v_g := public.olnu_tg_make(new.id);
    if v_g is not null then perform public.olnu_tg_say(v_g, new.creator, 'made'); end if;
  exception when others then
    raise warning 'olnu_tg_inv_ins: %', sqlerrm;
  end;
  return null;
end; $$;

create or replace function public.olnu_tg_inv_upd()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_g uuid;
begin
  begin
    if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
      update public.temp_groups t set closed_at = now() where t.invite_id = new.id and t.closed_at is null
      returning t.group_id into v_g;
      if v_g is not null then perform public.olnu_tg_say(v_g, new.creator, 'cancel'); end if;
    end if;
    if new.reminded_at is not null and old.reminded_at is null and new.status = 'open' then
      select t.group_id into v_g from public.temp_groups t where t.invite_id = new.id and t.closed_at is null;
      if v_g is not null then perform public.olnu_tg_say(v_g, new.creator, 'soon'); end if;
    end if;
  exception when others then
    raise warning 'olnu_tg_inv_upd: %', sqlerrm;
  end;
  return null;
end; $$;

create or replace function public.olnu_tg_ans()
returns trigger language plpgsql security definer set search_path = public as $$
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
end; $$;

-- Nobody may join a temp group (join_group by code, or any other path).
create or replace function public.olnu_tg_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.temp_groups t where t.group_id = new.group_id) then
    raise exception 'group_not_found';
  end if;
  return new;
end; $$;

create or replace trigger olnu_tg_inv_ins after insert on public.invites
  for each row execute function public.olnu_tg_inv_ins();
create or replace trigger olnu_tg_inv_upd after update of status, reminded_at on public.invites
  for each row execute function public.olnu_tg_inv_upd();
create or replace trigger olnu_tg_ans after update of answer on public.invite_people
  for each row execute function public.olnu_tg_ans();
create or replace trigger olnu_tg_guard before insert on public.group_members
  for each row execute function public.olnu_tg_guard();

-- Backfill: invites that are still running get their chat now (no system line).
do $$
declare r record;
begin
  for r in select i.id from public.invites i
            where i.starts_at + interval '12 hours' + interval '7 days' > now()
              and not exists (select 1 from public.temp_groups t where t.invite_id = i.id) loop
    perform public.olnu_tg_make(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- My event chats (not hidden yet), newest start first, max 20. p_seen = {"<group_id>": last seen msg id} for unread.
create or replace function public.my_event_chats(p_seen jsonb default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_seen jsonb := case when jsonb_typeof(p_seen) = 'object' then p_seen else '{}'::jsonb end;
begin
  return jsonb_build_object('v', 1, 'now', now(), 'chats', coalesce((
    select jsonb_agg(x.j order by x.s desc) from (
      select i.starts_at as s, jsonb_build_object(
        'group_id', t.group_id, 'invite_id', i.id, 'title', i.title, 'name', g.name, 'kind', i.kind, 'place', i.place,
        'starts_at', i.starts_at, 'open_until', t.open_until, 'hide_at', t.hide_at,
        'state', case when t.closed_at is not null or i.status <> 'open' then 'cancelled'
                      when now() >= t.open_until then 'archived' else 'open' end,
        'can_write', public.olnu_tg_access(t.group_id, v_uid) = 'write',
        'my_answer', p.answer, 'mine', i.creator = v_uid,
        'members', (select count(*) from public.invite_people q where q.invite_id = i.id and q.answer in ('yes', 'maybe')),
        'invited', (select count(*) from public.invite_people q where q.invite_id = i.id),
        'last_id', (select max(m.id) from public.group_msgs m where m.group_id = t.group_id and m.expires_at > now()),
        'unread', (select count(*) from (
            select 1 from public.group_msgs m
             where m.group_id = t.group_id and m.expires_at > now() and m.user_id <> v_uid
               and m.id > case when coalesce(v_seen ->> t.group_id::text, '') ~ '^[0-9]{1,18}$'
                               then (v_seen ->> t.group_id::text)::bigint else 0 end
             limit 99) z)) as j
        from public.invite_people p
        join public.temp_groups t on t.invite_id = p.invite_id
        join public.invites i on i.id = p.invite_id
        join public.groups g on g.id = t.group_id
       where p.user_id = v_uid and now() < t.hide_at
       order by i.starts_at desc
       limit 20) x), '[]'::jsonb));
end; $$;

-- notify-group (service_role): who gets the push for a chat message / voice in a temp group, and the sender's
-- name. Empty unless the sender may write. Only ✅ / 🤔 people (not the invited-only readers).
create or replace function public.evchat_push_mates(p_gid uuid, p_uid uuid)
returns table (user_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select p.user_id, coalesce(public.olnu_friend_name(p_uid), 'Nån')
    from public.temp_groups t
    join public.invite_people p on p.invite_id = t.invite_id
   where t.group_id = p_gid
     and public.olnu_tg_access(p_gid, p_uid) = 'write'
     and p.answer in ('yes', 'maybe') and p.user_id <> p_uid;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare
  v_helpers text := 'public.olnu_tg_name(text, timestamptz), public.olnu_tg_night_end(timestamptz), '
    || 'public.olnu_tg_access(uuid, uuid), public.olnu_chat_can(uuid, uuid, boolean), public.olnu_is_temp_group(uuid), '
    || 'public.olnu_tg_make(bigint), public.olnu_tg_lines(text), public.olnu_tg_say(uuid, uuid, text), '
    || 'public.olnu_tg_inv_ins(), public.olnu_tg_inv_upd(), public.olnu_tg_ans(), public.olnu_tg_guard()';
  v_rpcs text := 'public.my_event_chats(jsonb)';
  v_svc text := 'public.evchat_push_mates(uuid, uuid)';
begin
  execute 'revoke all on function ' || v_helpers || ' from public';
  execute 'revoke all on function ' || v_rpcs || ' from public';
  execute 'revoke all on function ' || v_svc || ' from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function ' || v_helpers || ', ' || v_rpcs || ', ' || v_svc || ' from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function ' || v_helpers || ', ' || v_svc || ' from authenticated';
    execute 'grant execute on function ' || v_rpcs || ' to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function ' || v_svc || ' to service_role';
  end if;
end $$;
