-- public.delete_my_data_v2()
-- live md5(pg_get_functiondef) = 4f493dabaac6d6025c4fc57817321717
CREATE OR REPLACE FUNCTION public.delete_my_data_v2()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_new  uuid := gen_random_uuid();
  v_g    uuid;
  v_ep   text;
  v_ng   int := 0;
  v_del  int := 0;
  v_anon int := 0;
  v_n    int;
  v_tab  text;
  v_col  text;
  v_left jsonb := '[]'::jsonb;
  v_auth boolean := false;
  v_err  text[] := '{}';
  -- columns that OWN a row: the row goes. Every other uuid column only points at the caller: it is anonymised.
  c_own constant text[] := array['user_id', 'blocker', 'blocked', 'voter', 'checker', 'from_uid', 'to_uid', 'old_uid',
                                 'used_by', 'target_uid', 'reporter'];
begin
  perform pg_advisory_xact_lock(hashtextextended('olnu_delete:' || v_uid::text, 0));

  -- 1. groups: leave every group the normal way (a group with nobody left goes away by the existing rule)
  for v_g in select gm.group_id from public.group_members gm where gm.user_id = v_uid loop
    begin perform public.leave_group(v_g); v_ng := v_ng + 1;
    exception when others then v_err := v_err || ('leave:' || sqlerrm); end;
  end loop;
  update public.groups g set created_by = null where g.created_by = v_uid;

  -- 2. push
  for v_ep in select ps.endpoint from public.push_subscriptions ps where ps.user_id = v_uid loop
    begin perform public.delete_push_subscription(v_ep); exception when others then null; end;
  end loop;
  delete from public.push_subscriptions ps where ps.user_id = v_uid;

  -- 3. rows that other rows point at (no ON DELETE CASCADE): clear the children first
  delete from public.bar_photo_reports r where r.bp_id in (select b.id from public.bar_photos b where b.user_id = v_uid);
  delete from public.walk_views w where w.walk_id in (select k.id from public.walks k where k.user_id = v_uid);
  delete from public.chat_photos c where c.msg_id in (select m.id from public.group_msgs m where m.user_id = v_uid);
  -- invites with other people's answers stay for them, without the caller's text
  update public.invites i set note = null, status = 'cancelled', updated_at = now() where i.creator = v_uid;

  -- 4. reports: reports BY the caller go; reports ABOUT the caller keep the moderation record, without the link
  delete from public.ugc_reports r where r.reporter = v_uid;
  update public.ugc_reports r set target = null where r.target = v_uid;

  -- 5. generic sweep over every public base table and uuid column (covers all the tables above and future ones)
  for v_tab, v_col in
    select c.table_name::text, c.column_name::text
      from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     where c.table_schema = 'public' and tb.table_type = 'BASE TABLE' and c.data_type = 'uuid'
       and c.column_name not in ('id', 'group_id', 'room_id')
     order by case when c.column_name = any (c_own) then 0 else 1 end, c.table_name, c.column_name
  loop
    begin
      if v_col = any (c_own) then
        execute format('delete from public.%I where %I = $1', v_tab, v_col) using v_uid;
        get diagnostics v_n = row_count; v_del := v_del + v_n;
      else
        execute format('update public.%I set %I = $1 where %I = $2', v_tab, v_col, v_col) using v_new, v_uid;
        get diagnostics v_n = row_count; v_anon := v_anon + v_n;
      end if;
    exception when others then
      -- a delete blocked by a foreign key, or a unique clash: anonymise instead, else set null
      begin
        execute format('update public.%I set %I = $1 where %I = $2', v_tab, v_col, v_col) using v_new, v_uid;
        get diagnostics v_n = row_count; v_anon := v_anon + v_n;
      exception when others then
        begin
          execute format('update public.%I set %I = null where %I = $1', v_tab, v_col, v_col) using v_uid;
        exception when others then v_err := v_err || (v_tab || '.' || v_col || ':' || sqlerrm);
        end;
      end;
    end;
  end loop;

  -- 6. friendships (a, b): the friendship itself is personal data of the caller → delete it
  delete from public.friendships f where f.a = v_new or f.b = v_new;
  get diagnostics v_n = row_count; v_del := v_del + v_n;

  -- 7. check: nothing in public may still hold the caller's id
  for v_tab, v_col in
    select c.table_name::text, c.column_name::text
      from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     where c.table_schema = 'public' and tb.table_type = 'BASE TABLE' and c.data_type = 'uuid'
  loop
    execute format('select count(*) from public.%I where %I = $1', v_tab, v_col) into v_n using v_uid;
    if v_n > 0 then v_left := v_left || jsonb_build_object('t', v_tab, 'c', v_col, 'n', v_n); end if;
  end loop;

  -- 8. the login itself (e-mail, identities, sessions)
  if jsonb_array_length(v_left) = 0 then
    begin
      delete from auth.users u where u.id = v_uid;
      v_auth := found;
    exception when others then v_err := v_err || ('auth:' || sqlerrm);
    end;
  end if;

  return jsonb_build_object('ok', jsonb_array_length(v_left) = 0, 'v', 2, 'groups_left', v_ng,
                            'deleted_rows', v_del, 'anonymised_rows', v_anon, 'auth_deleted', v_auth,
                            'left', v_left, 'errors', to_jsonb(v_err));
end; $function$;
