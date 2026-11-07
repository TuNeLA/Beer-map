-- 0176 owner_move_stats(p_key): how many accounts moved to the new address (handover_tickets, 0175).
-- Same key check as owner_stats: a wrong key is logged in owner_key_fails and answered with 403 (no raise,
-- so the log row stays). Replaces the first version from the 0175 apply. Additive, read-only.
create or replace function public.owner_move_stats(p_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if (select count(*) from public.owner_key_fails f where f.at > now() - interval '1 hour') > 20 then
    raise exception 'rate_limited';
  end if;
  if p_key is null or char_length(p_key) > 200 or not exists (
       select 1 from public.owner_keys k where k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    insert into public.owner_key_fails (at) values (now());
    perform set_config('response.status', '403', true);
    return jsonb_build_object('code', 'PT403', 'message', 'forbidden', 'details', null, 'hint', null);
  end if;
  return (
    select jsonb_build_object(
      'tickets', count(*),
      'moved_users', count(distinct user_id) filter (where done_at is not null),
      'taken_not_done', count(*) filter (where taken_at is not null and done_at is null),
      'never_taken', count(*) filter (where taken_at is null and expires_at < now()),
      'open', count(*) filter (where taken_at is null and expires_at >= now()),
      'by_src', coalesce((select jsonb_object_agg(s, c) from (
          select coalesce(nullif(src, ''), '?') s, count(*) filter (where done_at is not null) c
            from public.handover_tickets group by 1) x), '{}'::jsonb),
      'last_24h_done', count(*) filter (where done_at > now() - interval '24 hours'))
    from public.handover_tickets);
end;
$$;
revoke all on function public.owner_move_stats(text) from public;
grant execute on function public.owner_move_stats(text) to anon, authenticated;
