-- public.join_preview(p_code text)
-- live md5(pg_get_functiondef) = e23fedbe81f5843dcbb2744c4b49ddc5
CREATE OR REPLACE FUNCTION public.join_preview(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_g    public.groups%rowtype;
  v_n    int;
  v_mem  boolean;
  v_faces jsonb;
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
  select coalesce(jsonb_agg(f.i), '[]'::jsonb) into v_faces from (
    select upper(left(btrim(coalesce(m.display_name, '?')), 1)) as i
      from public.group_members m
      left join public.beers b on b.user_id = m.user_id and b.expires_at > now() and not coalesce(b.stopped, false) and not coalesce(b.ghost, false)
     where m.group_id = v_g.id
     order by (b.user_id is not null) desc, m.joined_at
     limit 4) f;
  return jsonb_build_object('ok', true, 'name', v_g.name, 'members', v_n, 'member', v_mem,
    'out', public.olnu_card_out(v_g.id), 'faces', v_faces);
end;
$function$;
