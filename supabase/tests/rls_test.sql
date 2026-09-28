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
create or replace function pg_temp.fails(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FEIL %', label;
exception when others then raise notice 'OK   %', label; end $$;

-- ---------------------------------------------------------------------
-- Brukere (som superbruker). Roger opprettes først og blir admin + grunneier.
-- ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'roger@example.no', '{"full_name":"Roger Mørk"}'),
  ('00000000-0000-0000-0000-000000000047', 'kari@example.no',  '{"full_name":"Kari Nilsen"}'),
  ('00000000-0000-0000-0000-000000000006', 'per@example.no',   '{"full_name":"Per Strand"}'),
  ('00000000-0000-0000-0000-000000000012', 'trond@example.no', '{"full_name":"Trond Aas"}'),
  ('00000000-0000-0000-0000-000000000088', 'hilde@example.no', '{"full_name":"Hilde Berg"}'),
  ('00000000-0000-0000-0000-000000000101', 'ola@example.no',   '{"full_name":"Ola Kjøper"}'),
  ('00000000-0000-0000-0000-000000000102', 'siri@example.no',  '{"full_name":"Siri Nilsen"}'),
  ('00000000-0000-0000-0000-000000000103', 'jonas@example.no', '{"full_name":"Jonas Aas"}'),
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
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000006'),
  ('10000000-0000-0000-0000-000000000047', '00000000-0000-0000-0000-000000000102');
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
select pg_temp.check('grunneier får størrelse på mottakergruppe (bare hytter med full tilgang)', public.audience_size('alle') = 4);
select pg_temp.check('Veilagets gruppe teller også Torpum', public.audience_size('vei') = 5);

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
select pg_temp.denied('Kari ser ikke mottakerlisten for et varsel',
  $$select * from public.alert_recipients((select id from public.alerts where title = 'Vannlekkasje'))$$);
insert into public.cabin_ledger (cabin_id, description, amount) values ('10000000-0000-0000-0000-000000000047', 'Festeavgift', 8400);
insert into public.cabin_documents (cabin_id, name, folder, storage_path)
  values ('10000000-0000-0000-0000-000000000047', 'Forsikring.pdf', 'Forsikring', public.my_ownership('10000000-0000-0000-0000-000000000047') || '/forsikring.pdf'),
         ('10000000-0000-0000-0000-000000000047', 'Byggetegninger.pdf', 'Tegninger', public.my_ownership('10000000-0000-0000-0000-000000000047') || '/tegninger.pdf');
insert into storage.objects (bucket_id, name) values
  ('hytte', public.my_ownership('10000000-0000-0000-0000-000000000047') || '/forsikring.pdf'),
  ('hytte', public.my_ownership('10000000-0000-0000-0000-000000000047') || '/tegninger.pdf');
select pg_temp.check('Kari ser sine egne filer', (select count(*) from storage.objects where bucket_id = 'hytte') = 2);
select pg_temp.denied('Kari kan ikke skrive i en annen hyttes regnskap',
  $$insert into public.cabin_ledger (cabin_id, description, amount) values ('10000000-0000-0000-0000-000000000012', 'Snikk', 1)$$);
select pg_temp.denied('Kari kan ikke laste opp i en annen hyttes mappe',
  $$insert into storage.objects (bucket_id, name) values ('hytte', '10000000-0000-0000-0000-000000000012/snikk.pdf')$$);
insert into public.threads (id, recipient, subject) values ('20000000-0000-0000-0000-000000000001', 'grunneier', 'Felling av furuer');
insert into public.messages (thread_id, body) values ('20000000-0000-0000-0000-000000000001', 'Kan jeg felle to furuer?');
insert into storage.objects (bucket_id, name) values ('meldinger', '20000000-0000-0000-0000-000000000001/furu.jpg');
insert into public.posts (body) values ('Nydelig morgen');
select pg_temp.check('Kari ser navnene til alle', (select count(*) from public.profiles) = 9);
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
select pg_temp.check('Veilagets styre ser hvem som har bekreftet varselet (Torpum med, avsender ikke)',
  (select string_agg(full_name || ':' || status, ',' order by full_name) from public.alert_recipients((select id from public.alerts where title = 'Veien stengt fredag')))
  = 'Kari Nilsen:bekreftet,Per Strand:bekreftet,Siri Nilsen:venter,Trond Aas:venter');
select pg_temp.denied('Veilagets styre ser ikke mottakerlisten for grunneiers varsel',
  $$select * from public.alert_recipients((select id from public.alerts where title = 'Vannlekkasje'))$$);

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
-- Eierskifte: Kari og Siri selger hytte 47 til Ola
-- ---------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000102';
select pg_temp.check('medeier Siri deler Min hytte med Kari', (select count(*) from public.cabin_ledger) = 1 and (select count(*) from public.cabin_documents) = 2);

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000047';
select pg_temp.denied('Kari kan ikke registrere eierskifte',
  $$select public.register_transfer('10000000-0000-0000-0000-000000000047', current_date, 'salg', array['00000000-0000-0000-0000-000000000101']::uuid[])$$);

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.register_transfer('10000000-0000-0000-0000-000000000047', current_date, 'salg',
  array['00000000-0000-0000-0000-000000000101']::uuid[], 'Solgt via megler') as t \gset
