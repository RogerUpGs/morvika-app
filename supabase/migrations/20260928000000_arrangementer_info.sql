-- =====================================================================
-- Mørvika Hytteområde · Arrangementer og Info
--
-- Arrangementer:
--   * påmelding med antall personer («Vi kommer 3»)
--   * push når et arrangement legges ut (hvis arrangøren velger det)
--   * påminnelse på push dagen før til de påmeldte (kl. 18 hver dag)
-- Info:
--   * kontakter for grunneier, Velet, Veilaget og nyttige nummer
--   * dokumentfilene ligger i mapper etter eier, og bare den som kan
--     publisere som eieren kan legge ut og slette der
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------
-- Arrangementer
-- ---------------------------------------------------------------------
alter table public.events add column notify boolean not null default false;
alter table public.events add column ends_at timestamptz;
alter table public.event_attendees add column persons int not null default 1 check (persons between 1 and 20);

create policy "endre påmelding" on public.event_attendees for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Varsler om arrangementer er på som standard (valget fantes ikke i appen før)
alter table public.notification_prefs alter column events set default true;
update public.notification_prefs set events = true;

-- ---------------------------------------------------------------------
-- Push: arrangementer og påminnelser (erstatter push_targets)
-- ---------------------------------------------------------------------
create or replace function public.push_targets(p_table text, p_id uuid)
returns table (user_id uuid, title text, body text, url text, tag text, urgent boolean)
language plpgsql security definer set search_path = public as $$
declare
  sender_label text; n int; tid text;
  al public.alerts; nw public.news; m public.messages; t public.threads; cm public.post_comments; p public.posts; ev public.events;
  who text;
begin
  -- Bare én gang per rad
  insert into public.push_log (table_name, record_id) values (p_table, p_id) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return; end if;

  if p_table = 'alerts' then
    select * into al from public.alerts where id = p_id and created_at > now() - interval '10 minutes';
    if al.id is null then return; end if;
    sender_label := case al.sender when 'grunneier' then 'Grunneier' when 'vel' then 'Mørvika Vel' when 'vei' then 'Mørvikveien Veilag' else 'Administrator' end;
    return query
      select x.user_id,
             case al.level when 'akutt' then 'AKUTT: ' when 'viktig' then 'Viktig: ' else '' end || al.title,
             sender_label || coalesce(nullif(': ' || left(al.body, 160), ': '), ''),
             '/#varsler', 'varsel-' || al.id::text, al.level = 'akutt'
        from public.audience_members(al.sender, al.audience) x
       where x.user_id is distinct from al.created_by;

  elsif p_table = 'news' then
    select * into nw from public.news where id = p_id and notify and created_at > now() - interval '10 minutes';
    if nw.id is null then return; end if;
    sender_label := case nw.sender when 'grunneier' then 'grunneier' when 'vel' then 'Mørvika Vel' when 'vei' then 'Mørvikveien Veilag' else 'administrator' end;
    return query
      select x.user_id, 'Nytt fra ' || sender_label, nw.title, '/#nyheter', 'nyhet-' || nw.id::text, false
        from public.audience_members(nw.sender, nw.audience) x
        left join public.notification_prefs np on np.user_id = x.user_id
       where x.user_id is distinct from nw.created_by and coalesce(np.news, true);

  elsif p_table = 'messages' then
    select * into m from public.messages where id = p_id and created_at > now() - interval '10 minutes';
    if m.id is null then return; end if;
    select * into t from public.threads where id = m.thread_id;
    select coalesce(nullif(full_name, ''), 'Ny melding') into who from public.profiles where id = m.author_id;
    return query
      select r.uid, who, t.subject || ': ' || coalesce(nullif(left(m.body, 140), ''), 'Bilde'),
             '/#meldinger', 'samtale-' || t.id::text, false
        from (
          select t.owner_id as uid where m.author_id <> t.owner_id
          union
          select ur.user_id from public.user_roles ur
           where m.author_id = t.owner_id
             and (ur.role = 'grunneier'
                  or (t.recipient = 'vel' and ur.role = 'styre_vel')
                  or (t.recipient = 'vei' and ur.role = 'styre_vei'))
        ) r
        left join public.notification_prefs np on np.user_id = r.uid
       where r.uid <> m.author_id and coalesce(np.messages, true);

  elsif p_table = 'post_comments' then
    select * into cm from public.post_comments where id = p_id and created_at > now() - interval '10 minutes';
    if cm.id is null then return; end if;
    select * into p from public.posts where id = cm.post_id;
    select coalesce(nullif(full_name, ''), 'Noen') into who from public.profiles where id = cm.author_id;
    return query
      select p.author_id, who || ' kommenterte innlegget ditt', left(cm.body, 160), '/#chat', 'innlegg-' || p.id::text, false
        from public.profiles pr
        left join public.notification_prefs np on np.user_id = pr.id
       where pr.id = p.author_id and p.author_id <> cm.author_id and coalesce(np.praten, true);

  elsif p_table = 'events' then
    select * into ev from public.events where id = p_id and notify and created_at > now() - interval '10 minutes';
    if ev.id is null then return; end if;
    tid := to_char(ev.starts_at at time zone 'Europe/Oslo', 'DD.MM. "kl." HH24:MI');
    return query
      select x.user_id, 'Nytt arrangement: ' || ev.title, tid || coalesce(nullif(' · ' || ev.place, ' · '), ''),
             '/#arr', 'arr-' || ev.id::text, false
        from public.audience_members(ev.organizer, ev.audience) x
        left join public.notification_prefs np on np.user_id = x.user_id
       where x.user_id is distinct from ev.created_by and coalesce(np.events, true);

  elsif p_table = 'event_reminder' then
    -- Påminnelse til de påmeldte når arrangementet er i morgen
    select * into ev from public.events where id = p_id and starts_at between now() + interval '6 hours' and now() + interval '36 hours';
    if ev.id is null then return; end if;
    tid := to_char(ev.starts_at at time zone 'Europe/Oslo', '"kl." HH24:MI');
    return query
      select a.user_id, 'I morgen: ' || ev.title, tid || coalesce(nullif(' · ' || ev.place, ' · '), '') || '. Du er påmeldt.',
             '/#arr', 'arr-' || ev.id::text, false
        from public.event_attendees a
       where a.event_id = ev.id;
  end if;
