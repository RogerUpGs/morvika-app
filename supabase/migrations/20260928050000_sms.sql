-- =====================================================================
-- Mørvika Hytteområde · SMS-varsling og veinavnfilter
--
--   * SMS-kontakt per hytte: den som ble registrert først på hytta får
--     SMS. Administrator kan bytte. Går kontaktpersonen ut, tar neste over.
--   * Varsler kan avgrenses til veinavn (Mørvikveien, Mørvikvarden …).
--     Da får bare hyttene i de veiene varselet, push og SMS.
--   * Akutte og viktige varsler kan også sendes som SMS (via 46elks).
--     SMS er av til administrator slår det på under Administrasjon → SMS.
--   * Hver SMS logges med avsender (grunneier, Vel, VA, Veilag), antall
--     deler og kostnad. «Registrer oppgjør» fordeler regningen og starter
--     oversikten på nytt. Historikken beholdes.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- SMS-kontakt per hytte
-- ---------------------------------------------------------------------
alter table public.cabin_owners         add column sms_contact boolean not null default false;
alter table public.pending_cabin_owners add column sms_contact boolean not null default false;
alter table public.pending_cabin_owners add column created_at timestamptz not null default now();
update public.pending_cabin_owners po set created_at = q.created_at
  from public.pending_people q where q.id = po.pending_id;

create unique index cabin_owners_one_sms   on public.cabin_owners (cabin_id)         where sms_contact;
create unique index pending_owners_one_sms on public.pending_cabin_owners (cabin_id) where sms_contact;

-- Sørg for at hytta har én SMS-kontakt: den som ble registrert først
create function public.ensure_sms_contact(p_cabin uuid)
returns void language plpgsql security definer set search_path = public as $$
declare k record;
begin
  if p_cabin is null then return; end if;
  if exists (select 1 from public.cabin_owners where cabin_id = p_cabin and sms_contact)
     or exists (select 1 from public.pending_cabin_owners where cabin_id = p_cabin and sms_contact) then
    return;
  end if;
  select * into k from (
    select 'aktiv' as kind, user_id as person, created_at from public.cabin_owners where cabin_id = p_cabin
    union all
    select 'venter', pending_id, created_at from public.pending_cabin_owners where cabin_id = p_cabin
  ) x order by created_at, person limit 1;
  if k.person is null then return; end if;
  if k.kind = 'aktiv' then
    update public.cabin_owners set sms_contact = true where cabin_id = p_cabin and user_id = k.person;
  else
    update public.pending_cabin_owners set sms_contact = true where cabin_id = p_cabin and pending_id = k.person;
  end if;
end;
$$;
revoke all on function public.ensure_sms_contact(uuid) from anon, authenticated, public;

create function public.sms_contact_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_sms_contact(case when tg_op = 'DELETE' then old.cabin_id else new.cabin_id end);
  return null;
end;
$$;
create trigger sms_contact after insert or delete on public.cabin_owners
  for each row execute function public.sms_contact_trigger();
create trigger sms_contact after insert or delete on public.pending_cabin_owners
  for each row execute function public.sms_contact_trigger();

-- Første innlogging: behold registreringsrekkefølgen og SMS-kontakten
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.pending_people;
begin
  select * into p from public.pending_people
   where email is not null and lower(email) = lower(new.email)
   limit 1;

  insert into public.profiles (id, full_name, email, phone)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), p.full_name, ''),
          new.email,
          coalesce(new.phone, p.phone));

  if not exists (select 1 from public.user_roles where role = 'admin') then
    insert into public.user_roles (user_id, role) values (new.id, 'admin'), (new.id, 'grunneier');
  end if;

  if p.id is not null then
    insert into public.user_roles (user_id, role)
      select new.id, unnest(p.roles) on conflict do nothing;
    -- Behold registreringsrekkefølgen og hvem som er SMS-kontakt
    insert into public.cabin_owners (cabin_id, user_id, created_at, sms_contact)
      select cabin_id, new.id, created_at, sms_contact from public.pending_cabin_owners where pending_id = p.id
      on conflict do nothing;
    delete from public.pending_people where id = p.id;
  end if;
  return new;