insert into public.cabin_archive (cabin_id, title, storage_path) values ('10000000-0000-0000-0000-000000000047', 'Festekontrakt hytte 47', '10000000-0000-0000-0000-000000000047/festekontrakt.pdf');
insert into storage.objects (bucket_id, name) values ('arkiv', '10000000-0000-0000-0000-000000000047/festekontrakt.pdf');
select pg_temp.check('grunneier ser eierhistorikken', (select count(*) from public.ownerships where cabin_id = '10000000-0000-0000-0000-000000000047') = 2);

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select pg_temp.check('Ola er nå eier og beboer', public.is_resident());
select pg_temp.check('Ola starter med tomt regnskap', (select count(*) from public.cabin_ledger) = 0);
select pg_temp.check('Ola ser ikke Karis dokumenter', (select count(*) from public.cabin_documents) = 0);
select pg_temp.check('Ola ser ikke Karis filer', (select count(*) from storage.objects where bucket_id = 'hytte') = 0);
select pg_temp.check('Ola ser festekontrakten i hyttearkivet', (select count(*) from public.cabin_archive) = 1);
select pg_temp.check('Ola ser arkivfilen', (select count(*) from storage.objects where bucket_id = 'arkiv') = 1);
insert into public.cabin_ledger (cabin_id, description, amount) values ('10000000-0000-0000-0000-000000000047', 'Festeavgift 2027', 8600);
insert into storage.objects (bucket_id, name) values ('hytte', public.my_ownership('10000000-0000-0000-0000-000000000047') || '/ola.jpg');
select pg_temp.check('Ola kan føre i sitt eget regnskap', (select count(*) from public.cabin_ledger) = 1);

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000047';
select pg_temp.check('Kari er ikke lenger beboer', not public.is_resident());
select pg_temp.check('Kari kan fortsatt lese sine dokumenter i 90 dager', (select count(*) from public.cabin_documents) = 2);
select pg_temp.check('Kari kan fortsatt lese sitt regnskap', (select count(*) from public.cabin_ledger) = 1);
select pg_temp.check('Kari kan fortsatt hente sine filer', (select count(*) from storage.objects where bucket_id = 'hytte') = 2);
select pg_temp.check('Kari ser ikke Olas regnskap', not exists (select 1 from public.cabin_ledger where description = 'Festeavgift 2027'));
select pg_temp.check('Kari ser ikke hyttearkivet lenger', (select count(*) from public.cabin_archive) = 0);
select pg_temp.denied('Kari kan ikke føre i regnskapet etter salget',
  $$insert into public.cabin_ledger (cabin_id, description, amount) values ('10000000-0000-0000-0000-000000000047', 'Etter salg', 1)$$);
select pg_temp.denied('Kari kan ikke godkjenne «Overfør alt» ved salg', format($$select public.approve_full_transfer(%L)$$, :'t'));
select public.hand_over(:'t', array(select id from public.cabin_documents where name = 'Byggetegninger.pdf'), '{}') as overlevert \gset
select pg_temp.check('Kari overleverte byggetegningene', :overlevert = 1);
select pg_temp.check('Kari har ikke lenger byggetegningene', (select count(*) from public.cabin_documents) = 1);

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select pg_temp.check('Ola ser de overleverte byggetegningene', (select name from public.cabin_documents) = 'Byggetegninger.pdf');
select pg_temp.check('Ola kan hente filen til byggetegningene', (select count(*) from storage.objects where bucket_id = 'hytte' and name like '%/tegninger.pdf') = 1);
select pg_temp.check('Ola ser eierskiftet', (select count(*) from public.ownership_transfers) = 1);

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select pg_temp.check('Per ser ikke hyttearkivet for hytte 47', (select count(*) from public.cabin_archive) = 0);

-- Fristen går ut
reset role;
update public.ownerships set access_until = current_date - 1 where id = (select from_ownership from public.ownership_transfers where id = :'t');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000047';
select pg_temp.check('etter fristen ser Kari ingen av sine data', (select count(*) from public.cabin_documents) = 0 and (select count(*) from public.cabin_ledger) = 0);

-- ---------------------------------------------------------------------
-- Overdragelse i familien: Trond gir hytte 12 til sønnen Jonas
-- ---------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000012';
insert into public.cabin_ledger (cabin_id, description, amount) values ('10000000-0000-0000-0000-000000000012', 'Maling', 3200);
insert into public.cabin_albums (cabin_id, name) values ('10000000-0000-0000-0000-000000000012', 'Sommer');

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.register_transfer('10000000-0000-0000-0000-000000000012', current_date, 'familie',
  array['00000000-0000-0000-0000-000000000103']::uuid[]) as f \gset

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select pg_temp.check('Jonas starter tomt før godkjenning', (select count(*) from public.cabin_ledger) = 0);

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000012';
select public.approve_full_transfer(:'f');
select pg_temp.check('Trond har ikke lenger Min hytte etter «Overfør alt»', (select count(*) from public.cabin_ledger) = 0);
select pg_temp.check('Trond beholder rollen i Velet', public.is_resident());

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select pg_temp.check('Jonas har fått hele Min hytte', (select count(*) from public.cabin_ledger) = 1 and (select count(*) from public.cabin_albums) = 1);

-- ---------------------------------------------------------------------
-- Hurtigregistrering og aktivering ved første innlogging
-- ---------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into public.cabins (id, area, number, label, address, gnr, bnr, fnr, vel_member, vei_member)
  values ('10000000-0000-0000-0000-000000000101', 'morvika', 101, 'Hytte 101', 'Mørvikveien 301', 12, 4, 101, true, true);
insert into public.cabin_notes (cabin_id, note) values ('10000000-0000-0000-0000-000000000101', 'Faktura går til Oslo-adresse');
select pg_temp.check('ny eier uten konto blir ventende',
  public.admin_add_owner('10000000-0000-0000-0000-000000000101', 'Anne Hansen', ' Anne@Example.no ', '900 11 222') = 'venter');
select pg_temp.check('eier med konto kobles direkte',
  public.admin_add_owner('10000000-0000-0000-0000-000000000101', 'Ola Kjøper', 'ola@example.no') = 'koblet');
select pg_temp.check('eier uten e-post registreres, men venter',
  public.admin_add_owner('10000000-0000-0000-0000-000000000101', 'Uten Epost', '') = 'venter');
select pg_temp.check('personlisten viser aktive og ventende',
  (select count(*) from public.admin_people() where status = 'venter') = 1
  and (select count(*) from public.admin_people() where status = 'mangler_epost') = 1
  and (select count(*) from public.admin_people() where status = 'aktiv') >= 9);
select public.admin_set_roles((select id from public.pending_people where email = 'anne@example.no'), array['styre_vei']::public.app_role[]);
select pg_temp.fails('administrator kan ikke fjerne sin egen administratorrolle',
  $$select public.admin_set_roles('00000000-0000-0000-0000-000000000001', array['grunneier']::public.app_role[])$$);
select public.admin_add_person('Styre Medlem', 'styre@example.no', null, array['styre_vel']::public.app_role[]) as styre \gset

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000047';
select pg_temp.denied('vanlig bruker kan ikke registrere eiere',
  $$select public.admin_add_owner('10000000-0000-0000-0000-000000000101', 'X', 'x@example.no')$$);
