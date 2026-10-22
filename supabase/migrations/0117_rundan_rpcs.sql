-- 0117 RUNDAN RPCs: Swish number, the group's nota (balances), add an expense (+ chat card), payments.
-- Needs 0116 (rnd_* tables + helpers), group_members, group_msgs, beers, gang_swish (0026), olnu_night_of (0012).
-- All: SECURITY DEFINER, search_path public, olnu_uid(), authenticated only (grants in 0118). Safe to run again.

-- rnd_set_swish(number) -> {number}. Swedish mobile only (07xxxxxxxx; spaces, dashes, +46/0046 ok). '' clears.
create or replace function public.rnd_set_swish(p_number text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v text := public.olnu_rnd_swish_norm(p_number);
  v_today date := (now() at time zone 'Europe/Stockholm')::date;
  r public.rnd_swish;
begin
  if v is null then raise exception 'invalid_swish'; end if;
  if v = '' then v := null; end if;
  select * into r from public.rnd_swish s where s.user_id = v_uid for update;
  if found and r.day = v_today and r.day_changes >= 10 then raise exception 'slow_down'; end if;
  insert into public.rnd_swish (user_id, number, changes, day, day_changes) values (v_uid, v, 1, v_today, 1)
  on conflict (user_id) do update set number = excluded.number, changes = public.rnd_swish.changes + 1,
    day_changes = case when public.rnd_swish.day = v_today then public.rnd_swish.day_changes + 1 else 1 end,
    day = v_today, updated_at = now();
  return jsonb_build_object('number', v);
end; $$;

-- rnd_group(group) -> the group's nota: members (+ out tonight, Swish number, net), recent expenses, payments.
create or replace function public.rnd_group(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not public.olnu_rnd_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  return jsonb_build_object(
    'v', 1, 'server_time', now(), 'night', public.olnu_night_of(now()),
    'me', public.olnu_rnd_k(p_group_id, v_uid),
    'my_swish', (select s.number from public.rnd_swish s where s.user_id = v_uid),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'k', public.olnu_rnd_k(p_group_id, m.user_id), 'name', m.display_name, 'is_me', m.user_id = v_uid,
        'out', exists (select 1 from public.beers b where b.user_id = m.user_id and b.expires_at > now() and not coalesce(b.stopped, false)),
        'swish', public.olnu_rnd_swish_of(p_group_id, m.user_id),
        'paid_n', public.olnu_rnd_paid_n(p_group_id, m.user_id),
        'net', public.olnu_rnd_net(p_group_id, m.user_id)) order by m.joined_at)
      from public.group_members m where m.group_id = p_group_id), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(public.olnu_rnd_exp_json(x, v_uid) order by x.id desc) from (
        select e.* from public.rnd_expenses e
         where e.group_id = p_group_id and e.created_at > now() - interval '14 days'
         order by e.id desc limit 40) x), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'from', public.olnu_rnd_k(p_group_id, p.from_user), 'from_name', public.olnu_rnd_name(p_group_id, p.from_user),
        'to', public.olnu_rnd_k(p_group_id, p.to_user), 'to_name', public.olnu_rnd_name(p_group_id, p.to_user),
        'amount', p.amount, 'expense_id', p.expense_id, 'created_at', p.created_at,
        'confirmed', p.confirmed_at is not null, 'rejected', p.rejected_at is not null,
        'from_me', p.from_user = v_uid, 'to_me', p.to_user = v_uid,
        'can_undo', p.created_by = v_uid and p.confirmed_at is null and p.rejected_at is null and p.created_at > now() - interval '24 hours',
        'can_confirm', p.to_user = v_uid and p.confirmed_at is null and p.rejected_at is null) order by p.id desc)
      from (select * from public.rnd_payments q
             where q.group_id = p_group_id and q.cancelled_at is null and q.created_at > now() - interval '14 days'
             order by q.id desc limit 40) p), '[]'::jsonb));
end; $$;

