-- Tester tilgangsreglene. Hver sjekk skriver OK eller FEIL.
\set ON_ERROR_STOP on
\o /dev/null
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as
  $$ begin raise notice '% %', case when ok then 'OK  ' else 'FEIL' end, label; end $$;
create or replace function pg_temp.denied(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FEIL %', label;
exception when insufficient_privilege then raise notice 'OK   %', label; end $$;

-- ---------------------------------------------------------------------
-- Brukere (som superbruker). Roger opprettes først og blir admin + grunneier.
-- ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'roger@example.no', '{"full_name":"Roger Mørk"}'),
  ('00000000-0000-0000-0000-000000000047', 'kari@example.no',  '{"full_name":"Kari Nilsen"}'),
  ('00000000-0000-0000-0000-000000000006', 'per@example.no',   '{"full_name":"Per Strand"}'),
  ('00000000-0000-0000-0000-000000000012', 'trond@example.no', '{"full_name":"Trond Aas"}'),
  ('00000000-0000-0000-0000-000000000088', 'hilde@example.no', '{"full_name":"Hilde Berg"}'),
  ('00000000-0000-0000-0000-000000000999', 'ukjent@example.no','{}');

insert into public.cabins (id, area, number, label, vel_member, vei_member, access) values
  ('10000000-0000-0000-0000-000000000047', 'morvika', 47, 'Hytte 47', true,  true, 'full'),
  ('10000000-0000-0000-0000-000000000012', 'morvika', 12, 'Hytte 12', true,  true, 'full'),
  ('10000000-0000-0000-0000-000000000088', 'morvika', 88, 'Hytte 88', true,  true, 'full'),
  ('10000000-0000-0000-0000-000000000006', 'torpum',   6, 'Torpum 6', false, true, 'veilag');
insert into public.cabin_owners values
  ('10000000-0000-0000-0000-000000000047', '00000000-0000-0000-0000-000000000047'),
  ('10000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000012'),
  ('10000000-0000-0000-0000-000000000088', '00000000-0000-0000-0000-000000000088'),
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000006');
insert into public.user_roles values
  ('00000000-0000-0000-0000-000000000012', 'styre_vel'),
  ('00000000-0000-0000-0000-000000000088', 'styre_vei');

select pg_temp.check('første bruker ble admin og grunneier',
  (select count(*) from public.user_roles where user_id = '00000000-0000-0000-0000-000000000001') = 2);
select pg_temp.check('andre brukere fikk ingen roller automatisk',
  (select count(*) from public.user_roles where user_id = '00000000-0000-0000-0000-000000000047') = 0);

set role authenticated;

-- ---------------------------------------------------------------------
-- Roger (grunneier) publiserer
-- ---------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into public.news (sender, audience, title) values ('grunneier', 'torpum', 'Grunneier til Torpum');
insert into public.news (sender, audience, title) values ('grunneier', 'alle',   'Vannet stenges');
insert into public.alerts (level, sender, audience, title) values ('akutt', 'grunneier', 'alle', 'Vannlekkasje');
insert into public.shared_documents (title, owner, storage_path) values ('Kart', 'grunneier', 'grunneier/kart.pdf');
insert into storage.objects (bucket_id, name) values ('dokumenter', 'grunneier/kart.pdf');
select pg_temp.check('grunneier får størrelse på mottakergruppe (bare hytter med full tilgang)', public.audience_size('alle') = 3);
select pg_temp.check('Veilagets gruppe teller også Torpum', public.audience_size('vei') = 4);

-- ---------------------------------------------------------------------
-- Hilde (styret i Mørvikveien Veilag) publiserer
-- ---------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000088';
insert into public.news (sender, audience, title) values ('vei', 'vei',  'Veiavgift 2027');
insert into public.news (sender, audience, title) values ('vei', 'alle', 'Brøyting starter');
insert into public.alerts (level, sender, audience, title) values ('viktig', 'vei', 'vei', 'Veien stengt fredag');
insert into public.events (title, starts_at, organizer, audience) values ('Årsmøte i Veilaget', now() + interval '10 days', 'vei', 'vei');
insert into public.shared_documents (title, owner, storage_path) values ('Brøyteplan', 'vei', 'vei/broyteplan.pdf');
insert into storage.objects (bucket_id, name) values ('dokumenter', 'vei/broyteplan.pdf');

-- ---------------------------------------------------------------------
-- Kari (hytteeier i Mørvika, full tilgang)
-- ---------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000047';
select pg_temp.check('Kari ser nyheter for sine grupper, ikke Torpum', (select count(*) from public.news) = 3);
select pg_temp.check('Kari får ikke størrelse på mottakergruppe', public.audience_size('alle') is null);
select pg_temp.denied('Kari kan ikke publisere som grunneier',
  $$insert into public.news (sender, audience, title) values ('grunneier', 'alle', 'Falsk')$$);
