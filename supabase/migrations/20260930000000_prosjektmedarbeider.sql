-- =====================================================================
-- Mørvika Hytteområde · Prosjektmedarbeidere (håndverkere på byggeprosjekt)
--
--   * Administrator knytter en håndverker til én eller flere hytter
--     (Rediger hytta → Prosjektmedarbeidere).
--   * Medarbeideren ser BARE Min hytte for prosjektene sine: dokumenter,
--     album og bilder. Ikke hytteregnskap, Hyttepraten, nyheter, varsler
--     eller registeret.
--   * Medarbeideren kan laste opp dokumenter og bilder (også i albumene for
--     byggetrinnene) og slette eller endre bare det hen selv har lastet opp.
--   * Hvert bilde og dokument viser hvem som lastet det opp, og når.
--   * Tilgangen forsvinner ved eierskifte/overlevering, eller når
--     administrator fjerner personen.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

create table public.cabin_workers (
  cabin_id   uuid not null references public.cabins (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  added_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (cabin_id, user_id)
);
create table public.pending_cabin_workers (
  pending_id uuid not null references public.pending_people (id) on delete cascade,
  cabin_id   uuid not null references public.cabins (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (pending_id, cabin_id)
);
alter table public.cabin_workers         enable row level security;
alter table public.pending_cabin_workers enable row level security;
create policy "se prosjekttilgang" on public.cabin_workers for select to authenticated
  using (user_id = auth.uid() or public.has_role('admin'));
create policy "admin: ventende medarbeidere" on public.pending_cabin_workers for select to authenticated
  using (public.has_role('admin'));
grant select on public.cabin_workers, public.pending_cabin_workers to authenticated;

-- Hvem lastet opp bildet (dokumenter har dette fra før)
alter table public.cabin_photos add column uploaded_by uuid default auth.uid() references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------
-- Tilgang
-- ---------------------------------------------------------------------
-- Prosjektmedarbeider på hytta i en åpen eierperiode
create function public.is_cabin_worker(w uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.ownerships p
    join public.cabins c on c.id = p.cabin_id
    join public.cabin_workers k on k.cabin_id = p.cabin_id
    where p.id = w and p.ends_on is null and c.access = 'full' and k.user_id = auth.uid());
$$;

-- Dokumenter: se alle, lagre nye, endre og slette egne
create policy "medarbeider: les dokumenter"    on public.cabin_documents for select to authenticated using (public.is_cabin_worker(ownership_id));
create policy "medarbeider: lagre dokumenter"  on public.cabin_documents for insert to authenticated
  with check (public.is_cabin_worker(ownership_id) and uploaded_by = auth.uid());
create policy "medarbeider: endre dokumenter"  on public.cabin_documents for update to authenticated
  using (public.is_cabin_worker(ownership_id) and uploaded_by = auth.uid())
  with check (public.is_cabin_worker(ownership_id) and uploaded_by = auth.uid());
create policy "medarbeider: slette dokumenter" on public.cabin_documents for delete to authenticated
  using (public.is_cabin_worker(ownership_id) and uploaded_by = auth.uid());

-- Album: bare se (eieren lager album, f.eks. med FDV-malen)
create policy "medarbeider: les album" on public.cabin_albums for select to authenticated using (public.is_cabin_worker(ownership_id));

-- Bilder: se alle, lagre nye, endre og slette egne
create policy "medarbeider: les bilder"    on public.cabin_photos for select to authenticated using (public.is_cabin_worker(ownership_id));
create policy "medarbeider: lagre bilder"  on public.cabin_photos for insert to authenticated
  with check (public.is_cabin_worker(ownership_id) and uploaded_by = auth.uid());
create policy "medarbeider: endre bilder"  on public.cabin_photos for update to authenticated
  using (public.is_cabin_worker(ownership_id) and uploaded_by = auth.uid())
  with check (public.is_cabin_worker(ownership_id) and uploaded_by = auth.uid());
create policy "medarbeider: slette bilder" on public.cabin_photos for delete to authenticated
  using (public.is_cabin_worker(ownership_id) and uploaded_by = auth.uid());

-- Filer: laste opp i prosjektets mappe, se og slette egne filer der.
-- (Filer som dokumenter og bilder peker på, kan leses fra før.)
create policy "hytte: medarbeider laster opp" on storage.objects for insert to authenticated with check (
  bucket_id = 'hytte' and public.is_cabin_worker(public.try_uuid((storage.foldername(name))[1])));
create policy "hytte: medarbeider ser egne" on storage.objects for select to authenticated using (
  bucket_id = 'hytte' and (owner_id = auth.uid()::text or owner = auth.uid()) and public.is_cabin_worker(public.try_uuid((storage.foldername(name))[1])));
create policy "hytte: medarbeider sletter egne" on storage.objects for delete to authenticated using (
  bucket_id = 'hytte' and (owner_id = auth.uid()::text or owner = auth.uid()) and public.is_cabin_worker(public.try_uuid((storage.foldername(name))[1])));

-- ---------------------------------------------------------------------
-- For appen
-- ---------------------------------------------------------------------
-- Prosjektene jeg er medarbeider på
create function public.my_worker_cabins()
returns table (cabin_id uuid, label text, number int, gnr int, bnr int, ownership_id uuid, fdv boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.label, c.number, c.gnr, c.bnr, w.id, w.fdv
    from public.cabin_workers k
    join public.cabins c on c.id = k.cabin_id and c.access = 'full'
    join public.ownerships w on w.cabin_id = c.id and w.ends_on is null
   where k.user_id = auth.uid()
   order by c.area, c.number;
$$;

-- Navn på dem som har lastet opp noe i Min hytte (eiere og medarbeidere)
create function public.ownership_uploaders(w uuid)
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name from public.profiles p
   where (public.can_read_ownership(w) or public.is_cabin_worker(w))
     and (p.id in (select uploaded_by from public.cabin_documents where ownership_id = w)
       or p.id in (select uploaded_by from public.cabin_photos where ownership_id = w));
$$;

-- ---------------------------------------------------------------------
-- Administrator
-- ---------------------------------------------------------------------
create function public.admin_add_worker(p_cabin uuid, p_name text, p_email text, p_phone text default null)
returns text language plpgsql security definer set search_path = public as $$
declare e text := nullif(lower(trim(coalesce(p_email, ''))), ''); u uuid; pid uuid;
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator kan legge til prosjektmedarbeidere' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Navn mangler'; end if;
  if e is null then raise exception 'E-post mangler (brukes til innlogging)'; end if;
  if not exists (select 1 from public.cabins where id = p_cabin and access = 'full') then
    raise exception 'Prosjektmedarbeidere kan bare legges til hytter med full tilgang';
  end if;
  -- Sørg for at hytta har en åpen eierperiode som filene kan høre til
  if not exists (select 1 from public.ownerships where cabin_id = p_cabin and ends_on is null) then
    insert into public.ownerships (cabin_id) values (p_cabin);
  end if;

  select id into u from public.profiles where lower(email) = e;
  if u is not null then
    insert into public.cabin_workers (cabin_id, user_id) values (p_cabin, u) on conflict do nothing;
    return 'koblet';
  end if;
  select id into pid from public.pending_people where lower(email) = e;
  if pid is null then
    insert into public.pending_people (full_name, email, phone)
    values (trim(p_name), e, nullif(trim(coalesce(p_phone, '')), '')) returning id into pid;
  end if;
  insert into public.pending_cabin_workers (pending_id, cabin_id) values (pid, p_cabin) on conflict do nothing;
  return 'venter';
end;
$$;

-- Ventende uten hytter, roller eller prosjekter trengs ikke lenger
create function public.cleanup_pending_people()
returns void language sql security definer set search_path = public as $$
  delete from public.pending_people q
   where cardinality(q.roles) = 0
     and not exists (select 1 from public.pending_cabin_owners  where pending_id = q.id)
     and not exists (select 1 from public.pending_cabin_workers where pending_id = q.id);
$$;
revoke all on function public.cleanup_pending_people() from anon, authenticated, public;

create function public.admin_remove_worker(p_cabin uuid, p_person uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator kan fjerne prosjektmedarbeidere' using errcode = '42501';
  end if;
  delete from public.cabin_workers         where cabin_id = p_cabin and user_id = p_person;
  delete from public.pending_cabin_workers where cabin_id = p_cabin and pending_id = p_person;
  perform public.cleanup_pending_people();
end;
$$;

-- Fjerne eier: rydd ventende, men behold dem som er prosjektmedarbeidere
create or replace function public.admin_remove_owner(p_cabin uuid, p_person uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator kan fjerne eiere' using errcode = '42501';
  end if;
  delete from public.cabin_owners where cabin_id = p_cabin and user_id = p_person;
  delete from public.pending_cabin_owners where cabin_id = p_cabin and pending_id = p_person;
  perform public.cleanup_pending_people();
end;
$$;

-- Ny innlogging: ventende prosjekttilgang kobles også til kontoen
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
    -- Behold registreringsrekkefølgen og hvem som er SMS-kontakt
    insert into public.cabin_owners (cabin_id, user_id, created_at, sms_contact)
      select cabin_id, new.id, created_at, sms_contact from public.pending_cabin_owners where pending_id = p.id
      on conflict do nothing;
    insert into public.cabin_workers (cabin_id, user_id, created_at)
      select cabin_id, new.id, created_at from public.pending_cabin_workers where pending_id = p.id
      on conflict do nothing;
    delete from public.pending_people where id = p.id;
  end if;
  return new;
end;
$$;

-- Personlisten får med hvilke prosjekter personen er medarbeider på
drop function public.admin_people();
create function public.admin_people()
returns table (
  id uuid, status text, full_name text, email text, phone text,
  roles public.app_role[], cabin_ids uuid[], last_seen_at timestamptz, created_at timestamptz, sms_cabin_ids uuid[],
  worker_cabin_ids uuid[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator har tilgang' using errcode = '42501';
  end if;
  return query
    select p.id, 'aktiv'::text, p.full_name, p.email, p.phone,
           coalesce((select array_agg(r.role order by r.role) from public.user_roles r where r.user_id = p.id), '{}'),
           coalesce((select array_agg(o.cabin_id order by o.created_at) from public.cabin_owners o where o.user_id = p.id), '{}'),
           p.last_seen_at, p.created_at,
           coalesce((select array_agg(o.cabin_id) from public.cabin_owners o where o.user_id = p.id and o.sms_contact), '{}'),
           coalesce((select array_agg(k.cabin_id order by k.created_at) from public.cabin_workers k where k.user_id = p.id), '{}')
      from public.profiles p
    union all
    select q.id, case when q.email is null then 'mangler_epost' else 'venter' end,
           q.full_name, q.email, q.phone, q.roles,
           coalesce((select array_agg(c.cabin_id order by c.created_at) from public.pending_cabin_owners c where c.pending_id = q.id), '{}'),
           null::timestamptz, q.created_at,
           coalesce((select array_agg(c.cabin_id) from public.pending_cabin_owners c where c.pending_id = q.id and c.sms_contact), '{}'),
           coalesce((select array_agg(k.cabin_id order by k.created_at) from public.pending_cabin_workers k where k.pending_id = q.id), '{}')
      from public.pending_people q;
end;
$$;

-- ---------------------------------------------------------------------
-- Eierskifte: prosjektmedarbeiderne mister tilgangen
-- ---------------------------------------------------------------------
drop function public.admin_transfer(uuid, date, public.transfer_kind, jsonb, text, boolean);
create function public.admin_transfer(
  p_cabin uuid, p_date date, p_kind public.transfer_kind, p_owners jsonb, p_note text default '', p_builder boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  old_w uuid; new_w uuid; t uuid; formers uuid[]; o jsonb; e text; u uuid; pid uuid; n int := 0;
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator kan registrere eierskifte' using errcode = '42501';
  end if;
  if p_date is null then raise exception 'Dato mangler'; end if;
  select count(*) into n from jsonb_array_elements(coalesce(p_owners, '[]'::jsonb)) x where coalesce(trim(x ->> 'name'), '') <> '';
  if n = 0 then raise exception 'Eierskiftet må ha minst én ny eier'; end if;

  -- Lukk perioden til dagens eiere (eller lag en tom periode hvis ingen har logget inn)
  select id into old_w from public.ownerships where cabin_id = p_cabin and ends_on is null;
  if old_w is null then
    insert into public.ownerships (cabin_id, starts_on, ends_on, access_until)
    values (p_cabin, p_date, p_date, p_date) returning id into old_w;
  else
    select coalesce(array_agg(user_id), '{}') into formers from public.cabin_owners where ownership_id = old_w;
    update public.ownerships
       set ends_on = greatest(p_date, starts_on), access_until = greatest(p_date, starts_on) + 90, former_owner_ids = formers
     where id = old_w;
  end if;

  -- Fjern gamle eiere (også de som aldri logget inn) og prosjektmedarbeiderne
  delete from public.cabin_owners where cabin_id = p_cabin;
  delete from public.pending_cabin_owners where cabin_id = p_cabin;
  delete from public.cabin_workers where cabin_id = p_cabin;
  delete from public.pending_cabin_workers where cabin_id = p_cabin;
  perform public.cleanup_pending_people();

  -- Ny periode og nye eiere (FDV-malen følger med ved overlevering fra utbygger)
  insert into public.ownerships (cabin_id, starts_on, fdv)
  values (p_cabin, p_date, coalesce(p_builder, false) and coalesce((select fdv from public.ownerships where id = old_w), false))
  returning id into new_w;
  for o in select * from jsonb_array_elements(p_owners) loop
    continue when coalesce(trim(o ->> 'name'), '') = '';
    e := nullif(lower(trim(coalesce(o ->> 'email', ''))), '');
    u := null; pid := null;
    if e is not null then select id into u from public.profiles where lower(email) = e; end if;
    if u is not null then
      insert into public.cabin_owners (cabin_id, user_id) values (p_cabin, u) on conflict do nothing;
    else
      if e is not null then select id into pid from public.pending_people where lower(email) = e; end if;
      if pid is null then
        insert into public.pending_people (full_name, email, phone)
        values (trim(o ->> 'name'), e, nullif(trim(coalesce(o ->> 'phone', '')), '')) returning id into pid;
      end if;
      insert into public.pending_cabin_owners (pending_id, cabin_id) values (pid, p_cabin) on conflict do nothing;
    end if;
  end loop;

  insert into public.ownership_transfers (cabin_id, from_ownership, to_ownership, kind, transfer_date, note, from_builder)
  values (p_cabin, old_w, new_w, p_kind, p_date, coalesce(p_note, ''), coalesce(p_builder, false)) returning id into t;

  -- Overlevering fra utbygger: dokumenter, bilder og album går til kjøper med en gang
  if coalesce(p_builder, false) then
    update public.cabin_albums    set ownership_id = new_w where ownership_id = old_w;
    update public.cabin_documents set ownership_id = new_w where ownership_id = old_w;
    update public.cabin_photos    set ownership_id = new_w where ownership_id = old_w;
    update public.ownership_transfers set full_transfer_at = now() where id = t;
  end if;
  return t;
end;
$$;

revoke all on function
  public.is_cabin_worker(uuid), public.my_worker_cabins(), public.ownership_uploaders(uuid),
  public.admin_add_worker(uuid, text, text, text), public.admin_remove_worker(uuid, uuid),
  public.admin_remove_owner(uuid, uuid), public.admin_people(),
  public.admin_transfer(uuid, date, public.transfer_kind, jsonb, text, boolean)
from anon, public;
grant execute on function
  public.is_cabin_worker(uuid), public.my_worker_cabins(), public.ownership_uploaders(uuid),
  public.admin_add_worker(uuid, text, text, text), public.admin_remove_worker(uuid, uuid),
  public.admin_remove_owner(uuid, uuid), public.admin_people(),
  public.admin_transfer(uuid, date, public.transfer_kind, jsonb, text, boolean)
to authenticated;
