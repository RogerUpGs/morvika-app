-- =====================================================================
-- Mørvika Hytteområde · Grunneier og styrene kan starte en samtale
--
-- Før: bare hytteeieren kunne starte en samtale.
-- Nå: grunneier og styrene kan også starte en samtale med en hytteeier.
-- Samtalen «eies» fortsatt av hytteeieren (owner_id), slik at den vises
-- hos hytteeieren som en samtale med Grunneier / Velet / Veilaget.
-- Torpum-eiere kan bare få meldinger fra Veilaget.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

alter table public.threads add column started_by uuid default auth.uid() references public.profiles (id) on delete set null;
comment on column public.threads.started_by is 'Hvem som startet samtalen (hytteeieren selv, grunneier eller et styremedlem)';

create policy "styret starter samtale med hytteeier" on public.threads for insert to authenticated with check (
  public.handles_recipient(recipient)
  and started_by = auth.uid()
  and exists (
    select 1 from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
     where o.user_id = threads.owner_id
       and (c.access = 'full' or (threads.recipient = 'vei' and c.vei_member))));
