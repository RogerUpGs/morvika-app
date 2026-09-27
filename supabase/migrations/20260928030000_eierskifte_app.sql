-- =====================================================================
-- Mørvika Hytteområde · Eierskifte i appen
--
--   * admin_transfer: administrator registrerer salg eller overdragelse.
--     Nye eiere oppgis med navn og e-post, og trenger ikke ha logget inn.
--   * my_former_cabins: selgeren ser hvilke hytter hen har lesetilgang til
--     (90 dager etter eierskiftet)
--   * admin_transfers: historikk over eierskifter for en hytte
--   * purge_expired_ownerships: sletter selgerens Min hytte etter fristen.
--     Filene legges i storage_trash og slettes av Edge Function «push»
--     (lagringen tillater ikke sletting av filer direkte fra databasen).
--     Kjøres hver natt.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Registrer eierskifte
-- ---------------------------------------------------------------------
create function public.admin_transfer(
  p_cabin uuid, p_date date, p_kind public.transfer_kind, p_owners jsonb, p_note text default '')
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

  -- Fjern gamle eiere (også de som aldri logget inn)
  delete from public.cabin_owners where cabin_id = p_cabin;
  delete from public.pending_cabin_owners where cabin_id = p_cabin;
  delete from public.pending_people q
   where cardinality(q.roles) = 0 and not exists (select 1 from public.pending_cabin_owners where pending_id = q.id);

  -- Ny periode og nye eiere
  insert into public.ownerships (cabin_id, starts_on) values (p_cabin, p_date) returning id into new_w;
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

  insert into public.ownership_transfers (cabin_id, from_ownership, to_ownership, kind, transfer_date, note)
  values (p_cabin, old_w, new_w, p_kind, p_date, coalesce(p_note, '')) returning id into t;
  return t;
end;
$$;

-- ---------------------------------------------------------------------
-- Historikk for en hytte (administrator)
-- ---------------------------------------------------------------------
create function public.admin_transfers(p_cabin uuid)
returns table (id uuid, transfer_date date, kind public.transfer_kind, sellers text, access_until date, full_transfer_at timestamptz, note text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator har tilgang' using errcode = '42501';
  end if;
  return query
    select t.id, t.transfer_date, t.kind,
           coalesce((select string_agg(p.full_name, ', ' order by p.full_name) from public.profiles p where p.id = any (w.former_owner_ids)), ''),
           w.access_until, t.full_transfer_at, t.note
      from public.ownership_transfers t
      join public.ownerships w on w.id = t.from_ownership
     where t.cabin_id = p_cabin
     order by t.transfer_date desc, t.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------
-- Selgerens tidligere hytter (lesetilgang i fristen)
-- ---------------------------------------------------------------------
create function public.my_former_cabins()
returns table (ownership_id uuid, cabin_id uuid, label text, ends_on date, access_until date,
               transfer_id uuid, kind public.transfer_kind, full_transfer_at timestamptz)
language sql stable security definer set search_path = public as $$
  select w.id, w.cabin_id, c.label, w.ends_on, w.access_until, t.id, t.kind, t.full_transfer_at
    from public.ownerships w
    join public.cabins c on c.id = w.cabin_id
    left join public.ownership_transfers t on t.from_ownership = w.id
   where w.ends_on is not null and auth.uid() = any (w.former_owner_ids) and current_date <= w.access_until
   order by w.ends_on desc;
$$;

revoke all on function public.admin_transfer(uuid, date, public.transfer_kind, jsonb, text), public.admin_transfers(uuid), public.my_former_cabins() from anon, public;
grant execute on function public.admin_transfer(uuid, date, public.transfer_kind, jsonb, text), public.admin_transfers(uuid), public.my_former_cabins() to authenticated;

-- ---------------------------------------------------------------------
-- Ny eier kan slette filer som selgeren har gitt videre
-- ---------------------------------------------------------------------
drop policy "hytte: slett" on storage.objects;
create policy "hytte: slett" on storage.objects for delete to authenticated using (
  bucket_id = 'hytte' and (
    public.can_write_ownership(public.try_uuid((storage.foldername(name))[1]))
    or exists (select 1 from public.cabin_documents d where d.storage_path = objects.name and public.can_write_ownership(d.ownership_id))
    or exists (select 1 from public.cabin_photos p where p.storage_path = objects.name and public.can_write_ownership(p.ownership_id))
    or exists (select 1 from public.cabin_ledger l where l.receipt_path = objects.name and public.can_write_ownership(l.ownership_id))));

-- ---------------------------------------------------------------------
-- Sletting etter fristen
-- ---------------------------------------------------------------------
create table public.storage_trash (
  bucket     text not null,
  path       text not null,
  created_at timestamptz not null default now(),
  primary key (bucket, path)
);
alter table public.storage_trash enable row level security;   -- ingen regler: bare tjenesten ser den
grant select, delete on public.storage_trash to service_role;

alter table public.ownerships add column purged_at timestamptz;

create function public.purge_expired_ownerships()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare w record; n int := 0;
begin
  for w in select id from public.ownerships
            where ends_on is not null and access_until < current_date and purged_at is null loop
    insert into public.storage_trash (bucket, path)
      select 'hytte', storage_path from public.cabin_documents where ownership_id = w.id
      union select 'hytte', storage_path from public.cabin_photos where ownership_id = w.id
      union select 'hytte', receipt_path from public.cabin_ledger where ownership_id = w.id and receipt_path is not null
      on conflict do nothing;
    delete from public.cabin_documents where ownership_id = w.id;
    delete from public.cabin_photos    where ownership_id = w.id;
    delete from public.cabin_albums    where ownership_id = w.id;
    delete from public.cabin_ledger    where ownership_id = w.id;
    update public.ownerships set purged_at = now(), former_owner_ids = '{}' where id = w.id;
    n := n + 1;
  end loop;
  if exists (select 1 from public.storage_trash) then
    begin
      perform net.http_post(
        url     := 'https://eumareoqjwhkgpbporpm.supabase.co/functions/v1/push',
        body    := jsonb_build_object('table', 'storage_trash', 'id', '00000000-0000-0000-0000-000000000000'),
        headers := '{"Content-Type": "application/json"}'::jsonb);
    exception when others then null;
    end;
  end if;
  return n;
end;
$$;
revoke all on function public.purge_expired_ownerships() from anon, authenticated, public;

select cron.schedule('slett-utlopt-min-hytte', '30 2 * * *', 'select public.purge_expired_ownerships()');
