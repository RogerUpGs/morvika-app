-- =====================================================================
-- Mørvika Hytteområde · FDV-dokumentasjon og overlevering fra utbygger
--
--   * FDV-mal i Min hytte: faste mapper for FDV-dokumenter og fotoalbum
--     for byggetrinnene (slås på per hytte og eierperiode)
--   * Eierskifte av typen «Overlevering fra utbygger»: alle dokumenter,
--     bilder og album går til kjøper med en gang eierskiftet registreres.
--     Hytteregnskapet blir igjen hos utbyggeren.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

alter table public.ownerships          add column fdv boolean not null default false;
alter table public.ownership_transfers add column from_builder boolean not null default false;

-- Slå FDV-malen på eller av for en hytte (nåværende eiere)
create function public.set_fdv(p_ownership uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare c uuid; a text;
begin
  if not public.can_write_ownership(p_ownership) then
    raise exception 'Du er ikke eier av denne hytta' using errcode = '42501';
  end if;
  update public.ownerships set fdv = coalesce(p_on, false) where id = p_ownership returning cabin_id into c;
  if p_on then
    foreach a in array array['Grunnarbeid', 'Råbygg', 'Rør og elektro før lukking', 'Innvendig', 'Ferdig'] loop
      insert into public.cabin_albums (cabin_id, ownership_id, name) values (c, p_ownership, a) on conflict do nothing;
    end loop;
  end if;
end;
$$;
revoke all on function public.set_fdv(uuid, boolean) from anon, public;
grant execute on function public.set_fdv(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Eierskifte: ny valgfri parameter p_builder (overlevering fra utbygger)
-- ---------------------------------------------------------------------
drop function public.admin_transfer(uuid, date, public.transfer_kind, jsonb, text);
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

  -- Fjern gamle eiere (også de som aldri logget inn)
  delete from public.cabin_owners where cabin_id = p_cabin;
  delete from public.pending_cabin_owners where cabin_id = p_cabin;
  delete from public.pending_people q
   where cardinality(q.roles) = 0 and not exists (select 1 from public.pending_cabin_owners where pending_id = q.id);

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

drop function public.admin_transfers(uuid);
create function public.admin_transfers(p_cabin uuid)
returns table (id uuid, transfer_date date, kind public.transfer_kind, sellers text, access_until date, full_transfer_at timestamptz, note text, from_builder boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator har tilgang' using errcode = '42501';
  end if;
  return query
    select t.id, t.transfer_date, t.kind,
           coalesce((select string_agg(p.full_name, ', ' order by p.full_name) from public.profiles p where p.id = any (w.former_owner_ids)), ''),
           w.access_until, t.full_transfer_at, t.note, t.from_builder
      from public.ownership_transfers t
      join public.ownerships w on w.id = t.from_ownership
     where t.cabin_id = p_cabin
     order by t.transfer_date desc, t.created_at desc;
end;
$$;

revoke all on function public.admin_transfer(uuid, date, public.transfer_kind, jsonb, text, boolean), public.admin_transfers(uuid) from anon, public;
grant execute on function public.admin_transfer(uuid, date, public.transfer_kind, jsonb, text, boolean), public.admin_transfers(uuid) to authenticated;
