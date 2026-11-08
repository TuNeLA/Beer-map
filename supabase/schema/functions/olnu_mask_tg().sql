-- public.olnu_mask_tg()
-- live md5(pg_get_functiondef) = 9f4f124416e167337e514733a0d37b8f
CREATE OR REPLACE FUNCTION public.olnu_mask_tg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c text; j jsonb; v text; w text; changed boolean := false;
begin
  if not public.olnu_store_on() then return new; end if;
  begin
    j := to_jsonb(new);
    foreach c in array tg_argv loop
      v := j ->> c;
      if v is not null then
        w := public.olnu_mask_text(v);
        if w is distinct from v then j := jsonb_set(j, array[c], to_jsonb(w)); changed := true; end if;
      end if;
    end loop;
    if changed then new := jsonb_populate_record(new, j); end if;
  exception when others then
    null;
  end;
  return new;
end; $function$;
