-- =====================================================================
-- Mørvika Hytteområde · Torpum og tilgangsnivået «Bare Veilaget»
--
-- Torpum er en ekstern hytteeiendom som er med i Mørvikveien Veilag,
-- men ikke eies av grunneier. Hytteeierne der skal bare se det som
-- kommer fra Veilaget:
--   * nyheter, varsler og arrangementer fra Veilaget
--   * dokumenter fra Veilaget
--   * meldinger til Veilagets styre
-- Ikke Hyttepraten, ikke Min hytte, ikke andre hytteeiere, ikke noe fra
-- grunneier eller Velet.
--
-- Tilgangen styres per hytte med kolonnen cabins.access:
--   'full'    = vanlig hytteeier (standard)
--   'veilag'  = bare Veilaget (Torpum)
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

-- Navn: Sandbukta heter Torpum
alter type public.area     rename value 'sandbukta' to 'torpum';
alter type public.audience rename value 'sandbukta' to 'torpum';

-- Tilgangsnivå per hytte
create type public.cabin_access as enum ('full', 'veilag');
alter table public.cabins add column access public.cabin_access not null default 'full';
comment on column public.cabins.access is 'full = vanlig hytteeier, veilag = ser bare det som kommer fra Mørvikveien Veilag';

-- ---------------------------------------------------------------------
-- Hjelpefunksjoner
-- ---------------------------------------------------------------------

-- «Full beboer»: eier en hytte med full tilgang, eller har en rolle.
-- Brukes av alle regler som tidligere brukte is_resident().
create or replace function public.is_resident()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
                 where o.user_id = auth.uid() and c.access = 'full')
      or exists (select 1 from public.user_roles where user_id = auth.uid());
$$;

-- Har tilgang til det som kommer fra Veilaget
create function public.has_veilag_access()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('styre_vei') or exists (
    select 1 from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
    where o.user_id = auth.uid() and c.vei_member);
$$;

-- Eier hytta, og hytta har full tilgang (Min hytte)
create function public.owns_full_cabin(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cabin_owners o join public.cabins k on k.id = o.cabin_id
                 where o.cabin_id = c and o.user_id = auth.uid() and k.access = 'full');
$$;

-- Mottakergruppe (uten hensyn til tilgangsnivå)
create or replace function public.in_audience(a public.audience)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() or case a
    when 'alle'    then exists (select 1 from public.cabin_owners where user_id = auth.uid())
                        or exists (select 1 from public.user_roles where user_id = auth.uid())
    when 'morvika' then exists (select 1 from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
                                where o.user_id = auth.uid() and c.area = 'morvika')
    when 'torpum'  then exists (select 1 from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
                                where o.user_id = auth.uid() and c.area = 'torpum')
    when 'vel'     then public.has_role('styre_vel') or exists (
                          select 1 from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
                          where o.user_id = auth.uid() and c.vel_member)
    when 'vei'     then public.has_role('styre_vei') or exists (
                          select 1 from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
                          where o.user_id = auth.uid() and c.vei_member)
  end;
$$;

-- Kan innlogget bruker se noe fra denne avsenderen til denne gruppen?
create function public.can_see(s public.sender, a public.audience)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff()
      or (public.in_audience(a) and (public.is_resident() or (s = 'vei' and public.has_veilag_access())));
$$;

create or replace function public.audience_size(a public.audience)
returns int language sql stable security definer set search_path = public as $$
  select case when not (public.is_staff() or public.has_role('styre_vel') or public.has_role('styre_vei')) then null
  else (
    select count(distinct o.user_id)::int
    from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
    where case a
      when 'alle'    then c.access = 'full'
      when 'morvika' then c.area = 'morvika'
      when 'torpum'  then c.area = 'torpum'
      when 'vel'     then c.vel_member
      when 'vei'     then c.vei_member
    end
  ) end;
$$;

revoke all on function public.has_veilag_access(), public.owns_full_cabin(uuid), public.can_see(public.sender, public.audience) from anon, public;
grant execute on function public.has_veilag_access(), public.owns_full_cabin(uuid), public.can_see(public.sender, public.audience) to authenticated;

