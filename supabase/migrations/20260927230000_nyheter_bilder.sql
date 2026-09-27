-- =====================================================================
-- Mørvika Hytteområde · Bilder i nyheter («Del fra feltet»)
--
-- Nyheter kan ha bilder. Bildene ligger i bøtta «nyheter», i en mappe
-- etter avsender: nyheter/<grunneier|vel|vei|admin>/<fil>.
-- Den som kan publisere som avsenderen, kan laste opp og slette der.
-- Mottakerne ser bildene til nyhetene de selv kan se.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

alter table public.news add column images text[] not null default '{}';

insert into storage.buckets (id, name, public) values ('nyheter', 'nyheter', false)
on conflict (id) do nothing;

-- Hjelper: kan innlogget bruker publisere i denne mappen?
create function public.can_publish_in(folder text)
returns boolean language sql stable security definer set search_path = public as $$
  select folder in ('grunneier', 'vel', 'vei', 'admin') and public.can_send_as(folder::public.sender);
$$;
revoke all on function public.can_publish_in(text) from anon, public;
grant execute on function public.can_publish_in(text) to authenticated;

create policy "nyheter: se" on storage.objects for select to authenticated using (
  bucket_id = 'nyheter' and (
    public.can_publish_in((storage.foldername(name))[1])
    or exists (select 1 from public.news n
                where objects.name = any (n.images)
                  and (public.can_see(n.sender, n.audience) or n.created_by = auth.uid()))));
create policy "nyheter: laste opp" on storage.objects for insert to authenticated with check (
  bucket_id = 'nyheter' and public.can_publish_in((storage.foldername(name))[1]));
create policy "nyheter: slette" on storage.objects for delete to authenticated using (
  bucket_id = 'nyheter' and (public.can_publish_in((storage.foldername(name))[1]) or public.has_role('admin')));
