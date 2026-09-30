-- =====================================================================
-- Mørvika Hytteområde · Kjøper under oppføring og prosjektsamtale
--
--   * Prosjektmedarbeidere får en type: «medarbeider» (håndverker) eller
--     «kjoper» (kjøper av hytte under oppføring). Begge ser dokumenter og
--     bilder, laster opp og endrer bare egne opplastinger.
--   * Prosjektsamtale per hytte: eier, medarbeidere og kjøper skriver
--     sammen, med bilder og PDF-vedlegg. Push-varsel ved nye meldinger.
--   * «Avtalt endring»: en melding kan merkes, og kjøperen kan bekrefte.
--   * Ved overlevering fra utbygger følger samtalen med til kjøper og blir
--     skrivebeskyttet historikk. Medarbeiderne mister tilgangen.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Type prosjektdeltaker
-- ---------------------------------------------------------------------
alter table public.cabin_workers
  add column kind text not null default 'medarbeider' check (kind in ('medarbeider', 'kjoper'));
alter table public.pending_cabin_workers
  add column kind text not null default 'medarbeider' check (kind in ('medarbeider', 'kjoper'));

drop function public.admin_add_worker(uuid, text, text, text);
create function public.admin_add_worker(p_cabin uuid, p_name text, p_email text, p_phone text default null, p_kind text default 'medarbeider')
returns text language plpgsql security definer set search_path = public as $$
declare e text := nullif(lower(trim(coalesce(p_email, ''))), ''); u uuid; pid uuid;
        k text := case when p_kind = 'kjoper' then 'kjoper' else 'medarbeider' end;
begin
  if not public.has_role('admin') then
    raise exception 'Bare administrator kan legge til prosjektmedarbeidere' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Navn mangler'; end if;
  if e is null then raise exception 'E-post mangler (brukes til innlogging)'; end if;
  if not exists (select 1 from public.cabins where id = p_cabin and access = 'full') then
    raise exception 'Prosjektmedarbeidere kan bare legges til hytter med full tilgang';
  end if;
  if not exists (select 1 from public.ownerships where cabin_id = p_cabin and ends_on is null) then
    insert into public.ownerships (cabin_id) values (p_cabin);
  end if;

  select id into u from public.profiles where lower(email) = e;
  if u is not null then
    insert into public.cabin_workers (cabin_id, user_id, kind) values (p_cabin, u, k)
      on conflict (cabin_id, user_id) do update set kind = excluded.kind;
    return 'koblet';
  end if;
  select id into pid from public.pending_people where lower(email) = e;
  if pid is null then
    insert into public.pending_people (full_name, email, phone)
    values (trim(p_name), e, nullif(trim(coalesce(p_phone, '')), '')) returning id into pid;
  end if;
  insert into public.pending_cabin_workers (pending_id, cabin_id, kind) values (pid, p_cabin, k)
    on conflict (pending_id, cabin_id) do update set kind = excluded.kind;
  return 'venter';
end;
$$;

-- Ved første innlogging følger typen med
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
    insert into public.cabin_owners (cabin_id, user_id, created_at, sms_contact)
      select cabin_id, new.id, created_at, sms_contact from public.pending_cabin_owners where pending_id = p.id
      on conflict do nothing;
    insert into public.cabin_workers (cabin_id, user_id, created_at, kind)
      select cabin_id, new.id, created_at, kind from public.pending_cabin_workers where pending_id = p.id
      on conflict do nothing;
    delete from public.pending_people where id = p.id;
  end if;
  return new;
end;
$$;

drop function public.my_worker_cabins();
create function public.my_worker_cabins()
returns table (cabin_id uuid, label text, number int, gnr int, bnr int, ownership_id uuid, fdv boolean, project_name text, kind text)
language sql stable security definer set search_path = public as $$
  select c.id, c.label, c.number, c.gnr, c.bnr, w.id, w.fdv, c.project_name, k.kind
    from public.cabin_workers k
    join public.cabins c on c.id = k.cabin_id and c.access = 'full'
    join public.ownerships w on w.cabin_id = c.id and w.ends_on is null
   where k.user_id = auth.uid()
   order by c.project_name nulls last, c.area, c.number;
$$;

