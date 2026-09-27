-- =====================================================================
-- Mørvika Hytteområde · fase 1: grunnmur
--
-- Tabeller, tilgangsregler (RLS) og lagring for hele appen.
-- Kjøres én gang i Supabase: SQL Editor → lim inn → Run.
--
-- Prinsipper:
--   * Alle tabeller har Row Level Security. Ingenting er åpent for
--     anonyme brukere (anon); bare innloggede (authenticated).
--   * "Beboer" = en innlogget person som eier minst én hytte eller har
--     en rolle. Andre innloggede ser ingenting.
--   * Min hytte (dokumenter, bilder, regnskap) er bare tilgjengelig for
--     hyttas eiere. Grunneier og administrator har ingen unntak.
--   * Den aller første brukeren som opprettes, blir grunneier og
--     administrator. Alle senere brukere legges inn av administrator.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Typer
-- ---------------------------------------------------------------------
create type public.area        as enum ('morvika', 'sandbukta');
create type public.app_role    as enum ('grunneier', 'styre_vel', 'styre_vei', 'admin');
create type public.audience    as enum ('alle', 'morvika', 'sandbukta', 'vel', 'vei');
create type public.sender      as enum ('grunneier', 'vel', 'vei', 'admin');
create type public.recipient   as enum ('grunneier', 'vel', 'vei');
create type public.alert_level as enum ('akutt', 'viktig', 'info');
create type public.post_group  as enum ('generelt', 'kjop', 'hjelp');
create type public.ledger_kind as enum ('ut', 'inn');

-- ---------------------------------------------------------------------
-- Hytter, personer, roller og eierskap
-- ---------------------------------------------------------------------
create table public.cabins (
  id          uuid primary key default gen_random_uuid(),
  area        public.area not null,
  number      int  not null check (number > 0),
  label       text not null,                 -- "Hytte 47", "Sandbukta 6"
  gnr         int,
  bnr         int,
  address     text,
  vel_member  boolean not null default false,
  vei_member  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (area, number)
);

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text not null default '',
  email        text,
  phone        text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);

