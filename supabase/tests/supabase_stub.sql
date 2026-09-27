-- Minimal etterligning av Supabase (auth, storage, roller) for lokal testing.
-- Brukes bare av supabase/tests/run.sh, aldri i Supabase.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role supabase_auth_admin nologin; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key, email text, phone text, raw_user_meta_data jsonb not null default '{}');
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets, name text not null, owner uuid default auth.uid());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to authenticated;
grant select, insert, delete on storage.objects to authenticated;
grant execute on function storage.foldername(text) to authenticated;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
-- pg_net: signalene samles i en tabell i stedet for å sendes
create schema extensions;
create schema net;
create table net.calls (id bigserial primary key, url text, body jsonb);
create function net.http_post(url text, body jsonb, headers jsonb) returns bigint language sql as
  $$ insert into net.calls (url, body) values (url, body) returning id $$;
grant usage on schema net to authenticated;
grant insert on net.calls to authenticated;
grant usage on sequence net.calls_id_seq to authenticated;
