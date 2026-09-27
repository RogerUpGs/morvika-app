-- =====================================================================
-- Mørvika Hytteområde · SB-nummer i betegnelsen
--
-- Hyttene på Mørvika får betegnelsen «SB-12 · Mørvikveien» i stedet for
-- «Hytte 12 · Mørvikveien». Bare betegnelser som appen har laget
-- automatisk («Hytte <nummer>» eller «Hytte <nummer> · <vei>») endres.
-- Egne betegnelser og Torpum røres ikke.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================
update public.cabins
   set label = 'SB-' || number || substr(label, length('Hytte ' || number) + 1)
 where area = 'morvika'
   and (label = 'Hytte ' || number or label like 'Hytte ' || number || ' · %');
