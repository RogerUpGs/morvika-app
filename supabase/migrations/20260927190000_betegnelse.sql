-- =====================================================================
-- Mørvika Hytteområde · Betegnelse med veinavn
-- Hytter som allerede er registrert med «Hytte 4» og en adresse,
-- får betegnelsen «Hytte 4 · Mørvikveien». Egne betegnelser røres ikke.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================
update public.cabins
   set label = label || ' · ' || regexp_replace(trim(address), '\s*\d+\s*[A-Za-zÆØÅæøå]?$', '')
 where area = 'morvika'
   and label = 'Hytte ' || number
   and coalesce(trim(address), '') <> ''
   and regexp_replace(trim(address), '\s*\d+\s*[A-Za-zÆØÅæøå]?$', '') <> '';

update public.cabins
   set label = label || ' · ' || regexp_replace(trim(address), '\s*\d+\s*[A-Za-zÆØÅæøå]?$', '')
 where area = 'torpum'
   and label = 'Torpum ' || number
   and coalesce(trim(address), '') <> ''
   and regexp_replace(trim(address), '\s*\d+\s*[A-Za-zÆØÅæøå]?$', '') <> '';
