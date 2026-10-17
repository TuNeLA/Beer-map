-- 0029 Groups can keep their chat (+ voice, + photos when 0028 exists) after 05:00, forever.
-- A group setting keep_history (default off = everything ends at 05:00 as before).
-- Any member can see it; any member can change it (groups have no admins besides created_by;
-- the creator or, if the creator left, any member may toggle). Changing it also extends or
-- shortens the group's current live messages.
create table if not exists public.group_settings (
  group_id     uuid primary key,
  keep_history boolean not null default false,
  changed_by   uuid,
  changed_at   timestamptz not null default now()
);
alter table public.group_settings enable row level security;
revoke all on public.group_settings from anon, authenticated;

create or replace function public.olnu_group_keeps(p_group_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.keep_history from public.group_settings s where s.group_id = p_group_id), false);
$$;
revoke all on function public.olnu_group_keeps(uuid) from public, anon, authenticated;

-- New rows in a keeping group never expire.
create or replace function public.olnu_keep_history_ins()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.olnu_group_keeps(new.group_id) then new.expires_at := 'infinity'::timestamptz; end if;
  return new;
end; $$;
revoke all on function public.olnu_keep_history_ins() from public, anon, authenticated;
create or replace trigger group_msgs_keep before insert on public.group_msgs
  for each row execute function public.olnu_keep_history_ins();
create or replace trigger voice_msgs_keep before insert on public.voice_msgs
  for each row execute function public.olnu_keep_history_ins();

create or replace function public.group_keep_history(p_group_id uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  return public.olnu_group_keeps(p_group_id);
end; $$;

create or replace function public.set_group_keep_history(p_group_id uuid, p_on boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v_creator uuid; v_on boolean := coalesce(p_on, false);
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select g.created_by into v_creator from public.groups g where g.id = p_group_id;
  if v_creator is not null and v_creator <> v_uid
     and exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_creator) then
    raise exception 'not_admin';
  end if;
  insert into public.group_settings as s (group_id, keep_history, changed_by, changed_at)
  values (p_group_id, v_on, v_uid, now())
  on conflict (group_id) do update set keep_history = v_on, changed_by = v_uid, changed_at = now();
  if v_on then
    update public.group_msgs set expires_at = 'infinity' where group_id = p_group_id and expires_at > now();
    update public.voice_msgs set expires_at = 'infinity' where group_id = p_group_id and expires_at > now();
  else
    update public.group_msgs set expires_at = public.olnu_next_expiry() where group_id = p_group_id and expires_at = 'infinity';
    update public.voice_msgs set expires_at = public.olnu_next_expiry() where group_id = p_group_id and expires_at = 'infinity';
  end if;
  return v_on;
end; $$;

revoke all on function public.group_keep_history(uuid) from public, anon;
revoke all on function public.set_group_keep_history(uuid, boolean) from public, anon;
grant execute on function public.group_keep_history(uuid) to authenticated;
grant execute on function public.set_group_keep_history(uuid, boolean) to authenticated;
