-- public.note_takeover(p_bar_id text)
-- live md5(pg_get_functiondef) = e008aa9cfee4aa516739b52fc3f22231
CREATE OR REPLACE FUNCTION public.note_takeover(p_bar_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_id  text := public.olnu_bp_clean(p_bar_id);
  v_t   record;
  v_new int := 0;
begin
  select t.* into v_t from public.olnu_takeovers() t
   where t.bar_id = v_id
     and exists (select 1 from public.group_members m where m.group_id = t.group_id and m.user_id = v_uid);
  if not found then
    return jsonb_build_object('ok', false, 'is_new', false);
  end if;
  insert into public.bar_takeovers (group_id, bar_id, bar_name, night, n)
  values (v_t.group_id, v_id, left(v_t.bar_name, 60), public.olnu_next_expiry(), v_t.n)
  on conflict (group_id, bar_id, night) do update set n = greatest(public.bar_takeovers.n, excluded.n)
  returning (xmax = 0)::int into v_new;
  return jsonb_build_object('ok', true, 'is_new', coalesce(v_new, 0) = 1);
end;
$function$;
