-- Minimal stand-in for the parts of Supabase the migrations rely on.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '')
$$;
grant usage on schema auth to authenticated, anon, service_role;
grant execute on function auth.uid(), auth.role() to authenticated, anon, service_role;

-- Supabase hands out broad default privileges in public; mimic that so the migrations' revokes are tested.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Storage stub (just enough to exercise 0004).
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:cardinality(string_to_array(name, '/'))-1]
$$;
grant usage on schema storage to authenticated, anon;
grant select, insert on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

-- Realtime publication stub.
create publication supabase_realtime;

-- Test helpers.
create schema t;
grant usage on schema t to public;
create function t.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function t.as_postgres() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
-- Runs p_sql and asserts it fails with a message matching p_like.
create function t.throws(p_sql text, p_like text default '%') returns void language plpgsql as $$
declare v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like p_like then return; end if;
    raise exception 'ASSERT: wrong error for [%]: got "%", wanted like "%"', p_sql, v_msg, p_like;
  end;
  raise exception 'ASSERT: expected an error but none was raised for [%] (wanted like "%")', p_sql, p_like;
end $$;
grant execute on all functions in schema t to public;
