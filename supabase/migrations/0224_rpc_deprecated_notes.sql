-- 0224 🧹 RPCs with no caller in the repo (owner 2026-11-07; comments only — NOTHING is dropped or changed).
-- Old clients may still call them (compatibility rule). Drop only after 30 days with 0 calls (pg_stat_statements).
-- Re-checked 2026-11-07 against docs/, supabase/functions/, scripts/ and .github/ (word match): the code review list of 14 was
-- stale — spel_act/group/mine/open/state, event_group, event_story, my_night_log and my_past_events ARE used again.
-- Still unused from that list: find_cancel, group_rallies, like_msg, msg_likes, my_eta (marked below).
-- Other functions with EXECUTE for anon/authenticated and no caller in this branch (NOT marked: the store-safe / trust work
-- and the owner tools may add their callers): accept_terms, bar_norm, block_user, unblock_user, my_blocks, ikvall_set,
-- ikvall_status, owner_feedback, owner_set_feedback, owner_mask_test, owner_move_stats, owner_report_act, owner_report_photo,
-- owner_reports, report_content, safety_state, set_age_ok, submit_feedback.

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('find_cancel', 'group_rallies', 'like_msg', 'msg_likes', 'my_eta') loop
    execute format('comment on function %s is %L', r.f,
      'DEPRECATED 2026-11-07: no caller in the app any more (old clients only). Drop after 30 days with 0 calls.');
  end loop;
end;
$$;
