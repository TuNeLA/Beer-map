-- public.bar_photos(p_bar_id text)
-- live md5(pg_get_functiondef) = 22e166c83ef3c80059c0715fd9618811
CREATE OR REPLACE FUNCTION public.bar_photos(p_bar_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_g jsonb; v_p jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_bar_id is null or char_length(p_bar_id) > 120 then raise exception 'invalid_bar'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', public.olnu_bp_key(x.id), 'kind', x.kind, 'w', x.w, 'h', x.h, 'at', x.taken_at,
           'by', (select m.display_name from public.group_members m where m.group_id = x.group_id and m.user_id = x.user_id),
           'group_name', (select g.name from public.groups g where g.id = x.group_id),
           'is_me', x.user_id = v_uid,
           'shared', x.pub,
           'can_share', x.user_id = v_uid and x.hidden_by is distinct from 'owner',
           'public_until', case when x.pub then x.public_until end)
         order by x.taken_at desc), '[]'::jsonb)
    into v_g
    from (select p.id, p.kind, p.w, p.h, p.taken_at, p.group_id, p.user_id, p.hidden_by, p.public_until,
                 public.olnu_bp_pub(p) as pub
            from public.bar_photos p
           where p.bar_id = p_bar_id and p.taken_at > now() - interval '8 days'
             and exists (select 1 from public.group_members m where m.group_id = p.group_id and m.user_id = v_uid)
             and public.olnu_bp_alive(p)
           order by p.taken_at desc limit 24) x;
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', public.olnu_bp_key(x.id), 'w', x.w, 'h', x.h, 'at', x.taken_at, 'is_me', x.user_id = v_uid,
           'public_until', x.public_until)
         order by x.public_at desc), '[]'::jsonb)
    into v_p
    from (select p.id, p.w, p.h, p.taken_at, p.user_id, p.public_until, p.public_at
            from public.bar_photos p
           where p.bar_id = p_bar_id and p.public_until > now() and p.hidden_at is null and p.pub_bytes is not null
             and not exists (select 1 from public.bar_photo_reports r where r.bp_id = p.id and r.user_id = v_uid)
             and not (exists (select 1 from public.group_members m where m.group_id = p.group_id and m.user_id = v_uid)
                      and public.olnu_bp_alive(p) and p.taken_at > now() - interval '8 days')
           order by p.public_at desc limit 24) x;
  return jsonb_build_object('v', 1, 'now', now(), 'bar_id', p_bar_id, 'group', v_g, 'public', v_p);
end; $function$;