insert into public.news_reads (news_id) select id from public.news;
insert into public.alert_acks (alert_id) select id from public.alerts;
select pg_temp.check('Kari ser og bekrefter begge varslene', (select count(*) from public.alert_acks) = 2);
insert into public.cabin_ledger (cabin_id, description, amount) values ('10000000-0000-0000-0000-000000000047', 'Festeavgift', 8400);
insert into public.cabin_documents (cabin_id, name, storage_path) values ('10000000-0000-0000-0000-000000000047', 'Festekontrakt.pdf', '10000000-0000-0000-0000-000000000047/festekontrakt.pdf');
insert into storage.objects (bucket_id, name) values ('hytte', '10000000-0000-0000-0000-000000000047/festekontrakt.pdf');
select pg_temp.denied('Kari kan ikke skrive i en annen hyttes regnskap',
  $$insert into public.cabin_ledger (cabin_id, description, amount) values ('10000000-0000-0000-0000-000000000012', 'Snikk', 1)$$);
select pg_temp.denied('Kari kan ikke laste opp i en annen hyttes mappe',
  $$insert into storage.objects (bucket_id, name) values ('hytte', '10000000-0000-0000-0000-000000000012/snikk.pdf')$$);
insert into public.threads (id, recipient, subject) values ('20000000-0000-0000-0000-000000000001', 'grunneier', 'Felling av furuer');
insert into public.messages (thread_id, body) values ('20000000-0000-0000-0000-000000000001', 'Kan jeg felle to furuer?');
insert into storage.objects (bucket_id, name) values ('meldinger', '20000000-0000-0000-0000-000000000001/furu.jpg');
insert into public.posts (body) values ('Nydelig morgen');
select pg_temp.check('Kari ser navnene til alle', (select count(*) from public.profiles) = 6);
select pg_temp.denied('e-postkolonnen er skjult for andre', $$select email from public.profiles$$);
select pg_temp.check('Kari ser sin egen e-post via my_profile', (select email from public.my_profile()) = 'kari@example.no');
select pg_temp.check('Kari ser begge felles dokumenter', (select count(*) from public.shared_documents) = 2);

-- ---------------------------------------------------------------------
-- Per (Torpum, bare Veilaget)
-- ---------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select pg_temp.check('Per ser bare nyhetene fra Veilaget', (select count(*) from public.news) = 2
  and not exists (select 1 from public.news where sender <> 'vei'));
select pg_temp.check('Per ser ikke grunneiers nyhet selv om den er til Torpum',
  not exists (select 1 from public.news where title = 'Grunneier til Torpum'));
select pg_temp.check('Per ser bare varselet fra Veilaget', (select count(*) from public.alerts) = 1);
insert into public.alert_acks (alert_id) select id from public.alerts;
select pg_temp.check('Per ser arrangementet fra Veilaget', (select count(*) from public.events) = 1);
insert into public.event_attendees (event_id) select id from public.events;
select pg_temp.check('Per ser bare Veilagets dokument', (select count(*) from public.shared_documents) = 1
  and (select owner from public.shared_documents) = 'vei');
select pg_temp.check('Per ser bare Veilagets fil', (select count(*) from storage.objects where bucket_id = 'dokumenter') = 1);
select pg_temp.check('Per ser ikke Hyttepraten', (select count(*) from public.posts) = 0);
select pg_temp.denied('Per kan ikke skrive i Hyttepraten', $$insert into public.posts (body) values ('Hei')$$);
select pg_temp.check('Per ser bare sin egen hytte', (select count(*) from public.cabins) = 1);
select pg_temp.check('Per ser bare sitt eget eierskap', (select count(*) from public.cabin_owners) = 1);
select pg_temp.check('Per ser bare seg selv og Veilagets styre', (select count(*) from public.profiles) = 2);
select pg_temp.denied('Per kan ikke skrive til grunneier',
  $$insert into public.threads (recipient, subject) values ('grunneier', 'Hei')$$);
insert into public.threads (id, recipient, subject) values ('20000000-0000-0000-0000-000000000006', 'vei', 'Hull i veien');
insert into public.messages (thread_id, body) values ('20000000-0000-0000-0000-000000000006', 'Stort hull ved bekken');
insert into storage.objects (bucket_id, name) values ('meldinger', '20000000-0000-0000-0000-000000000006/hull.jpg');
select pg_temp.check('Per ser sin egen samtale med Veilaget', (select count(*) from public.threads) = 1);
select pg_temp.denied('Per har ikke Min hytte',
  $$insert into public.cabin_ledger (cabin_id, description, amount) values ('10000000-0000-0000-0000-000000000006', 'Test', 1)$$);
select pg_temp.check('Per ser ikke Karis regnskap', (select count(*) from public.cabin_ledger) = 0);
select pg_temp.check('Per ser ikke Karis filer', (select count(*) from storage.objects where bucket_id = 'hytte') = 0);
select pg_temp.check('Per ser ikke hvem som har lest nyhetene', (select count(*) from public.news_reads) = 0);

