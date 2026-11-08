-- public.olnu_ev_public(l ev_links, p_uid uuid)
-- live md5(pg_get_functiondef) = dc5c8ae987d9d8e3a66fa892f0124d43
CREATE OR REPLACE FUNCTION public.olnu_ev_public(l ev_links, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  i public.invites;
  v_me text;
  v_yes int; v_maybe int;
begin
  select * into i from public.invites x where x.id = l.invite_id;
  if not found then return jsonb_build_object('ok', false, 'why', 'not_found'); end if;
  select p.answer into v_me from public.invite_people p where p.invite_id = i.id and p.user_id = p_uid;
  select count(*) filter (where answer = 'yes')::int, count(*) filter (where answer = 'maybe')::int into v_yes, v_maybe
    from public.invite_people p where p.invite_id = i.id;
  return jsonb_build_object('ok', true, 'token', l.token, 'title', i.title, 'kind', i.kind, 'place', i.place,
    'starts_at', i.starts_at, 'ends_at', i.ends_at, 'status', i.status, 'live', i.status = 'open' and i.ends_at > now(),
    'from', public.olnu_card_first(public.olnu_friend_name(l.creator)),
    'creator', public.olnu_card_first(public.olnu_friend_name(i.creator)),
    'yes', v_yes, 'maybe', v_maybe, 'faces', public.olnu_ev_faces(i.id),
    'member', v_me is not null, 'my_answer', coalesce(v_me, 'none'),
    'id', case when v_me is not null then i.id end);
end;
$function$;