-- rnd_add(group, kind, payer k|null, total, shares [{k, amount}], items, what) -> {id, msg_id}
-- One chat card per expense: a normal group_msgs row ("💸 Anton bjöd på 4 öl · 72 kr var"); old apps show the text.
create or replace function public.rnd_add(p_group_id uuid, p_kind text, p_payer text, p_total int, p_shares jsonb,
                                          p_items int default 0, p_what text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_payer uuid;
  v_kind text := coalesce(p_kind, 'round');
  v_what text := left(public.olnu_rnd_clean(p_what), 40);
  v_items int := greatest(0, least(99, coalesce(p_items, 0)));
  v_sum int := 0; v_n int := 0; v_eq int := null; v_first int := null; v_same boolean := true;
  x jsonb; v_t uuid; v_a int; v_seen uuid[] := '{}';
  v_id bigint; v_msg bigint; v_name text; v_body text; v_amt text;
begin
  if not public.olnu_rnd_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if v_kind not in ('round', 'taxi', 'other') then raise exception 'invalid_split'; end if;
  if coalesce(p_payer, '') = '' then v_payer := v_uid;
  else v_payer := public.olnu_rnd_uid_of(p_group_id, p_payer);
       if v_payer is null then raise exception 'invalid_member'; end if;
  end if;
  if p_total is null or p_total < 1 or p_total > 50000 then raise exception 'invalid_split'; end if;
  if p_shares is null or jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) < 1 or jsonb_array_length(p_shares) > 20 then
    raise exception 'invalid_split';
  end if;
  for x in select * from jsonb_array_elements(p_shares) loop
    v_t := public.olnu_rnd_uid_of(p_group_id, x->>'k');
    begin v_a := (x->>'amount')::int; exception when others then v_a := null; end;
    if v_t is null then raise exception 'invalid_member'; end if;
    if v_t = v_payer or v_t = any(v_seen) or v_a is null or v_a < 1 or v_a > 50000 then raise exception 'invalid_split'; end if;
    v_seen := v_seen || v_t; v_sum := v_sum + v_a; v_n := v_n + 1;
    if v_first is null then v_first := v_a; elsif v_first <> v_a then v_same := false; end if;
  end loop;
  if v_sum > p_total then raise exception 'invalid_split'; end if;
  if v_same then v_eq := v_first; end if;
  if v_what = '' then v_what := case v_kind when 'round' then 'Rundan' when 'taxi' then 'Taxin' else 'Notan' end; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_rnd:' || v_uid::text, 0));
  if exists (select 1 from public.rnd_expenses e where e.created_by = v_uid and e.created_at > now() - interval '5 seconds')
     or (select count(*) from public.rnd_expenses e where e.created_by = v_uid and e.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'slow_down';
  end if;
  v_name := public.olnu_rnd_name(p_group_id, v_payer);
  v_amt := case when v_eq is not null then v_eq::text || ' kr var' else p_total::text || ' kr' end;
  v_body := case v_kind
    when 'round' then '💸 ' || v_name || ' bjöd på ' || case when v_items > 0 then v_items::text || ' öl' else lower(v_what) end || ' · ' || v_amt
    when 'taxi'  then '🚕 ' || v_name || ' tog taxin · ' || v_amt
    else '🧾 ' || v_name || ' betalade ' || v_what || ' · ' || v_amt end;
  v_body := left(v_body, 140);
  insert into public.group_msgs (group_id, user_id, body, expires_at)
  values (p_group_id, v_uid, v_body, public.olnu_next_expiry()) returning id into v_msg;
  insert into public.rnd_expenses (group_id, created_by, payer, kind, what, items, total, equal_share, msg_id, night)
  values (p_group_id, v_uid, v_payer, v_kind, v_what, v_items, p_total, v_eq, v_msg, public.olnu_night_of(now()))
  returning id into v_id;
  for x in select * from jsonb_array_elements(p_shares) loop
    insert into public.rnd_shares (expense_id, user_id, amount)
    values (v_id, public.olnu_rnd_uid_of(p_group_id, x->>'k'), (x->>'amount')::int);
  end loop;
  return jsonb_build_object('id', v_id, 'msg_id', v_msg, 'body', v_body, 'equal_share', v_eq);
end; $$;

-- rnd_pay(group, to k, amount, expense_id|null, from k|null) -> {id}
-- From = me (I swished / paid). Or the receiver writes down cash from someone (from = them, to = me): confirmed at once.
create or replace function public.rnd_pay(p_group_id uuid, p_to text, p_amount int, p_expense_id bigint default null, p_from text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  v_to uuid; v_from uuid; v_id bigint;
begin
  if not public.olnu_rnd_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  v_to := public.olnu_rnd_uid_of(p_group_id, p_to);
  if v_to is null then raise exception 'invalid_member'; end if;
  if coalesce(p_from, '') = '' then v_from := v_uid;
  else v_from := public.olnu_rnd_uid_of(p_group_id, p_from);
       if v_from is null then raise exception 'invalid_member'; end if;
  end if;
  if v_from <> v_uid and v_to <> v_uid then raise exception 'not_yours'; end if;
  if v_from = v_to then raise exception 'invalid_amount'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 50000 then raise exception 'invalid_amount'; end if;
  if p_expense_id is not null and not exists (select 1 from public.rnd_expenses e
       where e.id = p_expense_id and e.group_id = p_group_id and e.cancelled_at is null) then
    raise exception 'expense_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_rnd_pay:' || v_uid::text, 0));
  if exists (select 1 from public.rnd_payments p where p.created_by = v_uid and p.created_at > now() - interval '2 seconds')
     or (select count(*) from public.rnd_payments p where p.created_by = v_uid and p.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'slow_down';
  end if;
  -- Same expense paid twice by the same person: keep the first one.
  if p_expense_id is not null then
    select p.id into v_id from public.rnd_payments p
     where p.expense_id = p_expense_id and p.from_user = v_from and p.to_user = v_to and p.cancelled_at is null and p.rejected_at is null
     limit 1;
    if v_id is not null then return jsonb_build_object('id', v_id, 'again', true); end if;
  end if;
  insert into public.rnd_payments (group_id, from_user, to_user, amount, expense_id, created_by, confirmed_at)
  values (p_group_id, v_from, v_to, p_amount, p_expense_id, v_uid, case when v_to = v_uid then now() end)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end; $$;

-- rnd_payment(id, 'confirm'|'reject'|'undo') -> {ok}. confirm/reject = the receiver; undo = who wrote it, 24 h, not confirmed.
create or replace function public.rnd_payment(p_payment_id bigint, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  p public.rnd_payments;
begin
  select * into p from public.rnd_payments x where x.id = p_payment_id and x.cancelled_at is null for update;
  if not found or not public.olnu_rnd_member(p.group_id, v_uid) then raise exception 'payment_not_found'; end if;
  if p_action = 'confirm' then
    if p.to_user <> v_uid then raise exception 'not_yours'; end if;
    update public.rnd_payments x set confirmed_at = coalesce(x.confirmed_at, now()), rejected_at = null where x.id = p.id;
  elsif p_action = 'reject' then
    if p.to_user <> v_uid then raise exception 'not_yours'; end if;
    if p.confirmed_at is not null and p.confirmed_at < now() - interval '24 hours' then raise exception 'too_late'; end if;
    update public.rnd_payments x set rejected_at = now(), confirmed_at = null where x.id = p.id;
  elsif p_action = 'undo' then
    if p.created_by <> v_uid then raise exception 'not_yours'; end if;
    if p.created_at < now() - interval '24 hours' or (p.confirmed_at is not null and p.to_user <> v_uid) then raise exception 'too_late'; end if;
    update public.rnd_payments x set cancelled_at = now() where x.id = p.id;
  else
    raise exception 'invalid_action';
  end if;
  return jsonb_build_object('ok', true);
end; $$;

-- rnd_cancel(expense) -> {ok}. Who wrote it or who paid. The chat card then says "struken".
create or replace function public.rnd_cancel(p_expense_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid();
  e public.rnd_expenses;
begin
  select * into e from public.rnd_expenses x where x.id = p_expense_id for update;
  if not found or not public.olnu_rnd_member(e.group_id, v_uid) then raise exception 'expense_not_found'; end if;
  if e.created_by <> v_uid and e.payer <> v_uid then raise exception 'not_yours'; end if;
  if e.cancelled_at is null then
    update public.rnd_expenses x set cancelled_at = now(), cancelled_by = v_uid where x.id = e.id;
    -- Payments already made stay: money that moved still counts in the balance.
  end if;
  return jsonb_build_object('ok', true);
end; $$;
