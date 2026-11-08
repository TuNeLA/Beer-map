-- public.olnu_tz_patch(p_fn regprocedure, p_old text[], p_new text[])
-- live md5(pg_get_functiondef) = 28241fcf29268147570004db31440386
CREATE OR REPLACE FUNCTION public.olnu_tz_patch(p_fn regprocedure, p_old text[], p_new text[])
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_def text := pg_get_functiondef(p_fn);
  i int; n int;
begin
  if position('olnu_is_test_' in v_def) > 0 then return 'skip ' || p_fn::text; end if;
  for i in 1 .. coalesce(array_length(p_old, 1), 0) loop
    n := (length(v_def) - length(replace(v_def, p_old[i], ''))) / greatest(length(p_old[i]), 1);
    if n <> 1 then
      raise exception 'olnu_tz_patch %: anchor % found % times', p_fn::text, i, n;
    end if;
    v_def := replace(v_def, p_old[i], p_new[i]);
  end loop;
  execute v_def;
  return 'ok ' || p_fn::text;
end $function$;
