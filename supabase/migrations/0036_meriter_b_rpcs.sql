-- 0036b v26 MERITER: two existing RPCs get meriter fields (additive, same return types, same grants).
--   poll_v2: pins[] of me / group-mates get "meriter" (after "total").
--   my_wrapped: "title" is the meriter rank now; new field "meriter" at the end.
-- The live function text is patched in place (pg_get_functiondef + replace), so nothing else in the long
-- bodies can drift. A missing anchor raises (nothing changes). Safe to run again (already patched = skip).
do $$
declare
  v_def text;
  v_new text;
  v_anchor text := '(select b.user_id from public.beers b where b.id = sel.beer_id)) end';
begin
  v_def := pg_get_functiondef('public.poll_v2(double precision, double precision, double precision, double precision, timestamp with time zone, boolean)'::regprocedure);
  if position('''meriter''' in v_def) = 0 then
    if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
      raise exception 'poll_v2 anchor not found once';
    end if;
    v_new := replace(v_def, v_anchor, v_anchor || E',\n           ''meriter'',     case when sel.is_mine or sel.is_friend then public.olnu_meriter(\n                            (select b.user_id from public.beers b where b.id = sel.beer_id)) end');
    execute v_new;
  end if;

  v_def := pg_get_functiondef('public.my_wrapped(text, integer)'::regprocedure);
  if position('olnu_rank_of' in v_def) = 0 then
    if position('from public.olnu_titles() t where t.at <= v_total order by t.at desc limit 1;' in v_def) = 0
       or position('''title'', v_title);' in v_def) = 0 then
      raise exception 'my_wrapped anchor not found';
    end if;
    v_new := replace(v_def, 'from public.olnu_titles() t where t.at <= v_total order by t.at desc limit 1;',
                     'from public.olnu_rank_of(public.olnu_meriter(v_uid)) t;');
    v_new := replace(v_new, '''title'', v_title);', '''title'', v_title, ''meriter'', public.olnu_meriter(v_uid));');
    execute v_new;
  end if;
end $$;
