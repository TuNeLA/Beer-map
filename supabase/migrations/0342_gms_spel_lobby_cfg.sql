-- 0342 🎉 SPEL lobby settings shared by the room (gms, 2026-11-08; owner sim night 3: "the host chose Skålstraff, the
-- others still saw Klassiskt"). New act 'cfg' in spel_act: the room host (the creator while active, else the first active
-- player) writes the lobby choice {pen, goal} into pub.cfg; every phone draws it from there (others read-only).
-- Additive and backward compatible: one new branch, nothing else in spel_act changes (old clients never send 'cfg').
-- The branch is spliced into the live function body, so this file never copies (and never reverts) other spel_act changes.
-- Safe to re-run (it checks for the marker first).
do $mig$
declare v_def text; v_new text;
  v_branch text := $b$
  elsif p_act = 'cfg' then   -- gms 0342 act_cfg
    if r.phase not in ('lobby', 'end') then raise exception 'not_now'; end if;
    if v_uid <> coalesce((case when r.created_by = any (public.olnu_spel_active(p_room)) then r.created_by
                                else (public.olnu_spel_active(p_room))[1] end), v_uid) then raise exception 'not_host'; end if;
    update public.spel_rooms set v = v + 1, updated_at = now(),
      pub = pub || jsonb_build_object('cfg', jsonb_build_object(
        'pen', case when p_data->>'pen' in ('utm', 'skal', 'streck', 'klunk') then p_data->>'pen' else coalesce(r.pub->'cfg'->>'pen', 'utm') end,
        'goal', least(50, greatest(2, coalesce(nullif(p_data->>'goal', '')::int, (r.pub->'cfg'->>'goal')::int, 12)))))
     where id = p_room;
$b$;
begin
  v_def := pg_get_functiondef('public.spel_act(uuid,text,text,jsonb)'::regprocedure);
  if position('act_cfg' in v_def) > 0 then return; end if;
  if position(E'\n  elsif p_act = ''leave'' then' in v_def) = 0 then raise exception 'spel_act anchor (leave) not found'; end if;
  v_new := replace(v_def, E'\n  elsif p_act = ''leave'' then', v_branch || E'\n  elsif p_act = ''leave'' then');
  execute v_new;
end $mig$;
