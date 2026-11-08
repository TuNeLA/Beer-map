-- 0385 (bold, owner OK 2026-11-08, flag bold_replay): Kvällsrepris 2.0 — photo moments for the 15 s film.
-- Returns only WHO (the replay key k) and WHEN a photo was taken last night in this group (Skåltimme posts, Engångskamera
-- shots, chat photos). NO location: the player puts the pop on that person's SAFE replay position at that time
-- (crew_replay / olnu_replay_safe_points: bars exact, everything else on the 500 m grid). Only members who are in the
-- replay (not hidden, no ghost night). Max 60. Same 05:00–18:00 window as crew_replay. Additive only.

create or replace function public.bold_replay_photos(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_now timestamptz := public.olnu_crew_now();
  v_last timestamptz := public.olnu_crew_last_night(v_now);
  v_from timestamptz := v_last - interval '1 day';
  v jsonb;
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if not public.olnu_bold_on('bold_replay') then return jsonb_build_object('v', 1, 'off', true, 'photos', '[]'::jsonb); end if;
  if v_now >= v_last + interval '13 hours' then return jsonb_build_object('v', 1, 'photos', '[]'::jsonb); end if;
  with who as (select distinct s.user_id from public.olnu_replay_safe_points(p_group_id, v_last) s),
  ph as (
    select x.user_id, x.created_at as at, 'skal'::text as kind from public.skal_hour_posts x
     where x.group_id = p_group_id and x.created_at >= v_from and x.created_at < v_last
    union all
    select x.user_id, x.created_at, coalesce(x.kind, 'film') from public.snap_photos x
     where x.group_id = p_group_id and x.created_at >= v_from and x.created_at < v_last
    union all
    select x.user_id, x.created_at, 'chat' from public.chat_photos x
     where x.group_id = p_group_id and x.created_at >= v_from and x.created_at < v_last
  )
  select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_crew_k(p_group_id, q.user_id), 'at', q.at, 'kind', q.kind) order by q.at), '[]'::jsonb)
    into v
    from (select ph.* from ph join who on who.user_id = ph.user_id order by ph.at limit 60) q;
  return jsonb_build_object('v', 1, 'photos', v);
end; $function$;
revoke all on function public.bold_replay_photos(uuid) from public, anon;
grant execute on function public.bold_replay_photos(uuid) to authenticated, service_role;
