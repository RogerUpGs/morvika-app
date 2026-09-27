-- =====================================================================
-- Mørvika Hytteområde · Tomtetype (festetomt eller selveiertomt)
-- Gjelder hytter på Mørvika. For Torpum står feltet tomt.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================
create type public.tomt_type as enum ('feste', 'selveier');
alter table public.cabins add column tomt public.tomt_type;
comment on column public.cabins.tomt is 'Festetomt eller selveiertomt';