drop function public.admin_people();
create function public.admin_people()
returns table (
  id uuid, status text, full_name text, email text, phone text,
  roles public.app_role[], cabin_ids uuid[], last_seen_at timestamptz, created_at timestamptz, sms_cabin_ids uuid[],
  worker_cabin_ids uuid[], buyer_cabin_ids uuid[])
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
           coalesce((select array_agg(o.cabin_id) from public.cabin_owners o where o.user_id = p.id and o.sms_contact), '{}'),
           coalesce((select array_agg(k.cabin_id order by k.created_at) from public.cabin_workers k where k.user_id = p.id), '{}'),
           coalesce((select array_agg(k.cabin_id) from public.cabin_workers k where k.user_id = p.id and k.kind = 'kjoper'), '{}')
      from public.profiles p
    union all
    select q.id, case when q.email is null then 'mangler_epost' else 'venter' end,
           q.full_name, q.email, q.phone, q.roles,
           coalesce((select array_agg(c.cabin_id order by c.created_at) from public.pending_cabin_owners c where c.pending_id = q.id), '{}'),
           null::timestamptz, q.created_at,
           coalesce((select array_agg(c.cabin_id) from public.pending_cabin_owners c where c.pending_id = q.id and c.sms_contact), '{}'),
           coalesce((select array_agg(k.cabin_id order by k.created_at) from public.pending_cabin_workers k where k.pending_id = q.id), '{}'),
           coalesce((select array_agg(k.cabin_id) from public.pending_cabin_workers k where k.pending_id = q.id and k.kind = 'kjoper'), '{}')
      from public.pending_people q;
end;
$$;

-- ---------------------------------------------------------------------
-- Prosjektsamtale
-- ---------------------------------------------------------------------
create table public.project_messages (
  id                  uuid primary key default gen_random_uuid(),
  cabin_id            uuid not null references public.cabins (id) on delete cascade,
  ownership_id        uuid not null references public.ownerships (id) on delete cascade,
  author_id           uuid default auth.uid() references public.profiles (id) on delete set null,
  body                text not null default '',
  -- [{ "path": "<ownership>/chat/…", "name": "Tegning.pdf", "type": "application/pdf", "size": 12345 }]
  attachments         jsonb not null default '[]',
  change_marked_at    timestamptz,
  change_marked_by    uuid references public.profiles (id) on delete set null,
  change_confirmed_at timestamptz,
  change_confirmed_by uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  check (body <> '' or jsonb_array_length(attachments) > 0)
);
create index project_messages_ownership on public.project_messages (ownership_id, created_at);
create trigger fill_ownership before insert on public.project_messages for each row execute function public.fill_ownership();

-- Samtalen er åpen så lenge eierperioden er åpen og hytta ikke er overlevert fra utbygger
create function public.project_chat_open(w uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ownerships where id = w and ends_on is null)
     and not exists (select 1 from public.ownership_transfers where to_ownership = w and from_builder);
$$;

alter table public.project_messages enable row level security;
create policy "les prosjektsamtale" on public.project_messages for select to authenticated
  using (public.can_read_ownership(ownership_id) or public.is_cabin_worker(ownership_id));
create policy "skriv i prosjektsamtale" on public.project_messages for insert to authenticated
  with check (author_id = auth.uid() and change_marked_at is null and change_confirmed_at is null
              and (public.can_write_ownership(ownership_id) or public.is_cabin_worker(ownership_id))
              and public.project_chat_open(ownership_id));
create policy "slett egen melding" on public.project_messages for delete to authenticated
  using (author_id = auth.uid() and change_marked_at is null and public.project_chat_open(ownership_id)
         and (public.can_write_ownership(ownership_id) or public.is_cabin_worker(ownership_id)));
grant select, insert, delete on public.project_messages to authenticated;

-- Vedlegg kan leses av dem som ser meldingen
create policy "hytte: vedlegg i prosjektsamtale" on storage.objects for select to authenticated using (
  bucket_id = 'hytte' and exists (
    select 1 from public.project_messages m
     where m.attachments @> jsonb_build_array(jsonb_build_object('path', objects.name))));

-- Hvem er med i samtalen
create function public.project_participants(w uuid)
returns table (id uuid, full_name text, role text, active boolean)
language sql stable security definer set search_path = public as $$
  select x.id, x.full_name, x.role, x.active from (
    select p.id, p.full_name, 'eier'::text as role, true as active, 0 as ord
      from public.cabin_owners o join public.profiles p on p.id = o.user_id
     where o.ownership_id = w
    union all
    select p.id, p.full_name, k.kind, true, case k.kind when 'kjoper' then 1 else 2 end
      from public.ownerships s
      join public.cabin_workers k on k.cabin_id = s.cabin_id
      join public.profiles p on p.id = k.user_id
     where s.id = w and s.ends_on is null
    union all
    select q.id, q.full_name, k.kind, false, case k.kind when 'kjoper' then 1 else 2 end
      from public.ownerships s
      join public.pending_cabin_workers k on k.cabin_id = s.cabin_id
      join public.pending_people q on q.id = k.pending_id
     where s.id = w and s.ends_on is null
  ) x
  where public.can_read_ownership(w) or public.is_cabin_worker(w)
  order by x.ord, x.full_name;