create table public.user_roles (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.cabin_owners (
  cabin_id   uuid not null references public.cabins (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (cabin_id, user_id)
);
create index on public.cabin_owners (user_id);

-- ---------------------------------------------------------------------
-- Hjelpefunksjoner for tilgangsreglene
-- (security definer, så reglene ikke går i sirkel)
-- ---------------------------------------------------------------------
create function public.has_role(r public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = r);
$$;

create function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('grunneier') or public.has_role('admin');
$$;

create function public.owns_cabin(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cabin_owners where cabin_id = c and user_id = auth.uid());
$$;

create function public.is_resident()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cabin_owners where user_id = auth.uid())
      or exists (select 1 from public.user_roles  where user_id = auth.uid());
$$;

-- Kan innlogget bruker publisere som denne avsenderen?
create function public.can_send_as(s public.sender)
returns boolean language sql stable security definer set search_path = public as $$
  select case s
    when 'grunneier' then public.has_role('grunneier')
    when 'vel'       then public.has_role('styre_vel')
    when 'vei'       then public.has_role('styre_vei')
    when 'admin'     then public.has_role('admin')
  end;
$$;

-- Tar innlogget bruker imot meldinger sendt til denne mottakeren?
create function public.handles_recipient(r public.recipient)
returns boolean language sql stable security definer set search_path = public as $$
  select case r
    when 'grunneier' then public.has_role('grunneier')
    when 'vel'       then public.has_role('styre_vel')
    when 'vei'       then public.has_role('styre_vei')
  end;
$$;

-- Er innlogget bruker i denne mottakergruppen?
create function public.in_audience(a public.audience)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() or case a
    when 'alle'      then public.is_resident()
    when 'morvika'   then exists (select 1 from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
                                  where o.user_id = auth.uid() and c.area = 'morvika')
    when 'sandbukta' then exists (select 1 from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
                                  where o.user_id = auth.uid() and c.area = 'sandbukta')
    when 'vel'       then public.has_role('styre_vel') or exists (
                            select 1 from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
                            where o.user_id = auth.uid() and c.vel_member)
    when 'vei'       then public.has_role('styre_vei') or exists (
                            select 1 from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
                            where o.user_id = auth.uid() and c.vei_member)
  end;
$$;

-- Antall hytteeiere i en mottakergruppe (for "Lest av 97 av 142").
-- Bare de som kan sende til gruppen får et tall.
create function public.audience_size(a public.audience)
returns int language sql stable security definer set search_path = public as $$
  select case when not (public.is_staff() or public.has_role('styre_vel') or public.has_role('styre_vei')) then null
  else (
    select count(distinct o.user_id)::int
    from public.cabin_owners o join public.cabins c on c.id = o.cabin_id
    where case a
      when 'alle'      then true
      when 'morvika'   then c.area = 'morvika'
      when 'sandbukta' then c.area = 'sandbukta'
      when 'vel'       then c.vel_member
      when 'vei'       then c.vei_member
    end
  ) end;
$$;

-- ---------------------------------------------------------------------
-- Ny bruker: lag profil. Første bruker blir grunneier og administrator.
-- ---------------------------------------------------------------------
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (new.id,
          coalesce(new.raw_user_meta_data ->> 'full_name', ''),
          new.email,
          new.phone);

  if not exists (select 1 from public.user_roles where role = 'admin') then
    insert into public.user_roles (user_id, role) values (new.id, 'admin'), (new.id, 'grunneier');
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Nyheter
-- ---------------------------------------------------------------------
create table public.news (
  id         uuid primary key default gen_random_uuid(),
  sender     public.sender   not null,
  audience   public.audience not null default 'alle',
  title      text not null check (length(title) between 1 and 200),
  body       text not null default '',
  notify     boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.news (created_at desc);

create table public.news_reads (
  news_id uuid not null references public.news (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (news_id, user_id)
);

-- ---------------------------------------------------------------------
-- Varsler
-- ---------------------------------------------------------------------
create table public.alerts (
  id         uuid primary key default gen_random_uuid(),
  level      public.alert_level not null default 'viktig',
  sender     public.sender   not null,
  audience   public.audience not null default 'alle',
  title      text not null check (length(title) between 1 and 200),
  body       text not null default '',
  channels   text[] not null default '{push}',
  created_by uuid not null default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.alerts (created_at desc);

create table public.alert_acks (
  alert_id uuid not null references public.alerts (id) on delete cascade,
  user_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  acked_at timestamptz not null default now(),
  primary key (alert_id, user_id)
);

-- ---------------------------------------------------------------------
-- Meldinger mellom hytteeier og grunneier eller styrene
-- ---------------------------------------------------------------------
create table public.threads (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  recipient       public.recipient not null,
  subject         text not null check (length(subject) between 1 and 200),
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index on public.threads (owner_id);

create function public.can_see_thread(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.threads
    where id = t and (owner_id = auth.uid() or public.handles_recipient(recipient))
  );
$$;

create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.threads (id) on delete cascade,
  author_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body       text not null default '',
  images     text[] not null default '{}',     -- stier i bøtta "meldinger"
  created_at timestamptz not null default now(),
  check (length(body) > 0 or cardinality(images) > 0)
);
create index on public.messages (thread_id, created_at);

create table public.thread_reads (
  thread_id uuid not null references public.threads (id) on delete cascade,
  user_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  read_at   timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create function public.touch_thread()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.threads set last_message_at = new.created_at where id = new.thread_id;
  return new;
end;
$$;
create trigger on_message_created after insert on public.messages
  for each row execute function public.touch_thread();

-- ---------------------------------------------------------------------
-- Hyttepraten
-- ---------------------------------------------------------------------
create table public.posts (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  grp        public.post_group not null default 'generelt',
  body       text not null default '',
  images     text[] not null default '{}',     -- stier i bøtta "praten"
  created_at timestamptz not null default now(),
  check (length(body) > 0 or cardinality(images) > 0)
);
create index on public.posts (created_at desc);

create table public.post_likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  author_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body       text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index on public.post_comments (post_id, created_at);

-- ---------------------------------------------------------------------
-- Arrangementer og dugnad
-- ---------------------------------------------------------------------
create table public.events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(title) between 1 and 200),
  starts_at   timestamptz not null,
  place       text not null default '',
  description text not null default '',
  organizer   public.sender   not null,
  audience    public.audience not null default 'alle',
  created_by  uuid not null default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on public.events (starts_at);

create table public.event_attendees (
  event_id   uuid not null references public.events (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- ---------------------------------------------------------------------
-- Felles dokumenter (vedtekter, brøyteplan, kart …)
-- ---------------------------------------------------------------------
create table public.shared_documents (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  owner        public.sender not null,          -- hvem dokumentet hører til
  storage_path text not null,                   -- sti i bøtta "dokumenter"
  created_by   uuid not null default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Min hytte (privat for hyttas eiere)
-- ---------------------------------------------------------------------
create table public.cabin_documents (
  id           uuid primary key default gen_random_uuid(),
  cabin_id     uuid not null references public.cabins (id) on delete cascade,
  folder       text not null default 'Kontrakter',
  name         text not null,
  storage_path text not null,                   -- sti i bøtta "hytte": <cabin_id>/…
  size_bytes   bigint,
  uploaded_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create table public.cabin_albums (
  id         uuid primary key default gen_random_uuid(),
  cabin_id   uuid not null references public.cabins (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (cabin_id, name)
);

create table public.cabin_photos (
  id           uuid primary key default gen_random_uuid(),
  cabin_id     uuid not null references public.cabins (id) on delete cascade,
  album_id     uuid references public.cabin_albums (id) on delete set null,
  caption      text not null default '',
  storage_path text not null,
  created_at   timestamptz not null default now()
);

create table public.cabin_ledger (
  id          uuid primary key default gen_random_uuid(),
  cabin_id    uuid not null references public.cabins (id) on delete cascade,
  entry_date  date not null default current_date,
  description text not null,
  category    text not null default 'Annet',
  amount      numeric(12, 2) not null check (amount > 0),
  kind        public.ledger_kind not null default 'ut',
  created_at  timestamptz not null default now()
);
create index on public.cabin_ledger (cabin_id, entry_date desc);

-- ---------------------------------------------------------------------
-- Varslingsinnstillinger og push-abonnement
-- ---------------------------------------------------------------------
create table public.notification_prefs (
  user_id   uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  news      boolean not null default true,
  messages  boolean not null default true,
  praten    boolean not null default true,
  events    boolean not null default false
);

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Tilgangsregler (RLS)
-- =====================================================================
alter table public.cabins             enable row level security;
alter table public.profiles           enable row level security;
alter table public.user_roles         enable row level security;
alter table public.cabin_owners       enable row level security;
alter table public.news               enable row level security;
alter table public.news_reads         enable row level security;
alter table public.alerts             enable row level security;
alter table public.alert_acks         enable row level security;
alter table public.threads            enable row level security;
alter table public.messages           enable row level security;
alter table public.thread_reads       enable row level security;
alter table public.posts              enable row level security;
alter table public.post_likes         enable row level security;
alter table public.post_comments      enable row level security;
alter table public.events             enable row level security;
alter table public.event_attendees    enable row level security;
alter table public.shared_documents   enable row level security;
alter table public.cabin_documents    enable row level security;
alter table public.cabin_albums       enable row level security;
alter table public.cabin_photos       enable row level security;
alter table public.cabin_ledger       enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.push_subscriptions enable row level security;

-- Hytter og eierskap: alle beboere ser dem, bare administrator endrer
create policy "beboere ser hytter"   on public.cabins for select to authenticated using (public.is_resident());
create policy "admin endrer hytter"  on public.cabins for all    to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

create policy "beboere ser eierskap"  on public.cabin_owners for select to authenticated using (public.is_resident());
create policy "admin endrer eierskap" on public.cabin_owners for all    to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

-- Profiler: beboere ser navn (e-post og telefon er skjult med kolonnerettigheter under)
create policy "se profiler"        on public.profiles for select to authenticated using (id = auth.uid() or public.is_resident());
create policy "endre egen profil"  on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "admin endrer profiler" on public.profiles for update to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

-- Roller: beboere ser hvem som er grunneier og styre, bare administrator endrer
create policy "se roller"          on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_resident());
create policy "admin endrer roller" on public.user_roles for all   to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

-- Nyheter
create policy "se nyheter"      on public.news for select to authenticated using (public.in_audience(audience) or created_by = auth.uid());
create policy "publisere"       on public.news for insert to authenticated with check (public.can_send_as(sender) and created_by = auth.uid());
create policy "endre egne"      on public.news for update to authenticated using (created_by = auth.uid()) with check (public.can_send_as(sender));
create policy "slette nyheter"  on public.news for delete to authenticated using (created_by = auth.uid() or public.has_role('admin'));

create policy "se lesninger" on public.news_reads for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.news n where n.id = news_id and public.can_send_as(n.sender)));
create policy "merke som lest" on public.news_reads for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.news n where n.id = news_id));

-- Varsler
create policy "se varsler"     on public.alerts for select to authenticated using (public.in_audience(audience) or created_by = auth.uid());
create policy "sende varsel"   on public.alerts for insert to authenticated with check (public.can_send_as(sender) and created_by = auth.uid());
create policy "slette varsel"  on public.alerts for delete to authenticated using (created_by = auth.uid() or public.has_role('admin'));

create policy "se bekreftelser" on public.alert_acks for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.alerts a where a.id = alert_id and public.can_send_as(a.sender)));
create policy "bekrefte varsel" on public.alert_acks for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.alerts a where a.id = alert_id));

