-- =====================================================================
-- Mørvika Hytteområde · Min hytte: kvittering på regnskapsposter
--
-- En post i hytteregnskapet kan ha et bilde av kvitteringen. Bildet
-- ligger i bøtta «hytte» i mappen for eierperioden, som dokumenter og
-- bilder, og kan leses av dem som kan se posten.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

alter table public.cabin_ledger add column receipt_path text;

drop policy "hytte: les" on storage.objects;
create policy "hytte: les" on storage.objects for select to authenticated using (
  bucket_id = 'hytte' and (
    public.can_write_ownership(public.try_uuid((storage.foldername(name))[1]))
    or exists (select 1 from public.cabin_documents d where d.storage_path = objects.name)
    or exists (select 1 from public.cabin_photos p where p.storage_path = objects.name)
    or exists (select 1 from public.cabin_ledger l where l.receipt_path = objects.name)));
