-- public.olnu_avatar_lock_ok(p_lk jsonb, p_f jsonb)
-- live md5(pg_get_functiondef) = f4ae4bdd8501f5373c4372198daf0a4d
CREATE OR REPLACE FUNCTION public.olnu_avatar_lock_ok(p_lk jsonb, p_f jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare v_ok boolean := true; v_t text := coalesce(p_f->>'today', '01-01'); v_a text; v_b text; x jsonb;
begin
  if p_lk is null then return true; end if;
  if p_lk ? 'n' and coalesce((p_f->>'gf')::boolean, false) then return true; end if;   -- v3: grandfathered
  if (p_lk ? 'r' and coalesce((p_f->>'r')::int, 1) < (p_lk->>'r')::int)
     or (p_lk ? 'm' and not coalesce(p_f->'m', '[]'::jsonb) ? (p_lk->>'m'))
     or (p_lk ? 's' and coalesce((p_f->>'s')::int, 0) < (p_lk->>'s')::int)
     or (p_lk ? 'b' and coalesce((p_f->>'b')::int, 0) < (p_lk->>'b')::int)
     or (p_lk ? 't' and coalesce((p_f->>'t')::int, 0) < (p_lk->>'t')::int)
     or (p_lk ? 'e' and coalesce((p_f->>'e')::int, 0) < (p_lk->>'e')::int)
     or (p_lk ? 'g' and coalesce((p_f->>'g')::int, 0) < (p_lk->>'g')::int)
     or (p_lk ? 'k' and coalesce((p_f->>'k')::int, 0) < (p_lk->>'k')::int) then
    v_ok := false;
  end if;
  if v_ok and p_lk ? 'd' then
    v_a := substr(p_lk->>'d', 1, 5); v_b := substr(p_lk->>'d', 7, 5);
    v_ok := case when v_a <= v_b then v_t between v_a and v_b else v_t >= v_a or v_t <= v_b end;
  end if;
  if v_ok then return true; end if;
  if jsonb_typeof(p_lk->'o') = 'array' then
    for x in select * from jsonb_array_elements(p_lk->'o') loop
      if public.olnu_avatar_lock_ok(x, p_f) then return true; end if;
    end loop;
  end if;
  return false;
end; $function$;
