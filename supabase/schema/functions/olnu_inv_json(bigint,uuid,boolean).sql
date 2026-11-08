-- public.olnu_inv_json(p_id bigint, p_viewer uuid, p_full boolean)
-- live md5(pg_get_functiondef) = 7eb8ec00d5e5d6409c6e16390073a67d
CREATE OR REPLACE FUNCTION public.olnu_inv_json(p_id bigint, p_viewer uuid, p_full boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  i public.invites;
  v_me public.invite_people;
  v_people jsonb := '[]'::jsonb;
  v_yes int; v_maybe int; v_no int; v_none int; v_n int;
  v_gname text;
begin
  select * into i from public.invites x where x.id = p_id;
  if not found then return null; end if;
  select * into v_me from public.invite_people p where p.invite_id = p_id and p.user_id = p_viewer;
  select count(*) filter (where answer = 'yes'), count(*) filter (where answer = 'maybe'),
         count(*) filter (where answer = 'no'), count(*) filter (where answer = 'none'), count(*)
    into v_yes, v_maybe, v_no, v_none, v_n
    from public.invite_people p where p.invite_id = p_id;
  if i.group_id is not null then select g.name into v_gname from public.groups g where g.id = i.group_id; end if;
  if p_full then
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', coalesce(public.olnu_friend_name(p.user_id), '?'),
             'answer', p.answer, 'is_me', p.user_id = p_viewer, 'is_creator', p.user_id = i.creator,
             'by', case when p.invited_by is null or p.invited_by = i.creator or p.user_id = i.creator then null
                        else public.olnu_friend_name(p.invited_by) end,
             'at', coalesce(p.answered_at, p.created_at))
           order by (p.user_id = i.creator) desc,
                    case p.answer when 'yes' then 0 when 'maybe' then 1 when 'none' then 2 else 3 end,
                    p.answered_at nulls last, p.created_at), '[]'::jsonb)
      into v_people
      from public.invite_people p where p.invite_id = p_id;
  end if;
  return jsonb_build_object(
    'id', i.id, 'title', i.title, 'kind', i.kind, 'bar_id', i.bar_id, 'place', i.place,
    'lat', i.lat, 'lng', i.lng, 'starts_at', i.starts_at, 'ends_at', i.ends_at, 'note', i.note,
    'event_id', i.event_id, 'spot', i.spot, 'status', i.status,
    'group_name', v_gname, 'creator_name', coalesce(public.olnu_friend_name(i.creator), '?'),
    'mine', i.creator = p_viewer, 'my_answer', coalesce(v_me.answer, 'none'),
    'yes', v_yes, 'maybe', v_maybe, 'no', v_no, 'none', v_none, 'n', v_n,
    'reminded', i.reminded_at is not null,
    'live', i.status = 'open' and i.ends_at > now(),
    'can_add', i.status = 'open' and i.ends_at > now() and v_n - 1 < 60 and coalesce(v_me.answer, 'none') <> 'no',
    'people', case when p_full then v_people else null end);
end; $function$;
