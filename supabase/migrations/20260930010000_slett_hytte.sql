-- =====================================================================
-- Mørvika Hytteområde · Slette en hytte fra registeret
--
-- Administrator kan slette en hytte som er registrert ved en feil, eller
-- som ikke skal brukes. Eiere og prosjektmedarbeidere må fjernes først.
-- Innhold i Min hytte og hyttearkivet slettes sammen med hytta; filene
-- ryddes bort i nattjobben.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

-- Hva som ligger på hytta (vises før administrator bekrefter)
create function public.admin_cabin_content(p_cabin uuid)
returns table (owners int, workers int, documents int, photos int, ledger int, archive int, transfers int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator har tilgang' using errcode = '42501';
  end if;
  return query select
    ((select count(*) from public.cabin_owners where cabin_id = p_cabin)
      + (select count(*) from public.pending_cabin_owners where cabin_id = p_cabin))::int,
    ((select count(*) from public.cabin_workers where cabin_id = p_cabin)
      + (select count(*) from public.pending_cabin_workers where cabin_id = p_cabin))::int,
    (select count(*) from public.cabin_documents where cabin_id = p_cabin)::int,
    (select count(*) from public.cabin_photos where cabin_id = p_cabin)::int,
    (select count(*) from public.cabin_ledger where cabin_id = p_cabin)::int,
    (select count(*) from public.cabin_archive where cabin_id = p_cabin)::int,
    (select count(*) from public.ownership_transfers where cabin_id = p_cabin)::int;
end;
$$;

create function public.admin_delete_cabin(p_cabin uuid)
returns text language plpgsql security definer set search_path = public as $$
declare l text;
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator kan slette hytter' using errcode = '42501';
  end if;
  select label into l from public.cabins where id = p_cabin;
  if l is null then raise exception 'Hytta finnes ikke'; end if;
  if exists (select 1 from public.cabin_owners where cabin_id = p_cabin)
     or exists (select 1 from public.pending_cabin_owners where cabin_id = p_cabin)
     or exists (select 1 from public.cabin_workers where cabin_id = p_cabin)
     or exists (select 1 from public.pending_cabin_workers where cabin_id = p_cabin) then
    raise exception 'Fjern eiere og prosjektmedarbeidere før hytta slettes';
  end if;

  -- Filene ryddes bort av nattjobben
  insert into public.storage_trash (bucket, path)
    select 'hytte', storage_path from public.cabin_documents where cabin_id = p_cabin
    union select 'hytte', storage_path from public.cabin_photos where cabin_id = p_cabin
    union select 'hytte', receipt_path from public.cabin_ledger where cabin_id = p_cabin and receipt_path is not null
    union select 'arkiv', storage_path from public.cabin_archive where cabin_id = p_cabin
    on conflict do nothing;

  delete from public.cabins where id = p_cabin;
  perform public.cleanup_pending_people();
  return l;
end;
$$;

revoke all on function public.admin_cabin_content(uuid), public.admin_delete_cabin(uuid) from anon, public;
grant execute on function public.admin_cabin_content(uuid), public.admin_delete_cabin(uuid) to authenticated;
