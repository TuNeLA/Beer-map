-- public.my_friends(p_name text)
-- live md5(pg_get_functiondef) = 4ca1edcda08195b69f5f979080a611e6
CREATE OR REPLACE FUNCTION public.my_friends(p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_fr jsonb; v_in jsonb; v_out jsonb;
begin
  perform public.olnu_friend_setname(v_uid, p_name);
  select coalesce(jsonb_agg(x.j order by x.is_out desc, lower(coalesce(x.nm, '~'))), '[]'::jsonb) into v_fr from (
    select jsonb_build_object('id', f.id, 'key', 'f' || f.id, 'name', public.olnu_friend_name(o.uid),
             'home_town', public.olnu_home_town(o.uid), 'out', coalesce(po.is_out, false), 'town', po.town,
             'since', f.accepted_at, 'via', f.via) as j,
           coalesce(po.is_out, false) as is_out, public.olnu_friend_name(o.uid) as nm
      from public.friendships f
      cross join lateral (select public.olnu_friend_other(f, v_uid) as uid) o
      left join lateral public.olnu_friend_out(o.uid) po on true
     where (f.a = v_uid or f.b = v_uid) and f.status = 'accepted'
     limit 300) x;
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', public.olnu_friend_name(f.requester),
           'home_town', public.olnu_home_town(f.requester), 'at', f.updated_at, 'via', f.via) order by f.updated_at desc), '[]'::jsonb)
    into v_in
    from public.friendships f
   where (f.a = v_uid or f.b = v_uid) and f.status = 'pending' and f.requester <> v_uid;
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', public.olnu_friend_name(public.olnu_friend_other(f, v_uid)),
           'at', f.updated_at) order by f.updated_at desc), '[]'::jsonb)
    into v_out
    from public.friendships f
   where (f.a = v_uid or f.b = v_uid) and f.status = 'pending' and f.requester = v_uid;
  return jsonb_build_object('code', (select c.code from public.friend_codes c where c.user_id = v_uid),
    'friends', v_fr, 'incoming', v_in, 'outgoing', v_out);
end; $function$;
