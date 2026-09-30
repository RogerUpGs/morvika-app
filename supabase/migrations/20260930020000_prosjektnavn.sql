-- =====================================================================
-- Mørvika Hytteområde · Prosjektnavn på hytter under bygging
--
-- Flere hytter i samme vei (f.eks. fem i Mørvikåsen) får et eget
-- prosjektnavn/-nummer, så håndverkerne ser hvilken hytte de jobber på.
-- Navnet vises i Min hytte, i prosjektlisten og for prosjektmedarbeidere.
-- Det fjernes automatisk når hytta får eierskifte (overlevering).
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

alter table public.cabins add column project_name text;

-- Etter eierskifte er hytta ikke lenger et byggeprosjekt
create function public.clear_project_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.cabins set project_name = null where id = new.cabin_id and project_name is not null;
  return new;
end;
$$;
create trigger clear_project_name after insert on public.ownership_transfers
  for each row execute function public.clear_project_name();

-- Prosjektene jeg er medarbeider på, nå med prosjektnavn
drop function public.my_worker_cabins();
create function public.my_worker_cabins()
returns table (cabin_id uuid, label text, number int, gnr int, bnr int, ownership_id uuid, fdv boolean, project_name text)
language sql stable security definer set search_path = public as $$
  select c.id, c.label, c.number, c.gnr, c.bnr, w.id, w.fdv, c.project_name
    from public.cabin_workers k
    join public.cabins c on c.id = k.cabin_id and c.access = 'full'
    join public.ownerships w on w.cabin_id = c.id and w.ends_on is null
   where k.user_id = auth.uid()
   order by c.project_name nulls last, c.area, c.number;
$$;
revoke all on function public.my_worker_cabins() from anon, public;
grant execute on function public.my_worker_cabins() to authenticated;