-- Meldinger
create policy "se samtaler"    on public.threads for select to authenticated using (owner_id = auth.uid() or public.handles_recipient(recipient));
create policy "starte samtale" on public.threads for insert to authenticated with check (owner_id = auth.uid() and public.is_resident());

create policy "se meldinger"   on public.messages for select to authenticated using (public.can_see_thread(thread_id));
create policy "skrive melding" on public.messages for insert to authenticated with check (author_id = auth.uid() and public.can_see_thread(thread_id));

create policy "egne lesemerker" on public.thread_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_see_thread(thread_id));

-- Hyttepraten
create policy "se innlegg"      on public.posts for select to authenticated using (public.is_resident());
create policy "skrive innlegg"  on public.posts for insert to authenticated with check (author_id = auth.uid() and public.is_resident());
create policy "endre eget"      on public.posts for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "slette innlegg"  on public.posts for delete to authenticated using (author_id = auth.uid() or public.has_role('admin'));

create policy "se likes"   on public.post_likes for select to authenticated using (public.is_resident());
create policy "like"       on public.post_likes for insert to authenticated with check (user_id = auth.uid() and public.is_resident());
create policy "fjerne like" on public.post_likes for delete to authenticated using (user_id = auth.uid());

create policy "se kommentarer"      on public.post_comments for select to authenticated using (public.is_resident());
create policy "kommentere"          on public.post_comments for insert to authenticated with check (author_id = auth.uid() and public.is_resident());
create policy "slette kommentar"    on public.post_comments for delete to authenticated using (author_id = auth.uid() or public.has_role('admin'));

