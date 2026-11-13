-- 0514 · DM FRIEND (lane friends2, I-91). OWNER-RUN on staging first, then live. Additive: two new functions, no table change.
-- Why: a DM "group" has no group_members rows, so group_friend_states / friend_request(p_group_id, p_k) answer not_member there,
-- and the profile card opened from a DM header had no "Lägg till vän". These two read the pair from dm_threads.
--   dm_friend_state(p_group_id)  → {v:1, dm:true, states:[{k, name, s}]}   s = friend | out | in | none (same shape as group_friend_states)
--   dm_friend_request(p_group_id, p_name) → the friend_request answer. It calls friend_request(p_code) with the other person's
--     friend code, so every limit of friend_request (slow_down, friend_limit, 24 h re-open rule) holds. A person with no code
--     gets one (the same generator as my_friend_code). The code is never returned to the caller.
-- Blocked either way (olnu_ub_hidden) → no state row / invalid_member. Safe to run again.
-- Check after the run (expect 2):
--   select count(*) from pg_proc where proname in ('dm_friend_state', 'dm_friend_request');
create or replace function public.dm_friend_state(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); v_o uuid; v_s text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select case when t.a = v_uid then t.b else t.a end into v_o
    from public.dm_threads t where t.group_id = p_group_id and (t.a = v_uid or t.b = v_uid);
  if v_o is null then raise exception 'not_member'; end if;
  if public.olnu_ub_hidden(v_uid, v_o) then return jsonb_build_object('v', 1, 'dm', true, 'states', '[]'::jsonb); end if;
  select case when f.status = 'accepted' then 'friend'
              when f.status = 'pending' and f.requester = v_uid then 'out'
              when f.status = 'pending' then 'in'
              else 'none' end into v_s
    from public.friendships f
   where least(f.a, f.b) = least(v_uid, v_o) and greatest(f.a, f.b) = greatest(v_uid, v_o);
  return jsonb_build_object('v', 1, 'dm', true, 'states', jsonb_build_array(jsonb_build_object(
    'k', public.olnu_chief_k(p_group_id, v_o), 'name', public.olnu_friend_name(v_o), 's', coalesce(v_s, 'none'))));
end $$;

create or replace function public.dm_friend_request(p_group_id uuid, p_name text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := public.olnu_uid(); v_o uuid; v_code text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select case when t.a = v_uid then t.b else t.a end into v_o
    from public.dm_threads t where t.group_id = p_group_id and (t.a = v_uid or t.b = v_uid);
  if v_o is null then raise exception 'not_member'; end if;
  if public.olnu_ub_hidden(v_uid, v_o) then raise exception 'invalid_member'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_fcode:' || v_o::text, 0));
  select c.code into v_code from public.friend_codes c where c.user_id = v_o;
  if v_code is null then
    insert into public.friend_codes (user_id, code) values (v_o, public.olnu_friend_newcode())
      on conflict (user_id) do nothing;
    select c.code into v_code from public.friend_codes c where c.user_id = v_o;
  end if;
  if v_code is null then raise exception 'invalid_member'; end if;
  return public.friend_request(p_code => v_code, p_name => p_name);
end $$;

revoke all on function public.dm_friend_state(uuid) from public;
revoke all on function public.dm_friend_request(uuid, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.dm_friend_state(uuid), public.dm_friend_request(uuid, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.dm_friend_state(uuid), public.dm_friend_request(uuid, text) to authenticated';
  end if;
end $$;

select public.olnu_strip_cr();