select pg_temp.denied('vanlig bruker får ikke personlisten', $$select * from public.admin_people()$$);
select pg_temp.check('vanlig bruker ser ikke interne merknader', (select count(*) from public.cabin_notes) = 0);
select pg_temp.check('vanlig bruker ser ikke ventende personer', (select count(*) from public.pending_people) = 0);

reset role;
select pg_temp.check('registrert e-post slipper inn (uavhengig av store bokstaver)',
  public.hook_before_user_created('{"user":{"email":"ANNE@example.no"}}') = '{}'::jsonb);
select pg_temp.check('ukjent e-post stoppes',
  public.hook_before_user_created('{"user":{"email":"fremmed@example.no"}}') ? 'error');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000201', 'anne@example.no');
select pg_temp.check('Anne fikk navn og mobil fra registreringen',
  (select full_name || '|' || phone from public.profiles where id = '00000000-0000-0000-0000-000000000201') = 'Anne Hansen|900 11 222');
select pg_temp.check('Anne ble koblet til hytta og fikk rollen', exists (
  select 1 from public.cabin_owners where user_id = '00000000-0000-0000-0000-000000000201' and cabin_id = '10000000-0000-0000-0000-000000000101')
  and exists (select 1 from public.user_roles where user_id = '00000000-0000-0000-0000-000000000201' and role = 'styre_vei'));
select pg_temp.check('Anne er ikke lenger ventende', not exists (select 1 from public.pending_people where email = 'anne@example.no'));
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000202', 'styre@example.no');
select pg_temp.check('styremedlem uten hytte fikk rollen ved innlogging',
  exists (select 1 from public.user_roles where user_id = '00000000-0000-0000-0000-000000000202' and role = 'styre_vel'));
set role authenticated;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000201';
select pg_temp.check('Anne er beboer og ser hytta si', public.is_resident()
  and exists (select 1 from public.cabins where id = '10000000-0000-0000-0000-000000000101'));

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.admin_remove_owner('10000000-0000-0000-0000-000000000101', (select id from public.pending_people where full_name = 'Uten Epost'));
select pg_temp.check('ventende uten hytte og rolle fjernes helt', not exists (select 1 from public.pending_people where full_name = 'Uten Epost'));
select public.admin_update_person('00000000-0000-0000-0000-000000000201', 'Anne M. Hansen', 'ignoreres@example.no', '900 11 333');
select pg_temp.check('administrator kan endre navn og mobil',
  (select full_name || '|' || phone from public.admin_people() where id = '00000000-0000-0000-0000-000000000201') = 'Anne M. Hansen|900 11 333');

-- ---------------------------------------------------------------------
-- Grunneier og styrene starter samtale med en hytteeier
-- ---------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into public.threads (id, owner_id, recipient, subject) values ('20000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000101', 'grunneier', 'Gjerde mot veien');
insert into public.messages (thread_id, body) values ('20000000-0000-0000-0000-000000000101', 'Kan dere flytte gjerdet 1 meter?');
select pg_temp.denied('grunneier kan ikke starte samtale fra Velet med Torpum-eier',
  $$insert into public.threads (owner_id, recipient, subject) values ('00000000-0000-0000-0000-000000000006', 'vel', 'Hei')$$);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000088';
insert into public.threads (owner_id, recipient, subject) values ('00000000-0000-0000-0000-000000000006', 'vei', 'Brøyting i Torpum');
select pg_temp.denied('Veilagets styre kan ikke starte samtale som grunneier',
  $$insert into public.threads (owner_id, recipient, subject) values ('00000000-0000-0000-0000-000000000101', 'grunneier', 'Falsk')$$);
select pg_temp.denied('styret kan ikke starte samtale med en som ikke eier hytte',
  $$insert into public.threads (owner_id, recipient, subject) values ('00000000-0000-0000-0000-000000000999', 'vei', 'Hei')$$);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select pg_temp.check('hytteeieren ser samtalen grunneier startet', exists (select 1 from public.threads where subject = 'Gjerde mot veien')
  and exists (select 1 from public.messages where body = 'Kan dere flytte gjerdet 1 meter?'));
insert into public.messages (thread_id, body) values ('20000000-0000-0000-0000-000000000101', 'Ja, det går fint.');
select pg_temp.denied('hytteeier kan ikke starte samtale på vegne av en annen',
  $$insert into public.threads (owner_id, recipient, subject) values ('00000000-0000-0000-0000-000000000047', 'grunneier', 'Falsk')$$);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select pg_temp.check('Torpum-eier ser meldingen fra Veilaget', exists (select 1 from public.threads where subject = 'Brøyting i Torpum'));

-- ---------------------------------------------------------------------
-- Bilder i nyheter
-- ---------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into storage.objects (bucket_id, name) values ('nyheter', 'grunneier/hyttetomt.jpg');
insert into public.news (sender, audience, title, images) values ('grunneier', 'morvika', 'Ny vei til tomtene', array['grunneier/hyttetomt.jpg']);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000088';
select pg_temp.denied('Veilagets styre kan ikke laste opp i grunneiers mappe',
  $$insert into storage.objects (bucket_id, name) values ('nyheter', 'grunneier/falsk.jpg')$$);
insert into storage.objects (bucket_id, name) values ('nyheter', 'vei/veien.jpg');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select pg_temp.check('hytteeier i Mørvika ser bildet i grunneiers nyhet',
  exists (select 1 from storage.objects where bucket_id = 'nyheter' and name = 'grunneier/hyttetomt.jpg'));
select pg_temp.check('hytteeier ser ikke bilder som ikke hører til en nyhet',
  not exists (select 1 from storage.objects where bucket_id = 'nyheter' and name = 'vei/veien.jpg'));
select pg_temp.denied('hytteeier kan ikke laste opp nyhetsbilder',
  $$insert into storage.objects (bucket_id, name) values ('nyheter', 'grunneier/snikk.jpg')$$);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select pg_temp.check('Torpum ser ikke bilder fra grunneiers nyhet',
  not exists (select 1 from storage.objects where bucket_id = 'nyheter'));

-- ---------------------------------------------------------------------
-- Arrangementer og Info
-- ---------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into public.events (id, title, starts_at, place, organizer, audience, notify)
  values ('30000000-0000-0000-0000-000000000001', 'Dugnad på badeplassen', now() + interval '1 day', 'Badeplassen', 'vel', 'alle', true);
