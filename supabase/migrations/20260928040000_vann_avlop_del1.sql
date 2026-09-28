-- =====================================================================
-- Mørvika Hytteområde · Mørvika Vann og Avløp, del 1 av 2
--
-- Legger til Vann og avløp som egen forening, på samme måte som Velet:
-- ny styrerolle, ny mottakergruppe, ny avsender og ny mottaker for meldinger.
--
-- Nye verdier i en liste må lagres før de kan brukes, derfor to filer.
-- Kjør denne først (SQL Editor → lim inn → Run), deretter del 2.
-- =====================================================================

alter type public.app_role  add value if not exists 'styre_va' after 'styre_vel';
alter type public.audience  add value if not exists 'va' after 'vel';
alter type public.sender    add value if not exists 'va' after 'vel';
alter type public.recipient add value if not exists 'va' after 'vel';
