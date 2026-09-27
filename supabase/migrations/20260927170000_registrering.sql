-- =====================================================================
-- Mørvika Hytteområde · Hurtigregistrering av hytter og eiere
--
-- Administrator registrerer hytter og eiere før eierne har konto.
-- Eiere uten konto ligger som «ventende personer». Første gang en
-- ventende person logger inn med e-postadressen sin, blir kontoen laget,
-- og personen kobles automatisk til hyttene og rollene sine.
--
-- Bare registrerte e-postadresser slipper inn. Det styres av funksjonen
-- hook_before_user_created, som kobles til under
-- Authentication → Hooks → «Before User Created» i Supabase.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Nye felter på hytta
-- ---------------------------------------------------------------------
alter table public.cabins add column fnr int;
comment on column public.cabins.fnr is 'Festenummer';

-- Intern merknad som bare administrator ser
create table public.cabin_notes (
  cabin_id   uuid primary key references public.cabins (id) on delete cascade,
  note       text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.cabin_notes enable row level security;
create policy "admin: merknader" on public.cabin_notes for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
grant select, insert, update, delete on public.cabin_notes to authenticated;

-- ---------------------------------------------------------------------
-- Ventende personer (registrert, men ikke logget inn ennå)
-- ---------------------------------------------------------------------
create table public.pending_people (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null check (length(trim(full_name)) > 0),
  email      text,
  phone      text,
  roles      public.app_role[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null
);
create unique index pending_people_email on public.pending_people (lower(email)) where email is not null;

create table public.pending_cabin_owners (
  pending_id uuid not null references public.pending_people (id) on delete cascade,
  cabin_id   uuid not null references public.cabins (id) on delete cascade,
  primary key (pending_id, cabin_id)
);

alter table public.pending_people       enable row level security;
alter table public.pending_cabin_owners enable row level security;
create policy "admin: ventende"      on public.pending_people       for all to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
create policy "admin: ventende eiere" on public.pending_cabin_owners for all to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
grant select, insert, update, delete on public.pending_people, public.pending_cabin_owners to authenticated;

-- ---------------------------------------------------------------------
-- Aktivering: når kontoen lages, kobles personen til hytter og roller
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.pending_people;
begin
  select * into p from public.pending_people
   where email is not null and lower(email) = lower(new.email)
   limit 1;

  insert into public.profiles (id, full_name, email, phone)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), p.full_name, ''),
          new.email,
          coalesce(new.phone, p.phone));

  if not exists (select 1 from public.user_roles where role = 'admin') then
    insert into public.user_roles (user_id, role) values (new.id, 'admin'), (new.id, 'grunneier');
  end if;

  if p.id is not null then
    insert into public.user_roles (user_id, role)
      select new.id, unnest(p.roles) on conflict do nothing;
    insert into public.cabin_owners (cabin_id, user_id)
      select cabin_id, new.id from public.pending_cabin_owners where pending_id = p.id
      on conflict do nothing;
    delete from public.pending_people where id = p.id;
  end if;
  return new;
end;
$$;