-- Arrangementer
create policy "se arrangementer"     on public.events for select to authenticated using (public.in_audience(audience) or created_by = auth.uid());
create policy "lage arrangement"     on public.events for insert to authenticated with check (public.can_send_as(organizer) and organizer <> 'admin' and created_by = auth.uid());
create policy "endre arrangement"    on public.events for update to authenticated using (created_by = auth.uid()) with check (public.can_send_as(organizer));
create policy "slette arrangement"   on public.events for delete to authenticated using (created_by = auth.uid() or public.has_role('admin'));

create policy "se påmeldte"  on public.event_attendees for select to authenticated using (
  exists (select 1 from public.events e where e.id = event_id));
create policy "melde på"     on public.event_attendees for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.events e where e.id = event_id));
create policy "melde av"     on public.event_attendees for delete to authenticated using (user_id = auth.uid());

-- Felles dokumenter
create policy "se felles dokumenter"  on public.shared_documents for select to authenticated using (public.is_resident());
create policy "legge ut dokument"     on public.shared_documents for insert to authenticated with check (public.can_send_as(owner) and created_by = auth.uid());
create policy "slette dokument"       on public.shared_documents for delete to authenticated using (created_by = auth.uid() or public.has_role('admin'));

-- Min hytte: bare hyttas eiere. Ingen unntak for grunneier eller administrator.
create policy "eiere: dokumenter" on public.cabin_documents for all to authenticated using (public.owns_cabin(cabin_id)) with check (public.owns_cabin(cabin_id));
create policy "eiere: album"      on public.cabin_albums    for all to authenticated using (public.owns_cabin(cabin_id)) with check (public.owns_cabin(cabin_id));
create policy "eiere: bilder"     on public.cabin_photos    for all to authenticated using (public.owns_cabin(cabin_id)) with check (public.owns_cabin(cabin_id));
create policy "eiere: regnskap"   on public.cabin_ledger    for all to authenticated using (public.owns_cabin(cabin_id)) with check (public.owns_cabin(cabin_id));