end;
$$;

-- Administrator velger hvem på hytta som får SMS
create function public.admin_set_sms_contact(p_cabin uuid, p_person uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator kan velge SMS-kontakt' using errcode = '42501';
  end if;
  if not exists (select 1 from public.cabin_owners where cabin_id = p_cabin and user_id = p_person)
     and not exists (select 1 from public.pending_cabin_owners where cabin_id = p_cabin and pending_id = p_person) then
    raise exception 'Personen er ikke eier av hytta';
  end if;
  update public.cabin_owners         set sms_contact = false where cabin_id = p_cabin and sms_contact;
  update public.pending_cabin_owners set sms_contact = false where cabin_id = p_cabin and sms_contact;
  update public.cabin_owners         set sms_contact = true where cabin_id = p_cabin and user_id = p_person;
  update public.pending_cabin_owners set sms_contact = true where cabin_id = p_cabin and pending_id = p_person;
end;
$$;

-- Personlisten får med hvilke hytter personen er SMS-kontakt for
drop function public.admin_people();
create function public.admin_people()
returns table (
  id uuid, status text, full_name text, email text, phone text,
  roles public.app_role[], cabin_ids uuid[], last_seen_at timestamptz, created_at timestamptz, sms_cabin_ids uuid[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator har tilgang' using errcode = '42501';
  end if;
  return query
    select p.id, 'aktiv'::text, p.full_name, p.email, p.phone,
           coalesce((select array_agg(r.role order by r.role) from public.user_roles r where r.user_id = p.id), '{}'),
           coalesce((select array_agg(o.cabin_id order by o.created_at) from public.cabin_owners o where o.user_id = p.id), '{}'),
           p.last_seen_at, p.created_at,
           coalesce((select array_agg(o.cabin_id) from public.cabin_owners o where o.user_id = p.id and o.sms_contact), '{}')
      from public.profiles p
    union all
    select q.id, case when q.email is null then 'mangler_epost' else 'venter' end,
           q.full_name, q.email, q.phone, q.roles,
           coalesce((select array_agg(c.cabin_id order by c.created_at) from public.pending_cabin_owners c where c.pending_id = q.id), '{}'),
           null::timestamptz, q.created_at,
           coalesce((select array_agg(c.cabin_id) from public.pending_cabin_owners c where c.pending_id = q.id and c.sms_contact), '{}')
      from public.pending_people q;
end;
$$;

revoke all on function public.admin_set_sms_contact(uuid, uuid), public.admin_people() from anon, public;
grant execute on function public.admin_set_sms_contact(uuid, uuid), public.admin_people() to authenticated;

-- Sett SMS-kontakt på alle hytter som har eiere (den som ble registrert først)
do $$ begin perform public.ensure_sms_contact(id) from public.cabins; end $$;

-- ---------------------------------------------------------------------
-- Veinavn
-- ---------------------------------------------------------------------
-- «Mørvikveien 209 B» → «Mørvikveien». Uten adresse brukes veinavnet i betegnelsen.
create function public.street_of(p_address text, p_label text)
returns text language sql immutable set search_path = public as $$
  select coalesce(
    nullif(trim(regexp_replace(coalesce(p_address, ''), '\s*\d+\s*[A-Za-zÆØÅæøå]?\s*$', '')), ''),
    nullif(trim(split_part(coalesce(p_label, ''), ' · ', 2)), ''));
$$;

-- Hytter som hører til en mottakergruppe (samme regler som push)
create function public.audience_cabins(s public.sender, a public.audience, p_streets text[] default '{}')
returns setof public.cabins language sql stable security definer set search_path = public as $$
  select c.* from public.cabins c
   where (c.access = 'full' or (s = 'vei' and c.vei_member))
     and case a
           when 'alle'    then true
           when 'morvika' then c.area = 'morvika'
           when 'torpum'  then c.area = 'torpum'
           when 'vel'     then c.vel_member
           when 'va'      then c.va_member
           when 'vei'     then c.vei_member
         end
     and (cardinality(coalesce(p_streets, '{}')) = 0 or public.street_of(c.address, c.label) = any (p_streets));
$$;
revoke all on function public.audience_cabins(public.sender, public.audience, text[]) from anon, authenticated, public;

-- Veinavn i en mottakergruppe, med antall hytter (til avkrysningslisten)
create function public.street_list(p_sender public.sender, p_audience public.audience)
returns table (street text, cabins int) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_send_as(p_sender) then return; end if;
  return query
    select public.street_of(c.address, c.label), count(*)::int
      from public.audience_cabins(p_sender, p_audience) c
     where public.street_of(c.address, c.label) is not null
     group by 1 order by 1;
end;
$$;
revoke all on function public.street_list(public.sender, public.audience) from anon, public;
grant execute on function public.street_list(public.sender, public.audience) to authenticated;

-- Mottakere for push: nå med veinavnfilter
drop function public.audience_members(public.sender, public.audience);
create function public.audience_members(s public.sender, a public.audience, p_streets text[] default '{}')
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select distinct o.user_id
    from public.cabin_owners o join public.audience_cabins(s, a, p_streets) c on c.id = o.cabin_id;
$$;
revoke all on function public.audience_members(public.sender, public.audience, text[]) from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- Varsler: veinavn og SMS
-- ---------------------------------------------------------------------
alter table public.alerts add column streets  text[]  not null default '{}';
alter table public.alerts add column sms      boolean not null default false;
alter table public.alerts add column sms_text text;
alter table public.alerts add constraint alerts_sms_level check (not sms or level <> 'info');
alter table public.alerts add constraint alerts_sms_text check (sms_text is null or length(sms_text) <= 459);

-- Ser brukeren varselet? Med veinavn: bare eiere av hytter i de veiene (og avsenderne)
create function public.in_my_streets(p_streets text[])
returns boolean language sql stable security definer set search_path = public as $$
  select cardinality(coalesce(p_streets, '{}')) = 0 or public.is_staff() or exists (
    select 1 from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
     where o.user_id = auth.uid() and public.street_of(c.address, c.label) = any (p_streets));
$$;
revoke all on function public.in_my_streets(text[]) from anon, public;
grant execute on function public.in_my_streets(text[]) to authenticated;

drop policy "se varsler" on public.alerts;
create policy "se varsler" on public.alerts for select to authenticated using (
  (public.can_see(sender, audience) and public.in_my_streets(streets))
  or created_by = auth.uid() or public.can_send_as(sender));

-- Hvem har bekreftet: nå med veinavnfilter
create or replace function public.alert_recipients(p_alert uuid)
returns table (person_id uuid, full_name text, cabins text, status text, acked_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare a public.alerts;
begin
  select * into a from public.alerts where id = p_alert;
  if a.id is null then return; end if;
  if not (public.can_send_as(a.sender) or a.created_by = auth.uid()) then
    raise exception 'Bare avsenderen ser hvem som har bekreftet' using errcode = '42501';
  end if;

  return query
  with mottakerhytter as (
    select c.id, c.label, c.number from public.audience_cabins(a.sender, a.audience, a.streets) c
  )
  select p.id, p.full_name,
         string_agg(h.label, ', ' order by h.number),
         case when k.acked_at is null then 'venter' else 'bekreftet' end,
         k.acked_at
    from public.cabin_owners o
    join mottakerhytter h on h.id = o.cabin_id
    join public.profiles p on p.id = o.user_id
    left join public.alert_acks k on k.alert_id = a.id and k.user_id = o.user_id
   where o.user_id is distinct from a.created_by
   group by p.id, p.full_name, k.acked_at
  union all
  select q.id, q.full_name,
         string_agg(h.label, ', ' order by h.number),
         'ikke_i_appen', null::timestamptz
    from public.pending_cabin_owners po
    join mottakerhytter h on h.id = po.cabin_id
    join public.pending_people q on q.id = po.pending_id
   group by q.id, q.full_name;
end;
$$;

-- Push for varsler bruker veinavnfilteret
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
    sender_label := public.sender_name(al.sender);
    return query
      select x.user_id,
             case al.level when 'akutt' then 'AKUTT: ' when 'viktig' then 'Viktig: ' else '' end || al.title,
             sender_label || coalesce(nullif(': ' || left(al.body, 160), ': '), ''),
             '/#varsler', 'varsel-' || al.id::text, al.level = 'akutt'
        from public.audience_members(al.sender, al.audience, al.streets) x
       where x.user_id is distinct from al.created_by;

  elsif p_table = 'news' then
    select * into nw from public.news where id = p_id and notify and created_at > now() - interval '10 minutes';
    if nw.id is null then return; end if;
    sender_label := case nw.sender when 'grunneier' then 'grunneier' when 'admin' then 'administrator' else public.sender_name(nw.sender) end;
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
                  or (t.recipient = 'va'  and ur.role = 'styre_va')
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

-- ---------------------------------------------------------------------
-- SMS: innstillinger, mottakere, logg og oppgjør
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('sms_enabled', 'false'), ('sms_from', 'Morvika'), ('sms_price', '0.60')
on conflict (key) do nothing;

create function public.sms_setting(k text)
returns text language sql stable security definer set search_path = public as $$
  select value from public.app_settings where key = k;
$$;

-- «912 34 567» → «+4791234567». Ugyldige nummer gir null.
create function public.sms_phone(p text)
returns text language sql immutable set search_path = public as $$
  select case
    when d ~ '^\+[1-9][0-9]{7,14}$' then d
    when d ~ '^00[1-9][0-9]{7,14}$' then '+' || substr(d, 3)
    when d ~ '^[49][0-9]{7}$'        then '+47' || d
    when d ~ '^47[49][0-9]{7}$'      then '+' || d
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g') as d) x;
$$;

-- SMS-mottaker for hver hytte: SMS-kontakten, eller den første med mobilnummer
create function public.sms_cabin_phones(s public.sender, a public.audience, p_streets text[])
returns table (cabin_id uuid, label text, full_name text, phone text)
language sql stable security definer set search_path = public as $$
  select distinct on (c.id) c.id, c.label, k.full_name, public.sms_phone(k.phone)
    from public.audience_cabins(s, a, p_streets) c
    join (
      select o.cabin_id, o.sms_contact, o.created_at, p.full_name, p.phone
        from public.cabin_owners o join public.profiles p on p.id = o.user_id
      union all
      select po.cabin_id, po.sms_contact, po.created_at, q.full_name, q.phone
        from public.pending_cabin_owners po join public.pending_people q on q.id = po.pending_id
    ) k on k.cabin_id = c.id
   where public.sms_phone(k.phone) is not null
   order by c.id, k.sms_contact desc, k.created_at;
$$;
revoke all on function public.sms_cabin_phones(public.sender, public.audience, text[]) from anon, authenticated, public;

-- Hvor mange SMS blir det? (vises før man sender)
create function public.sms_preview(p_sender public.sender, p_audience public.audience, p_streets text[] default '{}')
returns table (recipients int, cabins int, without_phone int)
language plpgsql stable security definer set search_path = public as $$
declare my_phone text;
begin
  if not public.can_send_as(p_sender) then return; end if;
  select public.sms_phone(phone) into my_phone from public.profiles where id = auth.uid();
  return query
    with h as (select count(*)::int n from public.audience_cabins(p_sender, p_audience, p_streets) c
                where exists (select 1 from public.cabin_owners where cabin_id = c.id)
                   or exists (select 1 from public.pending_cabin_owners where cabin_id = c.id)),
         t as (select * from public.sms_cabin_phones(p_sender, p_audience, p_streets))
    select (select count(distinct phone)::int from t where phone is distinct from my_phone),
           (select n from h),
           (select n from h) - (select count(*)::int from t);
end;
$$;
revoke all on function public.sms_preview(public.sender, public.audience, text[]) from anon, public;
grant execute on function public.sms_preview(public.sender, public.audience, text[]) to authenticated;

-- Oppgjør (må finnes før loggen som peker på det)
create table public.sms_settlements (
  id             uuid primary key default gen_random_uuid(),
  settled_at     timestamptz not null default now(),
  invoice_amount numeric(10,2),                -- beløpet på regningen, i kroner
  note           text not null default '',
  breakdown      jsonb not null default '[]',  -- [{sender, sms, parts, share, amount}]
  created_by     uuid default auth.uid() references public.profiles (id) on delete set null
);
alter table public.sms_settlements enable row level security;
create policy "se oppgjør" on public.sms_settlements for select to authenticated using (
  public.is_staff() or public.has_role('styre_vel') or public.has_role('styre_va') or public.has_role('styre_vei'));
grant select on public.sms_settlements to authenticated;

-- Testmeldinger fra Administrasjon → SMS
create table public.sms_tests (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null,
  status     text not null default 'venter' check (status in ('venter', 'sendt', 'feilet')),
  error      text,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.sms_tests enable row level security;
create policy "admin: test-SMS" on public.sms_tests for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin') and created_by = auth.uid());
grant select, insert on public.sms_tests to authenticated;
grant select, update on public.sms_tests to service_role;
create trigger push_sms_test after insert on public.sms_tests for each row execute function public.notify_push();

-- Hver sendte SMS
create table public.sms_log (
  id            uuid primary key default gen_random_uuid(),
  alert_id      uuid references public.alerts (id) on delete set null,
  test_id       uuid references public.sms_tests (id) on delete set null,
  sender        public.sender not null,
  phone         text not null,
  person_name   text not null default '',
  cabin_label   text not null default '',
  status        text not null check (status in ('sendt', 'feilet')),
  parts         int not null default 0,
  cost          numeric(12,4),                 -- slik 46elks oppgir den (valuta på kontoen)
  provider_id   text,
  error         text,
  settlement_id uuid references public.sms_settlements (id),
  created_at    timestamptz not null default now()
);
create index on public.sms_log (alert_id);
create index on public.sms_log (settlement_id) where settlement_id is null;
alter table public.sms_log enable row level security;
-- Loggen har mobilnumre, så bare grunneier og administrator ser den. Styrene ser tall (sms_usage, sms_alert_status).
create policy "se SMS-logg" on public.sms_log for select to authenticated using (public.is_staff());
grant select on public.sms_log to authenticated;

-- SMS-status per varsel for avsenderne
create function public.sms_alert_status(p_alerts uuid[])
returns table (alert_id uuid, sent int, failed int)
language sql stable security definer set search_path = public as $$
  select l.alert_id, count(*) filter (where l.status = 'sendt')::int, count(*) filter (where l.status = 'feilet')::int
    from public.sms_log l join public.alerts a on a.id = l.alert_id
   where l.alert_id = any (p_alerts) and (public.is_staff() or public.can_send_as(a.sender) or a.created_by = auth.uid())
   group by l.alert_id;
$$;
revoke all on function public.sms_alert_status(uuid[]) from anon, public;
grant execute on function public.sms_alert_status(uuid[]) to authenticated;

-- Hva som skal sendes for et varsel (brukes av Edge Function «push», én gang per varsel)
create function public.sms_targets(p_alert uuid)
returns table (phone text, full_name text, cabins text, message text, sender public.sender, sms_from text)
language plpgsql security definer set search_path = public as $$
declare al public.alerts; n int; txt text; my_phone text;
begin
  if coalesce(public.sms_setting('sms_enabled'), 'false') <> 'true' then return; end if;
  select * into al from public.alerts where id = p_alert and sms and created_at > now() - interval '10 minutes';
  if al.id is null then return; end if;
  insert into public.push_log (table_name, record_id) values ('sms', p_alert) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return; end if;

  txt := coalesce(nullif(trim(al.sms_text), ''),
                  left(case al.level when 'akutt' then 'AKUTT fra ' else '' end || public.sender_name(al.sender) || ': ' || al.title
                       || coalesce(nullif(case when al.title ~ '[.!?:]\s*$' then ' ' else '. ' end || trim(al.body), case when al.title ~ '[.!?:]\s*$' then ' ' else '. ' end), ''), 459));
  select public.sms_phone(p.phone) into my_phone from public.profiles p where p.id = al.created_by;
  return query
    select t.phone, min(t.full_name), string_agg(t.label, ', ' order by t.label), txt, al.sender,
           coalesce(nullif(public.sms_setting('sms_from'), ''), 'Morvika')
      from public.sms_cabin_phones(al.sender, al.audience, al.streets) t
     where t.phone is distinct from my_phone
     group by t.phone;
end;
$$;
revoke all on function public.sms_targets(uuid) from anon, authenticated, public;
grant execute on function public.sms_targets(uuid) to service_role;

-- Test-SMS: telefonnummer og tekst (én gang per test)
create function public.sms_test_target(p_test uuid)
returns table (phone text, message text, sms_from text)
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.push_log (table_name, record_id) values ('sms_tests', p_test) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return; end if;
  return query
    select public.sms_phone(t.phone), 'Test fra Mørvika-appen: SMS-varsling virker.',
           coalesce(nullif(public.sms_setting('sms_from'), ''), 'Morvika')
      from public.sms_tests t where t.id = p_test and t.created_at > now() - interval '10 minutes';
end;
$$;
revoke all on function public.sms_test_target(uuid) from anon, authenticated, public;
grant execute on function public.sms_test_target(uuid) to service_role;

-- Edge Function lagrer resultatet
create function public.sms_record(p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.sms_log (alert_id, test_id, sender, phone, person_name, cabin_label, status, parts, cost, provider_id, error)
  select (r ->> 'alert_id')::uuid, (r ->> 'test_id')::uuid, (r ->> 'sender')::public.sender, r ->> 'phone',
         coalesce(r ->> 'person_name', ''), coalesce(r ->> 'cabin_label', ''), r ->> 'status',
         coalesce((r ->> 'parts')::int, 0), (r ->> 'cost')::numeric, r ->> 'provider_id', r ->> 'error'
    from jsonb_array_elements(p_rows) r;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.sms_record(jsonb) from anon, authenticated, public;
grant execute on function public.sms_record(jsonb) to service_role;

-- Forbruk siden forrige oppgjør, per avsender
create function public.sms_usage()
returns table (sender public.sender, sms int, parts int, failed int, cost numeric)
language sql stable security definer set search_path = public as $$
  select l.sender,
         count(*) filter (where l.status = 'sendt')::int,
         coalesce(sum(l.parts) filter (where l.status = 'sendt'), 0)::int,
         count(*) filter (where l.status = 'feilet')::int,
         sum(l.cost) filter (where l.status = 'sendt')
    from public.sms_log l
   where l.settlement_id is null and (public.is_staff() or public.can_send_as(l.sender))
   group by l.sender
   order by l.sender;
$$;
revoke all on function public.sms_usage() from anon, public;
grant execute on function public.sms_usage() to authenticated;

-- Registrer oppgjør: fordel regningen etter antall SMS-deler og start på nytt
create function public.sms_settle(p_amount numeric, p_note text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare total int; b jsonb; sid uuid;
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator kan registrere oppgjør' using errcode = '42501';
  end if;
  select coalesce(sum(parts), 0) into total from public.sms_log where settlement_id is null and status = 'sendt';
  if total = 0 then raise exception 'Det er ingen SMS å gjøre opp'; end if;
  select jsonb_agg(jsonb_build_object(
           'sender', x.sender, 'sms', x.sms, 'parts', x.parts,
           'share', round(x.parts::numeric / total, 4),
           'amount', case when p_amount is null then null else round(p_amount * x.parts / total, 2) end)
         order by x.parts desc)
    into b
    from (select l.sender, count(*)::int sms, sum(l.parts)::int parts
            from public.sms_log l where l.settlement_id is null and l.status = 'sendt' group by l.sender) x;
  insert into public.sms_settlements (invoice_amount, note, breakdown)
  values (p_amount, coalesce(p_note, ''), b) returning id into sid;
  update public.sms_log set settlement_id = sid where settlement_id is null;
  return sid;
end;
$$;
revoke all on function public.sms_settle(numeric, text) from anon, public;
grant execute on function public.sms_settle(numeric, text) to authenticated;
