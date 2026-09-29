-- =====================================================================
-- Mørvika Hytteområde · Info og dokumenter: endre tittel og kategori
--
-- Styret (og grunneier) kan rette tittel og kategori på dokumenter de
-- publiserer for, og slette dem. Før kunne bare den som la ut dokumentet
-- (eller administrator) slette, og ingen kunne endre.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================
create policy "endre dokument" on public.shared_documents for update to authenticated
  using (public.can_send_as(owner) or public.has_role('admin'))
  with check (public.can_send_as(owner) or public.has_role('admin'));
grant update (title, category) on public.shared_documents to authenticated;

drop policy "slette dokument" on public.shared_documents;
create policy "slette dokument" on public.shared_documents for delete to authenticated
  using (created_by = auth.uid() or public.can_send_as(owner) or public.has_role('admin'));
