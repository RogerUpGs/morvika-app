-- =====================================================================
-- Mørvika Hytteområde · Eierperioder, eierskifte og hyttearkiv
--
-- Min hytte hører til en EIERPERIODE for hytta, ikke bare til hytta.
-- Medeiere i samme periode deler Min hytte. Ved eierskifte:
--   * perioden lukkes, og de tidligere eierne kan lese (ikke endre) sine
--     data i 90 dager
--   * ny eier starter med tom Min hytte
--   * selgeren kan velge dokumenter og bilder som skal følge hytta
--   * ved overdragelse i familien kan selgeren godkjenne «Overfør alt»
-- Hyttearkivet følger hytta: grunneier legger inn (festekontrakt o.l.),
-- nåværende eiere kan lese. Tidligere eiere ser det ikke.
--
-- Sletting av data etter 90 dager gjøres av en planlagt jobb som lages
-- sammen med Min hytte (fase 4). Fristen lagres i ownerships.access_until.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

create type public.transfer_kind as enum ('salg', 'familie');

-- ---------------------------------------------------------------------
-- Eierperioder
-- ---------------------------------------------------------------------
create table public.ownerships (
  id               uuid primary key default gen_random_uuid(),
  cabin_id         uuid not null references public.cabins (id) on delete cascade,
  starts_on        date not null default current_date,
  ends_on          date,
  access_until     date,                       -- tidligere eiere kan lese til og med denne datoen
  former_owner_ids uuid[] not null default '{}',
  created_at       timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create unique index ownerships_one_open_per_cabin on public.ownerships (cabin_id) where ends_on is null;

alter table public.cabin_owners add column ownership_id uuid references public.ownerships (id);

-- Eksisterende eiere får en åpen periode
insert into public.ownerships (cabin_id)
  select distinct cabin_id from public.cabin_owners;
update public.cabin_owners o set ownership_id = w.id
  from public.ownerships w where w.cabin_id = o.cabin_id and w.ends_on is null;
alter table public.cabin_owners alter column ownership_id set not null;

-- Nye eiere havner automatisk i hyttas åpne periode (opprettes ved behov)
create function public.cabin_owner_set_ownership()
returns trigger language plpgsql security definer set search_path = public as $$
declare w uuid;
begin
  select id into w from public.ownerships where cabin_id = new.cabin_id and ends_on is null;
  if w is null then
    insert into public.ownerships (cabin_id) values (new.cabin_id) returning id into w;
  end if;
  new.ownership_id := w;
  return new;
end;
$$;
create trigger cabin_owner_ownership before insert on public.cabin_owners
  for each row execute function public.cabin_owner_set_ownership();

-- ---------------------------------------------------------------------
-- Eierskifter
-- ---------------------------------------------------------------------
create table public.ownership_transfers (
  id                  uuid primary key default gen_random_uuid(),
  cabin_id            uuid not null references public.cabins (id) on delete cascade,
  from_ownership      uuid not null references public.ownerships (id),
  to_ownership        uuid not null references public.ownerships (id),
  kind                public.transfer_kind not null,
  transfer_date       date not null,
  full_transfer_at    timestamptz,             -- når selgeren godkjente «Overfør alt»
  note                text not null default '',
  created_by          uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Tilgang til en eierperiode
-- ---------------------------------------------------------------------

-- Nåværende eier i en åpen periode for en hytte med full tilgang: kan lese og skrive
create function public.can_write_ownership(w uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.ownerships p
    join public.cabins c on c.id = p.cabin_id
    join public.cabin_owners o on o.ownership_id = p.id
    where p.id = w and p.ends_on is null and c.access = 'full' and o.user_id = auth.uid());
$$;

-- Nåværende eier, eller tidligere eier innenfor fristen: kan lese
create function public.can_read_ownership(w uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_write_ownership(w) or exists (
    select 1 from public.ownerships p
    where p.id = w and p.ends_on is not null
      and auth.uid() = any (p.former_owner_ids)
      and current_date <= p.access_until);
$$;

-- Min åpne eierperiode for en hytte (brukes av appen når nye ting lagres)
create function public.my_ownership(c uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select o.ownership_id from public.cabin_owners o
  join public.ownerships p on p.id = o.ownership_id
  where o.cabin_id = c and o.user_id = auth.uid() and p.ends_on is null;
$$;

-- ---------------------------------------------------------------------
-- Min hytte knyttes til eierperioden
-- ---------------------------------------------------------------------
alter table public.cabin_documents add column ownership_id uuid references public.ownerships (id) on delete cascade;
alter table public.cabin_albums    add column ownership_id uuid references public.ownerships (id) on delete cascade;
alter table public.cabin_photos    add column ownership_id uuid references public.ownerships (id) on delete cascade;
alter table public.cabin_ledger    add column ownership_id uuid references public.ownerships (id) on delete cascade;

update public.cabin_documents t set ownership_id = p.id from public.ownerships p where p.cabin_id = t.cabin_id and p.ends_on is null;
update public.cabin_albums    t set ownership_id = p.id from public.ownerships p where p.cabin_id = t.cabin_id and p.ends_on is null;
update public.cabin_photos    t set ownership_id = p.id from public.ownerships p where p.cabin_id = t.cabin_id and p.ends_on is null;
update public.cabin_ledger    t set ownership_id = p.id from public.ownerships p where p.cabin_id = t.cabin_id and p.ends_on is null;

-- Fyll inn eierperioden automatisk når appen lagrer med cabin_id
create function public.fill_ownership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ownership_id is null then
    new.ownership_id := public.my_ownership(new.cabin_id);
  end if;
  if new.ownership_id is null then
    raise exception 'Du er ikke eier av denne hytta' using errcode = '42501';
  end if;
  select cabin_id into new.cabin_id from public.ownerships where id = new.ownership_id;
  return new;
end;
$$;
create trigger fill_ownership before insert on public.cabin_documents for each row execute function public.fill_ownership();
create trigger fill_ownership before insert on public.cabin_albums    for each row execute function public.fill_ownership();
create trigger fill_ownership before insert on public.cabin_photos    for each row execute function public.fill_ownership();
create trigger fill_ownership before insert on public.cabin_ledger    for each row execute function public.fill_ownership();

alter table public.cabin_documents alter column ownership_id set not null;
alter table public.cabin_albums    alter column ownership_id set not null;
alter table public.cabin_photos    alter column ownership_id set not null;
alter table public.cabin_ledger    alter column ownership_id set not null;

alter table public.cabin_albums drop constraint cabin_albums_cabin_id_name_key;
alter table public.cabin_albums add constraint cabin_albums_ownership_name_key unique (ownership_id, name);

drop policy "eiere: dokumenter" on public.cabin_documents;
drop policy "eiere: album"      on public.cabin_albums;
drop policy "eiere: bilder"     on public.cabin_photos;
drop policy "eiere: regnskap"   on public.cabin_ledger;

create policy "les dokumenter"    on public.cabin_documents for select to authenticated using (public.can_read_ownership(ownership_id));
create policy "lagre dokumenter"  on public.cabin_documents for insert to authenticated with check (public.can_write_ownership(ownership_id));
create policy "endre dokumenter"  on public.cabin_documents for update to authenticated using (public.can_write_ownership(ownership_id)) with check (public.can_write_ownership(ownership_id));
create policy "slette dokumenter" on public.cabin_documents for delete to authenticated using (public.can_write_ownership(ownership_id));

create policy "les album"    on public.cabin_albums for select to authenticated using (public.can_read_ownership(ownership_id));
create policy "lagre album"  on public.cabin_albums for insert to authenticated with check (public.can_write_ownership(ownership_id));
create policy "endre album"  on public.cabin_albums for update to authenticated using (public.can_write_ownership(ownership_id)) with check (public.can_write_ownership(ownership_id));
create policy "slette album" on public.cabin_albums for delete to authenticated using (public.can_write_ownership(ownership_id));

create policy "les bilder"    on public.cabin_photos for select to authenticated using (public.can_read_ownership(ownership_id));
create policy "lagre bilder"  on public.cabin_photos for insert to authenticated with check (public.can_write_ownership(ownership_id));
create policy "endre bilder"  on public.cabin_photos for update to authenticated using (public.can_write_ownership(ownership_id)) with check (public.can_write_ownership(ownership_id));
create policy "slette bilder" on public.cabin_photos for delete to authenticated using (public.can_write_ownership(ownership_id));

create policy "les regnskap"    on public.cabin_ledger for select to authenticated using (public.can_read_ownership(ownership_id));
create policy "lagre regnskap"  on public.cabin_ledger for insert to authenticated with check (public.can_write_ownership(ownership_id));
create policy "endre regnskap"  on public.cabin_ledger for update to authenticated using (public.can_write_ownership(ownership_id)) with check (public.can_write_ownership(ownership_id));
create policy "slette regnskap" on public.cabin_ledger for delete to authenticated using (public.can_write_ownership(ownership_id));

-- Filer i bøtta «hytte»: nye filer lastes opp i mappen for eierperioden
-- (<ownership_id>/…). En fil kan leses når et dokument eller bilde man
-- kan se, peker på den. Da følger filen med når den overleveres.
drop policy "hytte: eiere" on storage.objects;
create policy "hytte: les" on storage.objects for select to authenticated using (
  bucket_id = 'hytte' and (
    exists (select 1 from public.cabin_documents d where d.storage_path = objects.name)
    or exists (select 1 from public.cabin_photos p where p.storage_path = objects.name)));
create policy "hytte: last opp" on storage.objects for insert to authenticated with check (
  bucket_id = 'hytte' and public.can_write_ownership(public.try_uuid((storage.foldername(name))[1])));
create policy "hytte: slett" on storage.objects for delete to authenticated using (
  bucket_id = 'hytte' and public.can_write_ownership(public.try_uuid((storage.foldername(name))[1])));

-- ---------------------------------------------------------------------
-- Hvem ser eierperioder og eierskifter
-- ---------------------------------------------------------------------
alter table public.ownerships          enable row level security;
alter table public.ownership_transfers enable row level security;

create policy "se eierperioder" on public.ownerships for select to authenticated using (
  public.is_staff() or public.can_read_ownership(id));
create policy "se eierskifter" on public.ownership_transfers for select to authenticated using (
  public.is_staff() or public.can_read_ownership(from_ownership) or public.can_read_ownership(to_ownership));

grant select on public.ownerships, public.ownership_transfers to authenticated;

-- ---------------------------------------------------------------------
-- Funksjoner for eierskifte
-- ---------------------------------------------------------------------

-- Administrator registrerer eierskifte. Nye eiere må være lagt inn som brukere.
create function public.register_transfer(
  p_cabin uuid, p_date date, p_kind public.transfer_kind, p_new_owners uuid[], p_note text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare old_w uuid; new_w uuid; t uuid; formers uuid[];
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator kan registrere eierskifte' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_new_owners), 0) = 0 then
    raise exception 'Eierskiftet må ha minst én ny eier';
  end if;

  select id into old_w from public.ownerships where cabin_id = p_cabin and ends_on is null;
  if old_w is null then
    raise exception 'Hytta har ingen registrerte eiere å overføre fra';
  end if;
  select coalesce(array_agg(user_id), '{}') into formers from public.cabin_owners where ownership_id = old_w;

  update public.ownerships
     set ends_on = p_date, access_until = p_date + 90, former_owner_ids = formers
   where id = old_w;
  delete from public.cabin_owners where cabin_id = p_cabin;

  insert into public.ownerships (cabin_id, starts_on) values (p_cabin, p_date) returning id into new_w;
  insert into public.cabin_owners (cabin_id, user_id) select p_cabin, unnest(p_new_owners);

  insert into public.ownership_transfers (cabin_id, from_ownership, to_ownership, kind, transfer_date, note)
  values (p_cabin, old_w, new_w, p_kind, p_date, coalesce(p_note, '')) returning id into t;
  return t;
end;
$$;

-- Selgeren overleverer valgte dokumenter og bilder til ny eier
create function public.hand_over(p_transfer uuid, p_documents uuid[] default '{}', p_photos uuid[] default '{}')
returns int language plpgsql security definer set search_path = public as $$
declare tr public.ownership_transfers; n int := 0; k int;
begin
  select * into tr from public.ownership_transfers where id = p_transfer;
  if tr.id is null or not public.can_read_ownership(tr.from_ownership) or public.can_write_ownership(tr.from_ownership) then
    raise exception 'Du kan ikke overlevere fra denne hytta' using errcode = '42501';
  end if;
  update public.cabin_documents set ownership_id = tr.to_ownership
   where ownership_id = tr.from_ownership and id = any (coalesce(p_documents, '{}'));
  get diagnostics k = row_count; n := n + k;
  update public.cabin_photos set ownership_id = tr.to_ownership, album_id = null
   where ownership_id = tr.from_ownership and id = any (coalesce(p_photos, '{}'));
  get diagnostics k = row_count; n := n + k;
  return n;
end;
$$;

-- Ved overdragelse i familien: selgeren godkjenner at hele Min hytte følger med
create function public.approve_full_transfer(p_transfer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tr public.ownership_transfers;
begin
  select * into tr from public.ownership_transfers where id = p_transfer;
  if tr.id is null or not public.can_read_ownership(tr.from_ownership) or public.can_write_ownership(tr.from_ownership) then
    raise exception 'Du kan ikke godkjenne overføring for denne hytta' using errcode = '42501';
  end if;
  if tr.kind <> 'familie' then
    raise exception '«Overfør alt» gjelder bare overdragelse i familien' using errcode = '42501';
  end if;
  update public.cabin_albums    set ownership_id = tr.to_ownership where ownership_id = tr.from_ownership;
  update public.cabin_documents set ownership_id = tr.to_ownership where ownership_id = tr.from_ownership;
  update public.cabin_photos    set ownership_id = tr.to_ownership where ownership_id = tr.from_ownership;
  update public.cabin_ledger    set ownership_id = tr.to_ownership where ownership_id = tr.from_ownership;
  update public.ownership_transfers set full_transfer_at = now() where id = tr.id;
end;
$$;

revoke all on function
  public.can_write_ownership(uuid), public.can_read_ownership(uuid), public.my_ownership(uuid),
  public.register_transfer(uuid, date, public.transfer_kind, uuid[], text),
  public.hand_over(uuid, uuid[], uuid[]), public.approve_full_transfer(uuid)
from anon, public;
grant execute on function
  public.can_write_ownership(uuid), public.can_read_ownership(uuid), public.my_ownership(uuid),
  public.register_transfer(uuid, date, public.transfer_kind, uuid[], text),
  public.hand_over(uuid, uuid[], uuid[]), public.approve_full_transfer(uuid)
to authenticated;

-- Nåværende eierskap følger fortsatt tabellen cabin_owners. Min hytte i
-- appen bruker nå eierperiodene, så den gamle hjelpefunksjonen trengs ikke.
drop function public.owns_full_cabin(uuid);

-- ---------------------------------------------------------------------
-- Hyttearkiv (følger hytta): grunneier og administrator skriver,
-- nåværende eiere leser. Filer i bøtta «arkiv» under <cabin_id>/…
-- ---------------------------------------------------------------------
create table public.cabin_archive (
  id           uuid primary key default gen_random_uuid(),
  cabin_id     uuid not null references public.cabins (id) on delete cascade,
  title        text not null,
  category     text not null default 'Festekontrakt',
  document_date date,
  storage_path text not null,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
alter table public.cabin_archive enable row level security;

create function public.can_manage_archive()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('grunneier') or public.has_role('admin');
$$;
revoke all on function public.can_manage_archive() from anon, public;
grant execute on function public.can_manage_archive() to authenticated;

create policy "se hyttearkiv"    on public.cabin_archive for select to authenticated using (public.can_manage_archive() or public.owns_cabin(cabin_id));
create policy "endre hyttearkiv" on public.cabin_archive for all    to authenticated using (public.can_manage_archive()) with check (public.can_manage_archive());
grant select, insert, update, delete on public.cabin_archive to authenticated;

insert into storage.buckets (id, name, public) values ('arkiv', 'arkiv', false) on conflict (id) do nothing;
create policy "arkiv: se" on storage.objects for select to authenticated using (
  bucket_id = 'arkiv' and (public.can_manage_archive() or public.owns_cabin(public.try_uuid((storage.foldername(name))[1]))));
create policy "arkiv: endre" on storage.objects for all to authenticated
  using      (bucket_id = 'arkiv' and public.can_manage_archive())
  with check (bucket_id = 'arkiv' and public.can_manage_archive());