insert into public.contacts (grp, title, name, phone) values ('grunneier', 'Grunneier', 'Roger Mørk', '900 00 000');
insert into storage.objects (bucket_id, name) values ('dokumenter', 'vel/vedtekter.pdf');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
insert into public.event_attendees (event_id, persons) values ('30000000-0000-0000-0000-000000000001', 3);
update public.event_attendees set persons = 4 where event_id = '30000000-0000-0000-0000-000000000001';
select pg_temp.check('hytteeier melder på og endrer antall', (select persons from public.event_attendees where event_id = '30000000-0000-0000-0000-000000000001') = 4);
select pg_temp.check('hytteeier ser kontakter', (select count(*) from public.contacts) = 5);
select pg_temp.denied('hytteeier kan ikke endre kontakter', $$insert into public.contacts (grp, name) values ('nyttig', 'Falsk')$$);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000012';
select pg_temp.denied('Vel-styret kan ikke legge filer i grunneiers mappe',
  $$insert into storage.objects (bucket_id, name) values ('dokumenter', 'grunneier/falsk.pdf')$$);
insert into storage.objects (bucket_id, name) values ('dokumenter', 'vel/referat.pdf');
insert into public.contacts (grp, title, name) values ('vel', 'Leder', 'Trond Aas');
select pg_temp.denied('Vel-styret kan ikke endre grunneiers kontakter', $$insert into public.contacts (grp, name) values ('grunneier', 'Falsk')$$);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select pg_temp.check('Torpum ser bare Veilagets og nyttige kontakter', (select count(*) from public.contacts) = 4
  and not exists (select 1 from public.contacts where grp in ('grunneier', 'vel')));
reset role;
set role service_role;
select pg_temp.check('nytt arrangement med varsel går til mottakerne',
  exists (select 1 from public.push_targets('events', '30000000-0000-0000-0000-000000000001') t where t.user_id = '00000000-0000-0000-0000-000000000101'));
select pg_temp.check('påminnelse går bare til de påmeldte',
  (select array_agg(t.user_id) from public.push_targets('event_reminder', '30000000-0000-0000-0000-000000000001') t)
  = array['00000000-0000-0000-0000-000000000101'::uuid]);
reset role;
select pg_temp.check('påminnelsesjobben sender signal for arrangement i morgen', public.send_event_reminders() = 1);
set role authenticated;

-- ---------------------------------------------------------------------
-- Min hytte: kvittering i regnskapet
-- ---------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
insert into storage.objects (bucket_id, name) values ('hytte', public.my_ownership('10000000-0000-0000-0000-000000000047') || '/kvittering.jpg');
insert into public.cabin_ledger (cabin_id, description, amount, receipt_path)
  values ('10000000-0000-0000-0000-000000000047', 'Maling', 1200, public.my_ownership('10000000-0000-0000-0000-000000000047') || '/kvittering.jpg');
