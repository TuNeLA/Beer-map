-- public.invite_create(p_title text, p_starts_at timestamp with time zone, p_keys text[], p_group_ids uuid[], p_bar_id text, p_place text, p_lat double precision, p_lng double precision, p_note text, p_kind text, p_event_id bigint, p_spot text, p_group_id uuid, p_name text)
-- live md5(pg_get_functiondef) = ce97fd3dd92390acb76aff33c6ffbe12
CREATE OR REPLACE FUNCTION public.invite_create(p_title text, p_starts_at timestamp with time zone, p_keys text[] DEFAULT '{}'::text[], p_group_ids uuid[] DEFAULT '{}'::uuid[], p_bar_id text DEFAULT NULL::text, p_place text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_note text DEFAULT NULL::text, p_kind text DEFAULT NULL::text, p_event_id bigint DEFAULT NULL::bigint, p_spot text DEFAULT NULL::text, p_group_id uuid DEFAULT NULL::uuid, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_title text := public.olnu_inv_clean(p_title, 80);
  v_place text := public.olnu_inv_clean(p_place, 60);
  v_note text := public.olnu_inv_clean(p_note, 200);
  v_kind text := lower(coalesce(public.olnu_inv_clean(p_kind, 20), 'beer'));
  v_spot text := lower(coalesce(p_spot, case when p_bar_id is null then 'spot' else 'bar' end));
  v_bar text := public.olnu_inv_clean(p_bar_id, 80);
  v_lat double precision := p_lat; v_lng double precision := p_lng;
  v_start timestamptz := p_starts_at;
  v_to uuid[];
  v_id bigint;
  e public.bar_events;
  v_gid uuid := p_group_id;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.olnu_friend_setname(v_uid, p_name);
  if p_event_id is not null then
    select * into e from public.bar_events x where x.id = p_event_id and x.status = 'ok' and x.expires_at > now();
    if found then
      v_title := coalesce(v_title, left(e.title, 80));
      v_start := coalesce(v_start, e.starts_at);
      v_bar := coalesce(v_bar, e.bar_id); v_place := coalesce(v_place, left(e.place, 60));
      v_lat := coalesce(v_lat, e.lat); v_lng := coalesce(v_lng, e.lng);
      if p_kind is null then v_kind := e.kind; end if;
    end if;
  end if;
  if v_title is null or public.olnu_inv_haslink(v_title) or public.olnu_inv_haslink(v_note) or public.olnu_inv_haslink(v_place) then
    raise exception 'invalid_invite';
  end if;
  if v_start is null or v_start < now() - interval '30 minutes' or v_start > now() + interval '30 days' then
    raise exception 'invalid_invite';
  end if;
  if v_lat is null or v_lng is null or v_lat <> v_lat or v_lng <> v_lng or abs(v_lat) > 85 or abs(v_lng) > 180 then
    raise exception 'invalid_invite';
  end if;
  if v_spot not in ('bar', 'spot', 'here') then v_spot := 'spot'; end if;
  if v_kind !~ '^[a-z_]{2,20}$' then v_kind := 'beer'; end if;
  if v_gid is not null and not exists (select 1 from public.group_members m where m.group_id = v_gid and m.user_id = v_uid) then
    v_gid := null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-inv:' || v_uid::text, 0));
  if exists (select 1 from public.invites x where x.creator = v_uid and x.created_at > now() - interval '10 seconds')
     or (select count(*) from public.invites x where x.creator = v_uid and x.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'slow_down';
  end if;
  v_to := public.olnu_inv_resolve(v_uid, p_keys, p_group_ids);
  if coalesce(array_length(v_to, 1), 0) = 0 then raise exception 'no_invitees'; end if;
  if array_length(v_to, 1) > 60 then raise exception 'too_many'; end if;
  insert into public.invites (creator, title, kind, bar_id, place, lat, lng, starts_at, ends_at, note, event_id, group_id, spot)
  values (v_uid, v_title, v_kind, v_bar, v_place, round(v_lat::numeric, 5)::float8, round(v_lng::numeric, 5)::float8,
          v_start, v_start + interval '6 hours', v_note, p_event_id, v_gid, v_spot)
  returning id into v_id;
  insert into public.invite_people (invite_id, user_id, invited_by, answer, answered_at, notified, yes_pushed)
  values (v_id, v_uid, null, 'yes', now(), true, true);
  insert into public.invite_people (invite_id, user_id, invited_by)
  select v_id, u, v_uid from unnest(v_to) u on conflict do nothing;
  return public.olnu_inv_json(v_id, v_uid, true) || jsonb_build_object('added', array_length(v_to, 1));
end; $function$;
