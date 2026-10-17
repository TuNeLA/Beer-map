-- 0022 Grogg and bubbel. post_other_v2 accepts the old kinds plus 'grogg' and 'bubbel'.
-- New kinds go through post_other('annat') (same cooldown and rules) and then set other_kind.
create or replace function public.post_other_v2(p_kind text, p_lat double precision, p_lng double precision, p_precise boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.olnu_uid();
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_r    jsonb;
begin
  if v_kind not in ('rom', 'vin', 'cider', 'drink', 'shot', 'whisky', 'annat', 'grogg', 'bubbel') then
    raise exception 'invalid_kind';
  end if;
  if v_kind in ('grogg', 'bubbel') then
    v_r := public.post_other('annat', p_lat, p_lng, p_precise)::jsonb;
    if (v_r->>'accepted')::boolean then
      update public.beers set other_kind = v_kind where id = (v_r->>'id')::bigint and user_id = v_uid;
      v_r := jsonb_set(v_r, '{other_kind}', to_jsonb(v_kind));
    end if;
    return v_r::json;
  end if;
  return public.post_other(v_kind, p_lat, p_lng, p_precise);
end;
$$;
revoke all on function public.post_other_v2(text, double precision, double precision, boolean) from public, anon;
grant execute on function public.post_other_v2(text, double precision, double precision, boolean) to authenticated;