-- ---------------------------------------------------------------------
-- Hilde (styret i Veilaget) ser Pers samtale og bekreftelse
-- ---------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000088';
select pg_temp.check('Veilagets styre ser samtalen fra Torpum', (select count(*) from public.threads where recipient = 'vei') = 1);
select pg_temp.check('Veilagets styre ser bildet i samtalen', (select count(*) from storage.objects where bucket_id = 'meldinger') = 1);
select pg_temp.check('Veilagets styre ser ikke samtaler til grunneier', (select count(*) from public.threads where recipient = 'grunneier') = 0);
select pg_temp.check('Veilagets styre ser at Per har bekreftet varselet', (select count(*) from public.alert_acks) = 2);
select pg_temp.check('Veilagets styre ser påmeldingen', (select count(*) from public.event_attendees) = 1);

-- ---------------------------------------------------------------------
-- Roger igjen: grunneier ser samtalen til grunneier, men ikke Min hytte
-- ---------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select pg_temp.check('grunneier ser samtalen sendt til grunneier', (select count(*) from public.messages m join public.threads t on t.id = m.thread_id where t.recipient = 'grunneier') = 1);
select pg_temp.check('grunneier ser også samtalen til Veilaget', (select count(*) from public.threads where recipient = 'vei') = 1);
select pg_temp.check('grunneier ser bildet i samtalen til Veilaget', (select count(*) from storage.objects where bucket_id = 'meldinger') = 2);
insert into public.messages (thread_id, body) values ('20000000-0000-0000-0000-000000000006', 'Takk, vi ser på det.');
insert into public.news (sender, audience, title) values ('vel', 'vel', 'Grunneier som Vel');
insert into public.news (sender, audience, title) values ('vei', 'torpum', 'Grunneier som Veilag til Torpum');
insert into public.alerts (level, sender, audience, title) values ('akutt', 'vei', 'vei', 'Veien er stengt');
insert into public.events (title, starts_at, organizer, audience) values ('Dugnad på badeplassen', now() + interval '5 days', 'vel', 'morvika');
select pg_temp.check('grunneier kan publisere som Vel og Veilag', (select count(*) from public.news where created_by = auth.uid() and sender in ('vel','vei')) = 2);
select pg_temp.check('grunneier ser fortsatt ikke Min hytte', (select count(*) from public.cabin_ledger) = 0 and (select count(*) from public.cabin_documents) = 0);
select pg_temp.denied('grunneier kan ikke skrive i en hyttes regnskap',
  $$insert into public.cabin_ledger (cabin_id, description, amount) values ('10000000-0000-0000-0000-000000000047', 'Snikk', 1)$$);
insert into public.messages (thread_id, body) values ('20000000-0000-0000-0000-000000000001', 'Det er greit.');
select pg_temp.check('grunneier ser IKKE Min hytte-regnskap', (select count(*) from public.cabin_ledger) = 0);
select pg_temp.check('grunneier ser IKKE Min hytte-dokumenter', (select count(*) from public.cabin_documents) = 0);
select pg_temp.check('grunneier ser IKKE Min hytte-filer', (select count(*) from storage.objects where bucket_id = 'hytte') = 0);
select pg_temp.check('grunneier ser hvem som har lest', (select count(*) from public.news_reads) >= 1);

-- ---------------------------------------------------------------------
-- Trond (styret i Vel)
-- ---------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000012';
select pg_temp.check('styret i Vel ser ikke samtaler til grunneier', (select count(*) from public.threads) = 0);
insert into public.news (sender, audience, title) values ('vel', 'vel', 'Dugnad 10. oktober');
select pg_temp.denied('Trond kan ikke publisere som Veilaget',
  $$insert into public.news (sender, audience, title) values ('vei', 'vei', 'Falsk')$$);

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select pg_temp.check('Per ser ikke Velets nyheter', (select count(*) from public.news where sender = 'vel') = 0);
select pg_temp.check('Per ser Veilagets nyhet fra grunneier til Torpum', exists (select 1 from public.news where title = 'Grunneier som Veilag til Torpum'));
select pg_temp.check('Per ser Veilagets varsel fra grunneier', exists (select 1 from public.alerts where title = 'Veien er stengt'));
select pg_temp.check('Per ser svaret fra grunneier i samtalen med Veilaget', (select count(*) from public.messages) = 2);

-- ---------------------------------------------------------------------
-- Uinvitert og anonym
-- ---------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000999';
select pg_temp.check('uinvitert ser ingen nyheter', (select count(*) from public.news) = 0);
select pg_temp.check('uinvitert ser ingen innlegg', (select count(*) from public.posts) = 0);
select pg_temp.check('uinvitert ser ingen hytter', (select count(*) from public.cabins) = 0);
select pg_temp.check('uinvitert ser bare sin egen profil', (select count(*) from public.profiles) = 1);

reset request.jwt.claim.sub;
set role anon;
select pg_temp.denied('anonym har ingen tilgang', $$select 1 from public.news$$);
reset role;