-- Egne innstillinger
create policy "egne varslingsvalg" on public.notification_prefs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "egne push-abonnement" on public.push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =====================================================================
-- Rettigheter (nye tabeller er ikke automatisk åpne i dette prosjektet)
-- =====================================================================
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon, public;

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.cabins, public.user_roles, public.cabin_owners,
  public.news, public.news_reads, public.alerts, public.alert_acks,
  public.threads, public.messages, public.thread_reads,
  public.posts, public.post_likes, public.post_comments,
  public.events, public.event_attendees, public.shared_documents,
  public.cabin_documents, public.cabin_albums, public.cabin_photos, public.cabin_ledger,
  public.notification_prefs, public.push_subscriptions
to authenticated;

-- Profiler: navn er synlig for beboere. E-post og telefon er bare
-- synlig gjennom funksjonen my_profile() og (senere) administrasjonen.
grant select (id, full_name, created_at, last_seen_at) on public.profiles to authenticated;
grant update (full_name, phone, last_seen_at)          on public.profiles to authenticated;

grant execute on function
  public.has_role(public.app_role), public.is_staff(), public.owns_cabin(uuid), public.is_resident(),
  public.can_send_as(public.sender), public.handles_recipient(public.recipient),
  public.in_audience(public.audience), public.audience_size(public.audience),
  public.can_see_thread(uuid)
to authenticated;

-- Egen profil med e-post og telefon
create function public.my_profile()
returns table (id uuid, full_name text, email text, phone text)
language sql stable security definer set search_path = public as $$
  select id, full_name, email, phone from public.profiles where id = auth.uid();
$$;
revoke all on function public.my_profile() from anon, public;
grant execute on function public.my_profile() to authenticated;

-- =====================================================================
-- Lagring (Storage)
--   hytte       <cabin_id>/…   private filer i Min hytte, bare eiere
--   praten      <user_id>/…    bilder i Hyttepraten, alle beboere ser
--   meldinger   <thread_id>/…  bildevedlegg, bare de i samtalen
--   dokumenter  …              felles dokumenter, alle beboere ser
-- =====================================================================
insert into storage.buckets (id, name, public) values
  ('hytte', 'hytte', false),
  ('praten', 'praten', false),
  ('meldinger', 'meldinger', false),
  ('dokumenter', 'dokumenter', false)
on conflict (id) do nothing;

create function public.try_uuid(t text)
returns uuid language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end;
$$;
grant execute on function public.try_uuid(text) to authenticated;

create policy "hytte: eiere" on storage.objects for all to authenticated
  using      (bucket_id = 'hytte' and public.owns_cabin(public.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id = 'hytte' and public.owns_cabin(public.try_uuid((storage.foldername(name))[1])));

create policy "praten: se"     on storage.objects for select to authenticated
  using (bucket_id = 'praten' and public.is_resident());
create policy "praten: laste opp" on storage.objects for insert to authenticated
  with check (bucket_id = 'praten' and public.is_resident() and (storage.foldername(name))[1] = auth.uid()::text);
create policy "praten: slette egne" on storage.objects for delete to authenticated
  using (bucket_id = 'praten' and ((storage.foldername(name))[1] = auth.uid()::text or public.has_role('admin')));

create policy "meldinger: i samtalen" on storage.objects for select to authenticated
  using (bucket_id = 'meldinger' and public.can_see_thread(public.try_uuid((storage.foldername(name))[1])));
create policy "meldinger: laste opp" on storage.objects for insert to authenticated
  with check (bucket_id = 'meldinger' and public.can_see_thread(public.try_uuid((storage.foldername(name))[1])));

create policy "dokumenter: se" on storage.objects for select to authenticated
  using (bucket_id = 'dokumenter' and public.is_resident());
create policy "dokumenter: legge ut" on storage.objects for insert to authenticated
  with check (bucket_id = 'dokumenter' and (public.is_staff() or public.has_role('styre_vel') or public.has_role('styre_vei')));
create policy "dokumenter: slette" on storage.objects for delete to authenticated
  using (bucket_id = 'dokumenter' and (public.is_staff() or public.has_role('styre_vel') or public.has_role('styre_vei')));
