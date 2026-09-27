-- =====================================================================
-- Mørvika Hytteområde · Grunneier har full tilgang til Vel og Veilag
--
-- Grunneier kan gjøre alt styrene i Mørvika Vel og Mørvikveien Veilag
-- kan: publisere nyheter, sende varsler, lage arrangementer, legge ut
-- dokumenter og lese og svare på meldinger sendt til styrene.
-- Tilgangen følger rollen «grunneier», ikke en bestemt person.
-- Min hytte (hytteeiernes private område) er fortsatt stengt for grunneier.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

create or replace function public.can_send_as(s public.sender)
returns boolean language sql stable security definer set search_path = public as $$
  select case s
    when 'grunneier' then public.has_role('grunneier')
    when 'vel'       then public.has_role('styre_vel') or public.has_role('grunneier')
    when 'vei'       then public.has_role('styre_vei') or public.has_role('grunneier')
    when 'admin'     then public.has_role('admin')
  end;
$$;

create or replace function public.handles_recipient(r public.recipient)
returns boolean language sql stable security definer set search_path = public as $$
  select case r
    when 'grunneier' then public.has_role('grunneier')
    when 'vel'       then public.has_role('styre_vel') or public.has_role('grunneier')
    when 'vei'       then public.has_role('styre_vei') or public.has_role('grunneier')
  end;
$$;

-- Veilagets dokumenter kan også legges ut og slettes av grunneier (dekket av is_staff()
-- i reglene for bøtta «dokumenter»), så her trengs ingen endring.