select pg_temp.check('eieren ser kvitteringen sin', exists (select 1 from storage.objects where bucket_id = 'hytte' and name like '%/kvittering.jpg'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select pg_temp.check('eier av en annen hytte ser ikke kvitteringen', not exists (select 1 from storage.objects where bucket_id = 'hytte' and name like '%/kvittering.jpg'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select pg_temp.check('grunneier ser ikke kvitteringen', not exists (select 1 from storage.objects where bucket_id = 'hytte' and name like '%/kvittering.jpg'));

-- ---------------------------------------------------------------------
-- Eierskifte fra appen (admin_transfer), selgerens tilgang og sletting
-- ---------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
delete from storage.objects where bucket_id = 'hytte' and name like '%/tegninger.pdf';
reset role;
select pg_temp.check('ny eier kan slette fil som selgeren ga videre', not exists (select 1 from storage.objects where name like '%/tegninger.pdf'));
set role authenticated;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000047';
select pg_temp.denied('hytteeier kan ikke registrere eierskifte',
  $$select public.admin_transfer('10000000-0000-0000-0000-000000000088', current_date, 'salg', '[{"name":"X"}]')$$);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.admin_transfer('10000000-0000-0000-0000-000000000088', current_date, 'salg',
  '[{"name":"Nina Ny","email":"Nina@Example.no","phone":"900 00 001"}]', 'Solgt') as t2 \gset
select pg_temp.check('historikken viser selgeren', (select sellers from public.admin_transfers('10000000-0000-0000-0000-000000000088') limit 1) = 'Hilde Berg');
select pg_temp.check('ny eier uten konto ligger som ventende',
  exists (select 1 from public.admin_people() where full_name = 'Nina Ny' and status = 'venter' and '10000000-0000-0000-0000-000000000088' = any (cabin_ids)));

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000088';
select pg_temp.check('selgeren ser hytta som tidligere hytte i 90 dager',
  (select access_until from public.my_former_cabins() where cabin_id = '10000000-0000-0000-0000-000000000088') = current_date + 90);
select pg_temp.check('selgeren er ikke lenger eier', not exists (select 1 from public.cabin_owners where user_id = '00000000-0000-0000-0000-000000000088'));
select pg_temp.check('selgeren beholder styrerollen i Veilaget', public.is_resident());

reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000301', 'nina@example.no');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000301';
select pg_temp.check('ny eier kobles til hytta og den nye eierperioden ved første innlogging',
  public.my_ownership('10000000-0000-0000-0000-000000000088') = (select to_ownership from public.ownership_transfers where id = :'t2'));

reset role;
insert into public.cabin_documents (cabin_id, ownership_id, name, storage_path)
  select cabin_id, id, 'Gammel.pdf', id || '/gammel.pdf' from public.ownerships where id = (select from_ownership from public.ownership_transfers where id = :'t2');
update public.ownerships set access_until = current_date - 1 where id = (select from_ownership from public.ownership_transfers where id = :'t2');
select public.purge_expired_ownerships() as purged \gset
select pg_temp.check('sletting etter fristen fjerner selgerens data', :purged >= 1
  and not exists (select 1 from public.cabin_documents where name = 'Gammel.pdf'));
select pg_temp.check('filene legges i søppelkassen for sletting', exists (select 1 from public.storage_trash where path like '%/gammel.pdf'));
select pg_temp.check('sletting gir signal til funksjonen som sletter filene', exists (select 1 from net.calls where body->>'table' = 'storage_trash'));
select pg_temp.check('overleverte dokumenter slettes ikke', exists (select 1 from public.cabin_documents where name = 'Byggetegninger.pdf'));
set role authenticated;

-- ---------------------------------------------------------------------
-- Push-varsler
-- ---------------------------------------------------------------------
reset role;
grant usage on schema public to service_role;
grant select on all tables in schema public to service_role;   -- som i Supabase
select pg_temp.check('nye rader gir signal til push-funksjonen',
  (select count(*) from net.calls where body->>'table' in ('alerts','news','messages','post_comments')) >= 5);
set role service_role;
select pg_temp.check('akutt varsel fra Veilaget går til Veilagets medlemmer, ikke avsender',
  (select string_agg(p.full_name, ',' order by p.full_name) from public.push_targets('alerts', (select id from public.alerts where title = 'Veien stengt fredag')) t join public.profiles p on p.id = t.user_id)
  like '%Per Strand%' and not exists (select 1 from public.push_targets('alerts', gen_random_uuid())));
select pg_temp.check('samme varsel sendes bare én gang',
  not exists (select 1 from public.push_targets('alerts', (select id from public.alerts where title = 'Veien stengt fredag'))));
select pg_temp.check('melding fra grunneier i ny samtale går til hytteeieren',
  (select array_agg(t.user_id) from public.push_targets('messages', (select id from public.messages where body = 'Kan dere flytte gjerdet 1 meter?')) t)
  = array['00000000-0000-0000-0000-000000000101'::uuid]);
select pg_temp.check('melding fra hytteeier til grunneier går til grunneier',
  (select array_agg(t.user_id) from public.push_targets('messages', (select id from public.messages where body = 'Kan jeg felle to furuer?')) t)
  = array['00000000-0000-0000-0000-000000000001'::uuid]);
reset role;
insert into public.notification_prefs (user_id, news) values ('00000000-0000-0000-0000-000000000047', false);
set role service_role;
select pg_temp.check('nyhet går ikke til den som har slått av nyhetsvarsler',
  not exists (select 1 from public.push_targets('news', (select id from public.news where title = 'Vannet stenges')) where user_id = '00000000-0000-0000-0000-000000000047'));
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000047';
select pg_temp.denied('hytteeier kan ikke hente push-mottakere', $$select * from public.push_targets('alerts', gen_random_uuid())$$);
select public.save_push_subscription('https://push.example/abc', 'p', 'a', 'test');
select pg_temp.check('hytteeier kan lagre push-abonnement', (select count(*) from public.push_subscriptions) = 1);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000012';
select public.save_push_subscription('https://push.example/abc', 'p2', 'a2', 'test');
select pg_temp.check('samme telefon flyttes til ny bruker', (select count(*) from public.push_subscriptions) = 1);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000047';
select pg_temp.check('forrige bruker har ikke abonnementet lenger', (select count(*) from public.push_subscriptions) = 0);

-- ---------------------------------------------------------------------
-- Uinvitert og anonym
-- ---------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000999';
select pg_temp.check('uinvitert ser ingen nyheter', (select count(*) from public.news) = 0);
select pg_temp.check('uinvitert ser ingen innlegg', (select count(*) from public.posts) = 0);
select pg_temp.check('uinvitert ser ingen hytter', (select count(*) from public.cabins) = 0);
select pg_temp.check('uinvitert ser bare sin egen profil', (select count(*) from public.profiles) = 1);
select pg_temp.check('uinvitert ser ingen eierperioder', (select count(*) from public.ownerships) = 0);

reset request.jwt.claim.sub;
set role anon;
select pg_temp.denied('anonym har ingen tilgang', $$select 1 from public.news$$);
reset role;

-- ---------------------------------------------------------------------
-- Mørvika Vann og Avløp
-- ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000401', 'va@example.no', '{"full_name":"Vera Vann"}');
insert into public.user_roles values ('00000000-0000-0000-0000-000000000401', 'styre_va');
update public.cabins set va_member = (area = 'morvika' and number <> 88);
select count(distinct o.user_id) as va_n from public.cabin_owners o join public.cabins c on c.id = o.cabin_id where c.va_member \gset
select pg_temp.check('Torpum er ikke medlem i Vann og avløp', not (select va_member from public.cabins where area = 'torpum' limit 1));

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000401';
insert into public.news (sender, audience, title) values ('va', 'va', 'Vannet stenges tirsdag');
insert into public.alerts (level, sender, audience, title) values ('akutt', 'va', 'va', 'Vannlekkasje ved pumpehuset');
select pg_temp.denied('VA-styret kan ikke publisere som Velet', $$insert into public.news (sender, audience, title) values ('vel', 'vel', 'Feil')$$);
select pg_temp.check('VA-styret får størrelsen på gruppen sin', public.audience_size('va') = :va_n);
insert into public.contacts (grp, title, name) values ('va', 'Leder', 'Vera Vann');
select pg_temp.denied('VA-styret kan ikke endre Velets kontakter', $$insert into public.contacts (grp, name) values ('vel', 'Feil')$$);
insert into storage.objects (bucket_id, name) values ('dokumenter', 'va/vannanalyse.pdf');
insert into public.shared_documents (title, owner, storage_path) values ('Vannanalyse', 'va', 'va/vannanalyse.pdf');
select pg_temp.denied('VA-styret kan ikke legge filer i Velets mappe', $$insert into storage.objects (bucket_id, name) values ('dokumenter', 'vel/feil.pdf')$$);

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select pg_temp.check('medlem ser nyheten fra Vann og avløp', exists (select 1 from public.news where title = 'Vannet stenges tirsdag'));
insert into public.threads (owner_id, recipient, subject) values ('00000000-0000-0000-0000-000000000101', 'va', 'Lavt vanntrykk');
insert into public.messages (thread_id, author_id, body)
  select id, '00000000-0000-0000-0000-000000000101', 'Vanntrykket er lavt i dag' from public.threads where subject = 'Lavt vanntrykk';

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000088';
select pg_temp.check('ikke-medlem ser ikke nyheten fra Vann og avløp', not exists (select 1 from public.news where title = 'Vannet stenges tirsdag'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select pg_temp.check('Torpum ser ikke Vann og avløp', not exists (select 1 from public.news where sender = 'va')
  and not exists (select 1 from public.contacts where grp = 'va') and not exists (select 1 from public.shared_documents where owner = 'va'));
select pg_temp.denied('Torpum kan ikke skrive til VA-styret', $$insert into public.threads (owner_id, recipient, subject) values ('00000000-0000-0000-0000-000000000006', 'va', 'Hei')$$);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000012';
select pg_temp.check('Velets styre ser ikke meldinger til VA-styret', not exists (select 1 from public.threads where subject = 'Lavt vanntrykk'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000401';
select pg_temp.check('VA-styret ser meldingen og kan svare', exists (select 1 from public.threads where subject = 'Lavt vanntrykk'));
insert into public.messages (thread_id, author_id, body)
  select id, auth.uid(), 'Vi ser på det' from public.threads where subject = 'Lavt vanntrykk';
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select pg_temp.check('grunneier ser meldinger til VA-styret og kan publisere som VA',
  exists (select 1 from public.threads where subject = 'Lavt vanntrykk') and public.can_send_as('va'));

reset role;
select pg_temp.check('push for melding til VA går til VA-styret og grunneier, ikke Velet',
  (select array_agg(t.user_id order by t.user_id) from public.push_targets('messages', (select id from public.messages where body = 'Vanntrykket er lavt i dag')) t)
  = array['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000401']::uuid[]);
select pg_temp.check('akutt VA-varsel går bare til medlemmene',
  (select count(*) from public.push_targets('alerts', (select id from public.alerts where title = 'Vannlekkasje ved pumpehuset')) t) = :va_n);

-- ---------------------------------------------------------------------
-- SMS-kontakt, veinavn og SMS
-- ---------------------------------------------------------------------
reset role;
insert into public.cabins (id, area, number, label, address, vel_member, va_member, vei_member) values
  ('20000000-0000-0000-0000-000000000201', 'morvika', 201, 'SB-201 · Mørvikåsen',  'Mørvikåsen 5',   true, true, true),
  ('20000000-0000-0000-0000-000000000202', 'morvika', 202, 'SB-202 · Mørvikvarden', 'Mørvikvarden 3 B', true, true, true),
  ('20000000-0000-0000-0000-000000000203', 'morvika', 203, 'SB-203 · Mørvikvarden', null,             true, false, true);
select pg_temp.check('veinavn hentes fra adressen, ellers fra betegnelsen',
  public.street_of('Mørvikvarden 3 B', 'x') = 'Mørvikvarden' and public.street_of(null, 'SB-203 · Mørvikvarden') = 'Mørvikvarden'
  and public.street_of('Mørvikåsen', null) = 'Mørvikåsen' and public.street_of(null, 'SB-9') is null);
select pg_temp.check('mobilnummer gjøres om til +47',
  public.sms_phone('912 34 567') = '+4791234567' and public.sms_phone('0047 41234567') = '+4741234567'
  and public.sms_phone('+46 70 123 45 67') = '+46701234567' and public.sms_phone('123') is null and public.sms_phone(null) is null);

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.admin_add_owner('20000000-0000-0000-0000-000000000201', 'Første Eier', 'forste@example.no', '911 11 111');
select public.admin_add_owner('20000000-0000-0000-0000-000000000201', 'Kona Eier', 'kona@example.no', '922 22 222');
select public.admin_add_owner('20000000-0000-0000-0000-000000000201', 'Barnet Eier', 'barn@example.no', '933 33 333');
select public.admin_add_owner('20000000-0000-0000-0000-000000000202', 'Uten Mobil', 'utenmobil@example.no', null);
select public.admin_add_owner('20000000-0000-0000-0000-000000000202', 'Med Mobil', 'medmobil@example.no', '944 44 444');
select public.admin_add_owner('20000000-0000-0000-0000-000000000203', 'Varden Tre', 'tre@example.no', '911 11 111');
select pg_temp.check('den første som registreres på hytta blir SMS-kontakt',
  (select array_agg(full_name) from public.admin_people() where '20000000-0000-0000-0000-000000000201' = any (sms_cabin_ids)) = array['Første Eier']);
select pg_temp.check('hver hytte har én SMS-kontakt',
  (select count(*) from public.admin_people() where '20000000-0000-0000-0000-000000000202' = any (sms_cabin_ids)) = 1);

select id as kona from public.pending_people where email = 'kona@example.no' \gset
select public.admin_set_sms_contact('20000000-0000-0000-0000-000000000201', :'kona');
select pg_temp.check('administrator kan bytte SMS-kontakt',
  (select array_agg(full_name) from public.admin_people() where '20000000-0000-0000-0000-000000000201' = any (sms_cabin_ids)) = array['Kona Eier']);

-- Kona logger inn: hun er fortsatt SMS-kontakt, og står fortsatt som nr. 2 i rekkefølgen
reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-000000000501', 'kona@example.no', '{}');
select pg_temp.check('SMS-kontakten følger med ved første innlogging',
  (select sms_contact from public.cabin_owners where user_id = '00000000-0000-0000-0000-000000000501') = true
  and not exists (select 1 from public.pending_cabin_owners where cabin_id = '20000000-0000-0000-0000-000000000201' and sms_contact));
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.admin_remove_owner('20000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000501');
select pg_temp.check('fjernes SMS-kontakten, tar den første av de andre over',
  (select array_agg(full_name) from public.admin_people() where '20000000-0000-0000-0000-000000000201' = any (sms_cabin_ids)) = array['Første Eier']);
select pg_temp.denied('vanlig bruker kan ikke bytte SMS-kontakt', $$set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101'; select public.admin_set_sms_contact('20000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000501')$$);

-- Veinavn og forhåndsvisning (grunneier)
select pg_temp.check('veilisten viser veiene i gruppen med antall hytter',
  (select cabins from public.street_list('va', 'va') where street = 'Mørvikvarden') = 1
  and (select cabins from public.street_list('grunneier', 'morvika') where street = 'Mørvikvarden') = 2);
select pg_temp.check('forhåndsvisning: én SMS per hytte, til SMS-kontakten',
  (select recipients from public.sms_preview('grunneier', 'morvika', array['Mørvikåsen'])) = 1);
select pg_temp.check('samme mobilnummer får bare én SMS, og hytter uten mobil telles',
  (select row(recipients, cabins, without_phone)::text from public.sms_preview('grunneier', 'morvika', array['Mørvikåsen', 'Mørvikvarden'])) = '(2,3,0)');
select pg_temp.fails('SMS kan ikke sendes for varsler til orientering',
  $$insert into public.alerts (level, sender, audience, title, sms) values ('info', 'grunneier', 'alle', 'x', true)$$);

insert into public.alerts (level, sender, audience, title, body, streets, sms)
  values ('akutt', 'grunneier', 'morvika', 'Vannet stengt', 'Rørbrudd ved pumpehuset.', array['Mørvikåsen', 'Mørvikvarden'], true);
insert into public.alerts (level, sender, audience, title, streets, sms)
  values ('viktig', 'va', 'va', 'Vannprøve', array['Mørvikvarden'], true);

-- Varsel med veinavn ses bare av hytteeiere i de veiene
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select pg_temp.check('hytteeier i en annen vei ser ikke varselet', not exists (select 1 from public.alerts where title = 'Vannet stengt'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000401';
select pg_temp.check('VA-styret ser sitt eget varsel selv uten hytte i veien', exists (select 1 from public.alerts where title = 'Vannprøve'));
select pg_temp.check('styret ser ikke SMS-loggen med mobilnumre', (select count(*) from public.sms_log) = 0);

reset role;
select pg_temp.check('push for varsel med veinavn går bare til eiere i veiene',
  not exists (select 1 from public.push_targets('alerts', (select id from public.alerts where title = 'Vannet stengt')) t
               where t.user_id not in (select o.user_id from public.cabin_owners o where o.cabin_id::text like '20000000%')));
select pg_temp.check('ingen SMS når SMS er slått av', not exists (select 1 from public.sms_targets((select id from public.alerts where title = 'Vannet stengt'))));
delete from public.push_log where table_name = 'sms';
update public.app_settings set value = 'true' where key = 'sms_enabled';
select pg_temp.check('SMS-mottakere: kontaktpersonen, ellers første med mobil, likt nummer én gang',
  (select array_agg(phone order by phone) from public.sms_targets((select id from public.alerts where title = 'Vannet stengt')))
  = array['+4791111111', '+4794444444']);
select pg_temp.check('samme varsel gir aldri SMS to ganger', not exists (select 1 from public.sms_targets((select id from public.alerts where title = 'Vannet stengt'))));
select pg_temp.check('SMS-teksten lages av varselet',
  (select message from public.sms_targets((select id from public.alerts where title = 'Vannprøve')) limit 1) = 'Mørvika Vann og Avløp: Vannprøve');

select public.sms_record(jsonb_build_array(
  jsonb_build_object('alert_id', (select id from public.alerts where title = 'Vannet stengt'), 'sender', 'grunneier', 'phone', '+4791111111', 'status', 'sendt', 'parts', 1, 'cost', 0.35),
  jsonb_build_object('alert_id', (select id from public.alerts where title = 'Vannet stengt'), 'sender', 'grunneier', 'phone', '+4794444444', 'status', 'sendt', 'parts', 2, 'cost', 0.70),
  jsonb_build_object('alert_id', (select id from public.alerts where title = 'Vannprøve'), 'sender', 'va', 'phone', '+4791111111', 'status', 'sendt', 'parts', 1, 'cost', 0.35),
  jsonb_build_object('alert_id', (select id from public.alerts where title = 'Vannprøve'), 'sender', 'va', 'phone', '+4799999999', 'status', 'feilet', 'error', 'ugyldig')));

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000401';
select pg_temp.check('VA-styret ser bare sitt eget forbruk', (select array_agg(sender::text) from public.sms_usage()) = array['va']);
select pg_temp.check('VA-styret ser SMS-status på sitt varsel',
  (select row(sent, failed)::text from public.sms_alert_status(array[(select id from public.alerts where title = 'Vannprøve')])) = '(1,1)');
select pg_temp.denied('styret kan ikke registrere oppgjør', $$select public.sms_settle(100, '')$$);

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select pg_temp.check('grunneier ser forbruket til alle',
  (select string_agg(sender || ':' || sms || '/' || parts || '/' || failed, ',' order by sender) from public.sms_usage()) = 'grunneier:2/3/0,va:1/1/1');
select public.sms_settle(100, 'Faktura 46elks oktober') as sid \gset
select pg_temp.check('oppgjøret fordeler regningen etter SMS-deler',
  (select breakdown from public.sms_settlements where id = :'sid') @> '[{"sender":"grunneier","amount":75.00},{"sender":"va","amount":25.00}]');
select pg_temp.check('etter oppgjør starter oversikten på null, historikken beholdes',
  not exists (select 1 from public.sms_usage()) and (select count(*) from public.sms_log where settlement_id = :'sid') = 4);
select pg_temp.fails('oppgjør uten nye SMS gir feil', $$select public.sms_settle(10, '')$$);

insert into public.sms_tests (phone) values ('+4791111111');
reset role;
select pg_temp.check('test-SMS går til nummeret som er oppgitt',
  (select phone from public.sms_test_target((select id from public.sms_tests limit 1))) = '+4791111111');

-- ---------------------------------------------------------------------
-- Invitasjon på SMS
-- ---------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.sms_invite_preview('morvika') as inv_n \gset
select pg_temp.check('invitasjon teller ventende eiere med e-post og mobil, én per nummer',
  :inv_n = (select count(distinct public.sms_phone(q.phone)) from public.pending_people q
             join public.pending_cabin_owners po on po.pending_id = q.id join public.cabins c on c.id = po.cabin_id
            where q.email is not null and public.sms_phone(q.phone) is not null and c.area = 'morvika') and :inv_n > 0);
insert into public.sms_batches (area, sender, message) values ('morvika', 'grunneier', 'Mørvika har fått egen app: https://app.morvika.no/installer');
select pg_temp.denied('vanlig bruker kan ikke sende invitasjoner',
  $$set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101'; insert into public.sms_batches (area, sender, message) values ('alle', 'grunneier', 'x')$$);
reset role;
select pg_temp.check('utsendingen gir én SMS per nummer, bare én gang',
  (select count(*) from public.sms_batch_targets((select id from public.sms_batches limit 1))) = :inv_n
  and not exists (select 1 from public.sms_batch_targets((select id from public.sms_batches limit 1))));

-- ---------------------------------------------------------------------
-- Gjøremål
-- ---------------------------------------------------------------------
reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-000000000601', 'medeier@example.no', '{"full_name":"Mona Medeier"}');
insert into public.cabin_owners (cabin_id, user_id) values ('10000000-0000-0000-0000-000000000047', '00000000-0000-0000-0000-000000000601');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
insert into public.tasks (title, due_at, remind_before_min) values ('Min egen oppgave', now() + interval '2 days', 60);
insert into public.tasks (title, due_at, cabin_id, repeat) values ('Tappe ned vannet', now() + interval '3 days', '10000000-0000-0000-0000-000000000047', 'maanedlig');
select pg_temp.check('første påminnelse = tidspunkt minus «i forkant»',
  (select next_remind_at = due_at - interval '60 minutes' from public.tasks where title = 'Min egen oppgave'));
select pg_temp.fails('kan ikke dele gjøremål med en hytte man ikke eier',
  $$insert into public.tasks (title, due_at, cabin_id) values ('x', now(), '10000000-0000-0000-0000-000000000012')$$);

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000601';
select pg_temp.check('medeier ser delte gjøremål, ikke private',
  exists (select 1 from public.tasks where title = 'Tappe ned vannet') and not exists (select 1 from public.tasks where title = 'Min egen oppgave'));
update public.tasks set done_at = now() where title = 'Tappe ned vannet';
select pg_temp.check('medeier kan krysse av, og neste måned legges inn (samme klokkeslett)',
  (select count(*) from public.tasks where title = 'Tappe ned vannet' and done_at is null) = 1
  and (select to_char(due_at at time zone 'Europe/Oslo', 'HH24:MI') from public.tasks where title = 'Tappe ned vannet' and done_at is null)
    = (select to_char(due_at at time zone 'Europe/Oslo', 'HH24:MI') from public.tasks where title = 'Tappe ned vannet' and done_at is not null)
  and (select done_by from public.tasks where title = 'Tappe ned vannet' and done_at is not null) = '00000000-0000-0000-0000-000000000601');
update public.tasks set done_at = null where title = 'Tappe ned vannet' and done_at is not null;
update public.tasks set done_at = now() where title = 'Tappe ned vannet' and due_at < now() + interval '4 days';
select pg_temp.check('av og på igjen gir ikke dobbelt neste gang',
  (select count(*) from public.tasks where title = 'Tappe ned vannet' and done_at is null) = 1);

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000999';
select pg_temp.check('uvedkommende ser ingen gjøremål', not exists (select 1 from public.tasks));

reset role;
update public.tasks set next_remind_at = now() - interval '1 second', nag_min = 60 where title = 'Min egen oppgave';
update public.tasks set next_remind_at = now() - interval '1 second' where title = 'Tappe ned vannet' and done_at is null;
select public.send_task_reminders() as sent_n \gset
select pg_temp.check('påminnelser sendes for gjøremål som er klare', :sent_n = 2 and (select count(*) from net.calls where body->>'table' = 'task_reminders') = 2);
select pg_temp.check('varslet i forkant: neste påminnelse ved tidspunktet',
  (select next_remind_at = due_at from public.tasks where title = 'Min egen oppgave'));
select pg_temp.check('push for delt gjøremål går til begge eierne',
  (select count(distinct t.user_id) from public.task_reminders r join public.tasks k on k.id = r.task_id and k.title = 'Tappe ned vannet',
          lateral public.push_targets('task_reminders', r.id) t) = 2);
select pg_temp.check('push for privat gjøremål går bare til eieren',
  (select array_agg(t.user_id) from public.task_reminders r join public.tasks k on k.id = r.task_id and k.title = 'Min egen oppgave',
          lateral public.push_targets('task_reminders', r.id) t) = array['00000000-0000-0000-0000-000000000101']::uuid[]);
select pg_temp.check('ingen ny påminnelse før det er tid', public.send_task_reminders() = 0);

-- ---------------------------------------------------------------------
-- FDV-mal og overlevering fra utbygger
-- ---------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000301';
select public.my_ownership('10000000-0000-0000-0000-000000000088') as w88 \gset
select public.set_fdv(:'w88', true);
select pg_temp.check('FDV-malen lager album for byggetrinnene',
  (select count(*) from public.cabin_albums where ownership_id = :'w88' and name in ('Grunnarbeid', 'Råbygg', 'Rør og elektro før lukking', 'Innvendig', 'Ferdig')) = 5
  and (select fdv from public.ownerships where id = :'w88'));
insert into public.cabin_documents (cabin_id, folder, name, storage_path) values ('10000000-0000-0000-0000-000000000088', 'Produktdatablad', 'Varmepumpe.pdf', :'w88' || '/dok/varmepumpe.pdf');
insert into public.cabin_photos (cabin_id, album_id, storage_path)
  select '10000000-0000-0000-0000-000000000088', id, :'w88' || '/foto/ror.jpg' from public.cabin_albums where ownership_id = :'w88' and name = 'Rør og elektro før lukking';
insert into public.cabin_ledger (cabin_id, entry_date, description, category, amount, kind) values ('10000000-0000-0000-0000-000000000088', current_date, 'Byggekostnad', 'Annet', 1000, 'ut');
select pg_temp.denied('andre kan ikke slå på FDV for hytta',
  $$set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101'; select public.set_fdv('$$ || :'w88' || $$', false)$$);

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.admin_transfer('10000000-0000-0000-0000-000000000088', current_date, 'salg',
  '[{"name":"Kari Kjøper","email":"kjoper@example.no","phone":"912 00 000"}]'::jsonb, 'Ny hytte, overlevert med FDV', true) as tr \gset
reset role;
select pg_temp.check('overlevering fra utbygger: dokumenter, bilder og album følger med til kjøper',
  (select count(*) from public.cabin_documents where ownership_id = :'w88') = 0
  and (select count(*) from public.cabin_photos where ownership_id = :'w88') = 0
  and (select count(*) from public.cabin_albums d join public.ownerships w on w.id = d.ownership_id where w.cabin_id = '10000000-0000-0000-0000-000000000088' and w.ends_on is null) = 5
  and (select fdv from public.ownerships where cabin_id = '10000000-0000-0000-0000-000000000088' and ends_on is null)
  and (select full_transfer_at is not null and from_builder from public.ownership_transfers where id = :'tr'));
select pg_temp.check('hytteregnskapet blir igjen hos utbyggeren', (select count(*) from public.cabin_ledger where ownership_id = :'w88') = 1);