-- ---------------------------------------------------------------------
-- Regler som endres
-- ---------------------------------------------------------------------

-- Hytter og eierskap: Torpum-brukere ser bare sin egen hytte
drop policy "beboere ser hytter" on public.cabins;
create policy "se hytter" on public.cabins for select to authenticated
  using (public.is_resident() or public.owns_cabin(id));

drop policy "beboere ser eierskap" on public.cabin_owners;
create policy "se eierskap" on public.cabin_owners for select to authenticated
  using (public.is_resident() or user_id = auth.uid());

-- Profiler: Torpum-brukere ser navnet på Veilagets styre (for meldinger)
drop policy "se profiler" on public.profiles;
create policy "se profiler" on public.profiles for select to authenticated using (
  id = auth.uid() or public.is_resident()
  or (public.has_veilag_access() and exists (select 1 from public.user_roles r where r.user_id = profiles.id and r.role = 'styre_vei')));

drop policy "se roller" on public.user_roles;
create policy "se roller" on public.user_roles for select to authenticated using (
  user_id = auth.uid() or public.is_resident() or (role = 'styre_vei' and public.has_veilag_access()));

-- Nyheter, varsler og arrangementer: avsender avgjør for Torpum
drop policy "se nyheter" on public.news;
create policy "se nyheter" on public.news for select to authenticated
  using (public.can_see(sender, audience) or created_by = auth.uid());

drop policy "se varsler" on public.alerts;
create policy "se varsler" on public.alerts for select to authenticated
  using (public.can_see(sender, audience) or created_by = auth.uid());

drop policy "se arrangementer" on public.events;
create policy "se arrangementer" on public.events for select to authenticated
  using (public.can_see(organizer, audience) or created_by = auth.uid());

-- Meldinger: Torpum-brukere kan bare skrive til Veilagets styre
drop policy "starte samtale" on public.threads;
create policy "starte samtale" on public.threads for insert to authenticated with check (
  owner_id = auth.uid()
  and (public.is_resident() or (recipient = 'vei' and public.has_veilag_access())));

-- Felles dokumenter: Torpum ser bare Veilagets dokumenter
drop policy "se felles dokumenter" on public.shared_documents;
create policy "se felles dokumenter" on public.shared_documents for select to authenticated
  using (public.is_resident() or (owner = 'vei' and public.has_veilag_access()));

-- Filene ligger i mapper etter eier: dokumenter/<grunneier|vel|vei|admin>/…
drop policy "dokumenter: se" on storage.objects;
create policy "dokumenter: se" on storage.objects for select to authenticated using (
  bucket_id = 'dokumenter'
  and (public.is_resident() or ((storage.foldername(name))[1] = 'vei' and public.has_veilag_access())));

-- Min hytte: bare hytter med full tilgang
drop policy "eiere: dokumenter" on public.cabin_documents;
drop policy "eiere: album"      on public.cabin_albums;
drop policy "eiere: bilder"     on public.cabin_photos;
drop policy "eiere: regnskap"   on public.cabin_ledger;
create policy "eiere: dokumenter" on public.cabin_documents for all to authenticated using (public.owns_full_cabin(cabin_id)) with check (public.owns_full_cabin(cabin_id));
create policy "eiere: album"      on public.cabin_albums    for all to authenticated using (public.owns_full_cabin(cabin_id)) with check (public.owns_full_cabin(cabin_id));
create policy "eiere: bilder"     on public.cabin_photos    for all to authenticated using (public.owns_full_cabin(cabin_id)) with check (public.owns_full_cabin(cabin_id));
create policy "eiere: regnskap"   on public.cabin_ledger    for all to authenticated using (public.owns_full_cabin(cabin_id)) with check (public.owns_full_cabin(cabin_id));

drop policy "hytte: eiere" on storage.objects;
create policy "hytte: eiere" on storage.objects for all to authenticated
  using      (bucket_id = 'hytte' and public.owns_full_cabin(public.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id = 'hytte' and public.owns_full_cabin(public.try_uuid((storage.foldername(name))[1])));
