-- 0213 STORE-SAFE · the "kung" medal (most drinks at one bar in a week) is not given in store mode (owner decision 2).
-- Earned medals stay. Unchanged while store_mode = 'off'. Anchored text edit (stops if the anchor is gone).
-- No row-removing or object-removing statement in this file.
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.olnu_medal_eval'::regproc);
  if position('''kung'', case when v_store' in d) = 0 then
    if position('(''kung'', v_king),' in d) = 0 or position('v_store' in d) = 0 then raise exception '0213 anchor missing (needs 0211)'; end if;
    d := replace(d, '(''kung'', v_king),', '(''kung'', case when v_store then 0 else v_king end),');
    execute d;
  end if;
end $mig$;
