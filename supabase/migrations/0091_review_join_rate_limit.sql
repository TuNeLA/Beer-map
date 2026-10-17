-- 0091 (review) join_group: max 8 wrong codes per user per 10 minutes. Safe to run again.
create table if not exists public.join_fails (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists join_fails_user_idx on public.join_fails (user_id, at);
create index if not exists join_fails_at_idx on public.join_fails (at);
alter table public.join_fails enable row level security;
revoke all on table public.join_fails from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on table public.join_fails from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on table public.join_fails from authenticated'; end if;
end $$;

create or replace function public.join_group(p_code text, p_display_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := public.olnu_uid();
  v_code    text := upper(btrim(coalesce(p_code, '')));
  v_display text := public.olnu_clean_display_name(p_display_name);
  v_group   public.groups%rowtype;
begin
  if (select count(*) from public.join_fails f where f.user_id = v_uid and f.at > now() - interval '10 minutes') >= 8 then
    raise exception 'slow_down';
  end if;
  select * into v_group from public.groups g where g.code = v_code;
  if not found then
    -- Keep the fail row: return an error body instead of raising (raising would roll the insert back).
    insert into public.join_fails (user_id) values (v_uid);
    perform set_config('response.status', '400', true);
    return json_build_object('code', 'P0001', 'message', 'group_not_found', 'details', null, 'hint', null);
  end if;

  insert into public.group_members (group_id, user_id, display_name)
  values (v_group.id, v_uid, v_display)
  on conflict (group_id, user_id) do update set display_name = excluded.display_name;

  return json_build_object('id', v_group.id, 'name', v_group.name, 'code', v_group.code);
end;
$$;
revoke all on function public.join_group(text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function public.join_group(text, text) from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'grant execute on function public.join_group(text, text) to authenticated'; end if;
end $$;
