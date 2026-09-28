-- =====================================================================
-- Mørvika Hytteområde · Push-funksjonen må kunne lese push-abonnementene
--
-- Edge Function «push» leste 0 abonnement (svaret viste "subs":0) selv om
-- telefonene var registrert. Tjenestekontoen (service_role) hadde ikke
-- lesetilgang til tabellen i dette prosjektet. Her får den det eksplisitt,
-- slik de andre tabellene funksjonen bruker allerede har.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================
grant select, delete on public.push_subscriptions to service_role;
