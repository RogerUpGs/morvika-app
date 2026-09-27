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