end;
$$;
revoke all on function public.push_targets(text, uuid) from anon, authenticated, public;
grant execute on function public.push_targets(text, uuid) to service_role;

create trigger push_event after insert on public.events for each row execute function public.notify_push();

-- Påminnelser: hver dag kl. 16 UTC (kl. 18 om sommeren, 17 om vinteren)
create function public.send_event_reminders()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare e record; n int := 0;
begin
  for e in select id from public.events
            where (starts_at at time zone 'Europe/Oslo')::date = (now() at time zone 'Europe/Oslo')::date + 1
              and exists (select 1 from public.event_attendees a where a.event_id = events.id) loop
    begin
      perform net.http_post(
        url     := 'https://eumareoqjwhkgpbporpm.supabase.co/functions/v1/push',
        body    := jsonb_build_object('table', 'event_reminder', 'id', e.id),
        headers := '{"Content-Type": "application/json"}'::jsonb);
      n := n + 1;
    exception when others then null;
    end;
  end loop;
  return n;
end;
$$;
revoke all on function public.send_event_reminders() from anon, authenticated, public;

select cron.schedule('arrangement-paaminnelse', '0 16 * * *', 'select public.send_event_reminders()');

-- ---------------------------------------------------------------------
-- Kontakter (Info)
-- ---------------------------------------------------------------------
create table public.contacts (
  id         uuid primary key default gen_random_uuid(),
  grp        text not null check (grp in ('grunneier', 'vel', 'vei', 'nyttig')),
  title      text not null default '',          -- «Leder», «Brøyting», «Legevakt»
  name       text not null check (length(trim(name)) > 0),
  phone      text,
  email      text,
  note       text not null default '',
  sort       int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.contacts enable row level security;

create function public.can_edit_contacts(g text)
returns boolean language sql stable security definer set search_path = public as $$
  select case g
    when 'grunneier' then public.has_role('grunneier')
    when 'vel'       then public.can_send_as('vel')
    when 'vei'       then public.can_send_as('vei')
    when 'nyttig'    then public.is_staff()
    else false end;
$$;
revoke all on function public.can_edit_contacts(text) from anon, public;
grant execute on function public.can_edit_contacts(text) to authenticated;

create policy "se kontakter" on public.contacts for select to authenticated using (
  public.is_resident() or (grp in ('vei', 'nyttig') and public.has_veilag_access()));
create policy "endre kontakter" on public.contacts for all to authenticated
  using (public.can_edit_contacts(grp)) with check (public.can_edit_contacts(grp));
grant select, insert, update, delete on public.contacts to authenticated;

insert into public.contacts (grp, title, name, phone, sort) values
  ('nyttig', 'Brann', 'Brannvesenet', '110', 1),
  ('nyttig', 'Politi', 'Politiet', '112', 2),
  ('nyttig', 'Ambulanse', 'Medisinsk nødtelefon', '113', 3),
  ('nyttig', 'Legevakt', 'Legevakten', '116 117', 4);

-- ---------------------------------------------------------------------
-- Dokumenter: filer i mapper etter eier, bare eieren legger ut og sletter
-- ---------------------------------------------------------------------
drop policy "dokumenter: legge ut" on storage.objects;
drop policy "dokumenter: slette" on storage.objects;
create policy "dokumenter: legge ut" on storage.objects for insert to authenticated with check (
  bucket_id = 'dokumenter' and public.can_publish_in((storage.foldername(name))[1]));
create policy "dokumenter: slette" on storage.objects for delete to authenticated using (
  bucket_id = 'dokumenter' and (public.can_publish_in((storage.foldername(name))[1]) or public.has_role('admin')));

alter table public.shared_documents add column category text not null default 'Annet';
alter table public.shared_documents add column size_bytes bigint;
alter table public.shared_documents add column file_name text;