$$;

-- Merk (eller fjern merket) «avtalt endring»
create function public.project_mark_change(p_msg uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare m public.project_messages;
begin
  select * into m from public.project_messages where id = p_msg;
  if m.id is null then raise exception 'Meldingen finnes ikke'; end if;
  if not ((public.can_write_ownership(m.ownership_id) or public.is_cabin_worker(m.ownership_id)) and public.project_chat_open(m.ownership_id)) then
    raise exception 'Du kan ikke endre denne samtalen' using errcode = '42501';
  end if;
  if m.change_confirmed_at is not null then raise exception 'Endringen er allerede bekreftet av kjøper'; end if;
  update public.project_messages
     set change_marked_at = case when p_on then now() end,
         change_marked_by = case when p_on then auth.uid() end
   where id = p_msg;
end;
$$;

-- Kjøperen bekrefter en avtalt endring
create function public.project_confirm_change(p_msg uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.project_messages;
begin
  select * into m from public.project_messages where id = p_msg;
  if m.id is null or m.change_marked_at is null then raise exception 'Meldingen er ikke merket som avtalt endring'; end if;
  if not public.project_chat_open(m.ownership_id) or not exists (
       select 1 from public.cabin_workers where cabin_id = m.cabin_id and user_id = auth.uid() and kind = 'kjoper') then
    raise exception 'Bare kjøperen kan bekrefte endringer' using errcode = '42501';
  end if;
  update public.project_messages set change_confirmed_at = now(), change_confirmed_by = auth.uid()
   where id = p_msg and change_confirmed_at is null;
end;
$$;

-- Ved overlevering fra utbygger følger samtalen med til kjøperen
create function public.move_project_chat()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.from_builder then
    update public.project_messages set ownership_id = new.to_ownership where ownership_id = new.from_ownership;
  end if;
  return new;
end;
$$;
create trigger move_project_chat after insert on public.ownership_transfers
  for each row execute function public.move_project_chat();

-- ---------------------------------------------------------------------
-- Push ved ny melding i prosjektsamtalen
-- (push_targets pakkes inn: alt annet går videre til den eksisterende)
-- ---------------------------------------------------------------------
alter function public.push_targets(text, uuid) rename to push_targets_base;

create function public.push_targets(p_table text, p_id uuid)
returns table (user_id uuid, title text, body text, url text, tag text, urgent boolean)
language plpgsql security definer set search_path = public as $$
declare n int; m public.project_messages; who text; what text;
begin
  if p_table <> 'project_messages' then
    return query select * from public.push_targets_base(p_table, p_id);
    return;
  end if;
  insert into public.push_log (table_name, record_id) values (p_table, p_id) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return; end if;
  select * into m from public.project_messages where id = p_id and created_at > now() - interval '10 minutes';
  if m.id is null then return; end if;
  select coalesce(nullif(full_name, ''), 'Ny melding') into who from public.profiles where id = m.author_id;
  select coalesce(c.project_name, c.label) into what from public.cabins c where c.id = m.cabin_id;
  return query
    select u.uid, 'Prosjektsamtale · ' || what,
           coalesce(who, 'Ny melding') || ': ' || case when m.body <> '' then left(m.body, 160)
             else 'sendte ' || jsonb_array_length(m.attachments) || ' vedlegg' end,
           '/#minhytte', 'prosjekt-' || m.cabin_id::text, false
      from (select o.user_id as uid from public.cabin_owners o where o.ownership_id = m.ownership_id
            union
            select k.user_id from public.cabin_workers k
              join public.ownerships w on w.cabin_id = k.cabin_id
             where w.id = m.ownership_id and w.ends_on is null) u
     where u.uid is distinct from m.author_id;
end;
$$;
create trigger push_project_message after insert on public.project_messages for each row execute function public.notify_push();

revoke all on function public.push_targets(text, uuid), public.push_targets_base(text, uuid) from anon, authenticated, public;
grant execute on function public.push_targets(text, uuid) to service_role;

revoke all on function
  public.admin_add_worker(uuid, text, text, text, text), public.my_worker_cabins(), public.admin_people(),
  public.project_chat_open(uuid), public.project_participants(uuid),
  public.project_mark_change(uuid, boolean), public.project_confirm_change(uuid)
from anon, public;
grant execute on function
  public.admin_add_worker(uuid, text, text, text, text), public.my_worker_cabins(), public.admin_people(),
  public.project_chat_open(uuid), public.project_participants(uuid),
  public.project_mark_change(uuid, boolean), public.project_confirm_change(uuid)
to authenticated;
