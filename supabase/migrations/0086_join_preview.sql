-- 0086 (join) join_preview: the welcome card on an invite link shows the group name before the friend joins.
-- Read-only except the shared wrong-code counter (join_fails, 0091): a wrong code counts like a wrong join,
-- so codes cannot be guessed faster through this function. Safe to run again.
create or replace function public.join_preview(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_g    public.groups%rowtype;
  v_n    int;
  v_mem  boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if (select count(*) from public.join_fails f where f.user_id = v_uid and f.at > now() - interval '10 minutes') >= 8 then
    return jsonb_build_object('ok', false, 'why', 'slow_down');
  end if;
  if char_length(v_code) <> 6 then
    return jsonb_build_object('ok', false, 'why', 'group_not_found');
  end if;
  select * into v_g from public.groups g where g.code = v_code;
  if not found then
    insert into public.join_fails (user_id) values (v_uid);
    return jsonb_build_object('ok', false, 'why', 'group_not_found');
  end if;
  select count(*)::int, coalesce(bool_or(m.user_id = v_uid), false) into v_n, v_mem
    from public.group_members m where m.group_id = v_g.id;
  return jsonb_build_object('ok', true, 'name', v_g.name, 'members', v_n, 'member', v_mem);
end;
$$;
revoke all on function public.join_preview(text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function public.join_preview(text) from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'grant execute on function public.join_preview(text) to authenticated'; end if;
end $$;