-- Bare registrerte e-postadresser får lage konto
create function public.hook_before_user_created(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e text := lower(trim(event -> 'user' ->> 'email'));
begin
  if e is not null and (
       exists (select 1 from public.pending_people where lower(email) = e)
    or not exists (select 1 from public.user_roles where role = 'admin')) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Denne e-postadressen er ikke invitert. Kontakt styret eller grunneier.'));
end;
$$;
revoke all on function public.hook_before_user_created(jsonb) from anon, authenticated, public;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
grant select on public.pending_people, public.user_roles to supabase_auth_admin;

-- ---------------------------------------------------------------------
-- Funksjoner for administrator
-- ---------------------------------------------------------------------

-- Legg til eier på en hytte. Finnes det en konto med e-posten, kobles den
-- direkte. Ellers legges personen inn som ventende.
create function public.admin_add_owner(p_cabin uuid, p_name text, p_email text, p_phone text default null)
returns text language plpgsql security definer set search_path = public as $$
declare e text := nullif(lower(trim(coalesce(p_email, ''))), '');
        u uuid; pid uuid;
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator kan registrere eiere' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Navn mangler';
  end if;

  if e is not null then
    select id into u from public.profiles where lower(email) = e;
  end if;
  if u is not null then
    insert into public.cabin_owners (cabin_id, user_id) values (p_cabin, u) on conflict do nothing;
    return 'koblet';
  end if;

  if e is not null then
    select id into pid from public.pending_people where lower(email) = e;
  end if;
  if pid is null then
    insert into public.pending_people (full_name, email, phone)
    values (trim(p_name), e, nullif(trim(coalesce(p_phone, '')), ''))
    returning id into pid;
  end if;
  insert into public.pending_cabin_owners (pending_id, cabin_id) values (pid, p_cabin) on conflict do nothing;
  return 'venter';
end;
$$;

-- Fjern en eier (konto eller ventende) fra en hytte
create function public.admin_remove_owner(p_cabin uuid, p_person uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator kan fjerne eiere' using errcode = '42501';
  end if;
  delete from public.cabin_owners where cabin_id = p_cabin and user_id = p_person;
  delete from public.pending_cabin_owners where cabin_id = p_cabin and pending_id = p_person;
  -- Ventende uten hytter og uten roller trengs ikke lenger
  delete from public.pending_people p
   where p.id = p_person and cardinality(p.roles) = 0
     and not exists (select 1 from public.pending_cabin_owners where pending_id = p.id);
end;
$$;

-- Alle personer, med kontostatus, hytter og roller
create function public.admin_people()
returns table (
  id uuid, status text, full_name text, email text, phone text,
  roles public.app_role[], cabin_ids uuid[], last_seen_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator har tilgang' using errcode = '42501';
  end if;
  return query
    select p.id, 'aktiv'::text, p.full_name, p.email, p.phone,
           coalesce((select array_agg(r.role order by r.role) from public.user_roles r where r.user_id = p.id), '{}'),
           coalesce((select array_agg(o.cabin_id) from public.cabin_owners o where o.user_id = p.id), '{}'),
           p.last_seen_at, p.created_at
      from public.profiles p
    union all
    select q.id, case when q.email is null then 'mangler_epost' else 'venter' end,
           q.full_name, q.email, q.phone, q.roles,
           coalesce((select array_agg(c.cabin_id) from public.pending_cabin_owners c where c.pending_id = q.id), '{}'),
           null::timestamptz, q.created_at
      from public.pending_people q;
end;
$$;

-- Endre navn, e-post og mobil. E-post kan bare endres før personen har logget inn.
create function public.admin_update_person(p_person uuid, p_name text, p_email text, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
declare e text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator kan endre personer' using errcode = '42501';
  end if;
  if exists (select 1 from public.pending_people where id = p_person) then
    update public.pending_people
       set full_name = trim(p_name), email = e, phone = nullif(trim(coalesce(p_phone, '')), '')
     where id = p_person;
  else
    update public.profiles
       set full_name = trim(p_name), phone = nullif(trim(coalesce(p_phone, '')), '')
     where id = p_person;
  end if;
end;
$$;

-- Sett rollene til en person. Administrator kan ikke ta fra seg selv administratorrollen.
create function public.admin_set_roles(p_person uuid, p_roles public.app_role[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator kan endre roller' using errcode = '42501';
  end if;
  if p_person = auth.uid() and not ('admin' = any (p_roles)) then
    raise exception 'Du kan ikke fjerne din egen administratorrolle';
  end if;
  if exists (select 1 from public.pending_people where id = p_person) then
    update public.pending_people set roles = coalesce(p_roles, '{}') where id = p_person;
  else
    delete from public.user_roles where user_id = p_person and not (role = any (coalesce(p_roles, '{}')));
    insert into public.user_roles (user_id, role)
      select p_person, unnest(coalesce(p_roles, '{}')) on conflict do nothing;
  end if;
end;
$$;

-- Legg til en person uten hytte, for eksempel et styremedlem
create function public.admin_add_person(p_name text, p_email text, p_phone text, p_roles public.app_role[])
returns uuid language plpgsql security definer set search_path = public as $$
declare e text := nullif(lower(trim(coalesce(p_email, ''))), ''); u uuid;
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator kan legge til personer' using errcode = '42501';
  end if;
  if e is not null then
    select id into u from public.profiles where lower(email) = e;
    if u is not null then
      perform public.admin_set_roles(u, (select coalesce(array_agg(role), '{}') from public.user_roles where user_id = u) || coalesce(p_roles, '{}'));
      return u;
    end if;
    select id into u from public.pending_people where lower(email) = e;
    if u is not null then
      update public.pending_people set roles = (select array_agg(distinct x) from unnest(roles || coalesce(p_roles, '{}')) x) where id = u;
      return u;
    end if;
  end if;
  insert into public.pending_people (full_name, email, phone, roles)
  values (trim(p_name), e, nullif(trim(coalesce(p_phone, '')), ''), coalesce(p_roles, '{}'))
  returning id into u;
  return u;
end;
$$;

revoke all on function
  public.admin_add_owner(uuid, text, text, text), public.admin_remove_owner(uuid, uuid),
  public.admin_people(), public.admin_update_person(uuid, text, text, text),
  public.admin_set_roles(uuid, public.app_role[]), public.admin_add_person(text, text, text, public.app_role[])
from anon, public;
grant execute on function
  public.admin_add_owner(uuid, text, text, text), public.admin_remove_owner(uuid, uuid),
  public.admin_people(), public.admin_update_person(uuid, text, text, text),
  public.admin_set_roles(uuid, public.app_role[]), public.admin_add_person(text, text, text, public.app_role[])
to authenticated;
