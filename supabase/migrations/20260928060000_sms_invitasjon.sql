-- =====================================================================
-- Mørvika Hytteområde · Invitasjon på SMS
--
-- Administrator kan sende en SMS med lenke til appen til alle hytteeiere
-- som ikke har logget inn ennå (Administrasjon → Personer og roller →
-- Inviter hytteeiere). Én SMS per mobilnummer. SMS-ene logges og telles
-- med i SMS-oversikten på avsenderen som betaler (grunneier, Vel, VA, Veilag).
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

create table public.sms_batches (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'invitasjon' check (kind in ('invitasjon')),
  area       text not null check (area in ('alle', 'morvika', 'torpum')),
  sender     public.sender not null,               -- hvem som betaler
  message    text not null check (length(message) between 1 and 459),
  status     text not null default 'venter' check (status in ('venter', 'ferdig')),
  sent       int not null default 0,
  failed     int not null default 0,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.sms_batches enable row level security;
create policy "admin: SMS-utsendinger" on public.sms_batches for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin') and created_by = auth.uid());
grant select, insert on public.sms_batches to authenticated;
grant select, update on public.sms_batches to service_role;
create trigger push_sms_batch after insert on public.sms_batches for each row execute function public.notify_push();

alter table public.sms_log add column batch_id uuid references public.sms_batches (id) on delete set null;

-- Edge Function lagrer også batch_id
create or replace function public.sms_record(p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.sms_log (alert_id, test_id, batch_id, sender, phone, person_name, cabin_label, status, parts, cost, provider_id, error)
  select (r ->> 'alert_id')::uuid, (r ->> 'test_id')::uuid, (r ->> 'batch_id')::uuid, (r ->> 'sender')::public.sender, r ->> 'phone',
         coalesce(r ->> 'person_name', ''), coalesce(r ->> 'cabin_label', ''), r ->> 'status',
         coalesce((r ->> 'parts')::int, 0), (r ->> 'cost')::numeric, r ->> 'provider_id', r ->> 'error'
    from jsonb_array_elements(p_rows) r;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.sms_record(jsonb) from anon, authenticated, public;
grant execute on function public.sms_record(jsonb) to service_role;

-- Hvem får invitasjon: registrerte eiere som ikke har logget inn, har e-post og mobilnummer
create function public.sms_invite_phones(p_area text)
returns table (phone text, full_name text, cabins text)
language sql stable security definer set search_path = public as $$
  select public.sms_phone(q.phone), min(q.full_name), string_agg(distinct c.label, ', ')
    from public.pending_people q
    join public.pending_cabin_owners po on po.pending_id = q.id
    join public.cabins c on c.id = po.cabin_id
   where q.email is not null and public.sms_phone(q.phone) is not null
     and (p_area = 'alle' or c.area::text = p_area)
   group by public.sms_phone(q.phone);
$$;
revoke all on function public.sms_invite_phones(text) from anon, authenticated, public;

create function public.sms_invite_preview(p_area text)
returns int language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator' using errcode = '42501';
  end if;
  return (select count(*)::int from public.sms_invite_phones(p_area));
end;
$$;
revoke all on function public.sms_invite_preview(text) from anon, public;
grant execute on function public.sms_invite_preview(text) to authenticated;

-- Hva som skal sendes for en utsending (Edge Function «push», én gang)
create function public.sms_batch_targets(p_batch uuid)
returns table (phone text, full_name text, cabins text, message text, sender public.sender, sms_from text)
language plpgsql security definer set search_path = public as $$
declare b public.sms_batches; n int;
begin
  if coalesce(public.sms_setting('sms_enabled'), 'false') <> 'true' then return; end if;
  select * into b from public.sms_batches where id = p_batch and created_at > now() - interval '10 minutes';
  if b.id is null then return; end if;
  insert into public.push_log (table_name, record_id) values ('sms_batches', p_batch) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return; end if;
  return query
    select t.phone, t.full_name, t.cabins, b.message, b.sender, coalesce(nullif(public.sms_setting('sms_from'), ''), 'Morvika')
      from public.sms_invite_phones(b.area) t;
end;
$$;
revoke all on function public.sms_batch_targets(uuid) from anon, authenticated, public;
grant execute on function public.sms_batch_targets(uuid) to service_role;
