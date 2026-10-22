-- 0155 friends2: friend state of every member of one of my groups, for the "➕ Lägg till vän" button in Medlemmar.
-- group_friend_states(p_group_id) -> {v:1, states:[{k, name, s}]} for every member except me.
--   name = the member's display name in this group (the caller sees it in Medlemmar already).
--   k = member key (0030 olnu_chief_k, same as group_status_v2/v3.k), never a user id.
--   s = 'friend' (accepted) | 'out' (my pending request) | 'in' (their pending request to me) | 'none'.
-- The button sends the normal friend_request(p_group_id, p_k); the other person answers in 🔔 Inkorg / Vänner.
-- Errors: not_authenticated, not_member. Needs 0030, 0045.

create or replace function public.group_friend_states(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := public.olnu_uid();
  v jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_group_id is null or not exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_chief_k(p_group_id, m.user_id), 'name', m.display_name,
           's', case when f.status = 'accepted' then 'friend'
                     when f.status = 'pending' and f.requester = v_uid then 'out'
                     when f.status = 'pending' then 'in'
                     else 'none' end)), '[]'::jsonb)
    into v
    from public.group_members m
    left join public.friendships f
      on least(f.a, f.b) = least(v_uid, m.user_id) and greatest(f.a, f.b) = greatest(v_uid, m.user_id)
   where m.group_id = p_group_id and m.user_id <> v_uid;
  return jsonb_build_object('v', 1, 'states', v);
end $$;

revoke all on function public.group_friend_states(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.group_friend_states(uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.group_friend_states(uuid) to authenticated';
  end if;
end $$;
