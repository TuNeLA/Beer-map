-- UNDO for staging-testkit.sql (STAGING ONLY): puts back the original bodies of the 11 changed functions.
-- The test kit tables and zz_test_* functions stay (unused). No row-removing or object-removing statement.
do $guard$
begin
  if to_regnamespace('staging_tools') is null then
    raise exception 'staging-testkit-undo.sql: this is NOT the staging project. Nothing was changed.';
  end if;
end $guard$;

create or replace function public.olnu_crew_now()
returns timestamptz language sql stable set search_path to 'public' as $$
  select coalesce(nullif(current_setting('olnu.crew_now', true), '')::timestamptz, now());
$$;
create or replace function public.olnu_after_on(p_key text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select f.on_ from public.after_flags f where f.key = p_key), false);
$$;
create or replace function public.after_flags_get()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('v', 1, 'flags', coalesce((select jsonb_object_agg(f.key, f.on_) from public.after_flags f), '{}'::jsonb));
$$;
create or replace function public.olnu_ride_flag(p_key text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select f.on_ from public.ride_flags f where f.key = p_key), false);
$$;
create or replace function public.ride_flags_get()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_object_agg(f.key, f.on_), '{}'::jsonb) from public.ride_flags f;
$$;
create or replace function public.olnu_bold_on(p_key text)
returns boolean language sql stable security definer set search_path to 'public' as $$ select coalesce((select f.on_ from public.bold_flags f where f.key = p_key), false); $$;
create or replace function public.bold_flags_get()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_object_agg(f.key, f.on_), '{}'::jsonb) from public.bold_flags f;
$$;
create or replace function public.ntf_bold_on(p_key text)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare v boolean;
begin
  if to_regclass('public.bold_flags') is null then return false; end if;
  execute 'select on_ from public.bold_flags where key = $1' into v using p_key;
  return coalesce(v, false);
exception when others then return false;
end $$;
create or replace function public.push_v2_on(p_key text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select f.on_ from public.push_v2_flags f where f.key = p_key), false)
$$;
create or replace function public.push_v2_flags_get()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_object_agg(f.key, f.on_), '{}'::jsonb) from public.push_v2_flags f
$$;
create or replace function public.account_config()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'v', 1,
    'email', coalesce((select f.enabled from public.app_account_flags f where f.key = 'email_login'), false),
    'google', coalesce((select f.enabled from public.app_account_flags f where f.key = 'google_login'), false)
  );
$$;
