-- Tester tilgangsreglene. Hver sjekk skriver OK eller FEIL.
\set ON_ERROR_STOP on
\o /dev/null
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as
  $$ begin raise notice '% %', case when ok then 'OK  ' else 'FEIL' end, label; end $$;

-- Brukere (som superbruker). Roger opprettes først og blir admin + grunneier.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'roger@example.no', '{"full_name":"Roger Mørk"}'),
  ('00000000-0000-0000-0000-000000000047', 'kari@example.no',  '{"full_name":"Kari Nilsen"}'),
  ('00000000-0000-0000-0000-000000000144', 'per@example.no',   '{"full_name":"Per Strand"}'),
  ('00000000-0000-0000-0000-000000000012', 'trond@example.no', '{"full_name":"Trond Aas"}'),
  ('00000000-0000-0000-0000-000000000999', 'ukjent@example.no','{}');

insert into public.cabins (id, area, number, label, vel_member, vei_member) values
  ('10000000-0000-0000-0000-000000000047', 'morvika',   47, 'Hytte 47',     true,  true),
  ('10000000-0000-0000-0000-000000000012', 'morvika',   12, 'Hytte 12',     true,  true),
  ('10000000-0000-0000-0000-000000000144', 'sandbukta',  6, 'Sandbukta 6',  false, true);
insert into public.cabin_owners values
  ('10000000-0000-0000-0000-000000000047', '00000000-0000-0000-0000-000000000047'),
  ('10000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000012'),
  ('10000000-0000-0000-0000-000000000144', '00000000-0000-0000-0000-000000000144');
insert into public.user_roles values ('00000000-0000-0000-0000-000000000012', 'styre_vel');

select pg_temp.check('første bruker ble admin og grunneier',
  (select count(*) from public.user_roles where user_id = '00000000-0000-0000-0000-000000000001') = 2);
select pg_temp.check('andre brukere fikk ingen roller automatisk',
  (select count(*) from public.user_roles where user_id = '00000000-0000-0000-0000-000000000047') = 0);

set role authenticated;

-- Roger (grunneier)
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into public.news (sender, audience, title, body) values ('grunneier', 'sandbukta', 'Ny bom i Sandbukta', 'Settes opp i uke 41');
insert into public.news (sender, audience, title, body) values ('grunneier', 'alle', 'Vannet stenges', '18. oktober');
insert into public.alerts (level, sender, audience, title) values ('akutt', 'grunneier', 'alle', 'Vannlekkasje');
select pg_temp.check('grunneier ser alle nyheter', (select count(*) from public.news) = 2);
select pg_temp.check('grunneier får størrelse på mottakergruppe', public.audience_size('alle') = 3);

-- Kari (hytteeier i Mørvika)
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000047';
select pg_temp.check('Kari ser bare nyheter for sin gruppe', (select count(*) from public.news) = 1);
select pg_temp.check('Kari får ikke størrelse på mottakergruppe', public.audience_size('alle') is null);
do $$ begin
  insert into public.news (sender, audience, title) values ('grunneier', 'alle', 'Falsk');
  raise notice 'FEIL Kari kunne publisere som grunneier';
exception when insufficient_privilege then raise notice 'OK   Kari kan ikke publisere som grunneier'; end $$;
insert into public.news_reads (news_id) select id from public.news;
insert into public.alert_acks (alert_id) select id from public.alerts;
select pg_temp.check('Kari ser varselet og kan bekrefte', (select count(*) from public.alert_acks) = 1);
insert into public.cabin_ledger (cabin_id, description, amount) values ('10000000-0000-0000-0000-000000000047', 'Festeavgift', 8400);
insert into public.cabin_documents (cabin_id, name, storage_path) values ('10000000-0000-0000-0000-000000000047', 'Festekontrakt.pdf', '10000000-0000-0000-0000-000000000047/festekontrakt.pdf');
insert into storage.objects (bucket_id, name) values ('hytte', '10000000-0000-0000-0000-000000000047/festekontrakt.pdf');
do $$ begin
  insert into public.cabin_ledger (cabin_id, description, amount) values ('10000000-0000-0000-0000-000000000144', 'Inn i Pers regnskap', 1);
  raise notice 'FEIL Kari kunne skrive i Pers regnskap';
exception when insufficient_privilege then raise notice 'OK   Kari kan ikke skrive i Pers regnskap'; end $$;
do $$ begin
  insert into storage.objects (bucket_id, name) values ('hytte', '10000000-0000-0000-0000-000000000144/snikk.pdf');
  raise notice 'FEIL Kari kunne laste opp i Pers mappe';
exception when insufficient_privilege then raise notice 'OK   Kari kan ikke laste opp i Pers mappe'; end $$;
insert into public.threads (id, recipient, subject) values ('20000000-0000-0000-0000-000000000001', 'grunneier', 'Felling av furuer');
insert into public.messages (thread_id, body) values ('20000000-0000-0000-0000-000000000001', 'Kan jeg felle to furuer?');
insert into storage.objects (bucket_id, name) values ('meldinger', '20000000-0000-0000-0000-000000000001/furu.jpg');
insert into public.posts (body) values ('Nydelig morgen');
select pg_temp.check('Kari ser navnene til alle fem',
  (select count(*) from public.profiles) = 5);
do $$ begin
  perform email from public.profiles;
  raise notice 'FEIL Kari kan lese e-postkolonnen';
exception when insufficient_privilege then raise notice 'OK   e-postkolonnen er skjult for andre'; end $$;
select pg_temp.check('Kari ser sin egen e-post via my_profile', (select email from public.my_profile()) = 'kari@example.no');

-- Per (Sandbukta, ikke medlem i Vel)
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000144';
select pg_temp.check('Per ser nyheter for Sandbukta og alle', (select count(*) from public.news) = 2);
select pg_temp.check('Per ser ikke Karis regnskap', (select count(*) from public.cabin_ledger) = 0);
select pg_temp.check('Per ser ikke Karis dokumenter', (select count(*) from public.cabin_documents) = 0);
select pg_temp.check('Per ser ikke Karis filer', (select count(*) from storage.objects where bucket_id = 'hytte') = 0);
select pg_temp.check('Per ser ikke Karis samtale', (select count(*) from public.threads) = 0);
select pg_temp.check('Per ser ikke Karis meldingsbilde', (select count(*) from storage.objects where bucket_id = 'meldinger') = 0);
select pg_temp.check('Per ser Karis innlegg i Hyttepraten', (select count(*) from public.posts) = 1);
select pg_temp.check('Per ser ikke hvem som har lest nyhetene', (select count(*) from public.news_reads) = 0);

-- Roger igjen: grunneier ser samtalen, men ikke Min hytte
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select pg_temp.check('grunneier ser samtalen sendt til grunneier', (select count(*) from public.messages) = 1);
select pg_temp.check('grunneier ser meldingsbildet', (select count(*) from storage.objects where bucket_id = 'meldinger') = 1);
insert into public.messages (thread_id, body) values ('20000000-0000-0000-0000-000000000001', 'Det er greit.');
select pg_temp.check('grunneier ser IKKE Min hytte-regnskap', (select count(*) from public.cabin_ledger) = 0);
select pg_temp.check('grunneier ser IKKE Min hytte-dokumenter', (select count(*) from public.cabin_documents) = 0);
select pg_temp.check('grunneier ser IKKE Min hytte-filer', (select count(*) from storage.objects where bucket_id = 'hytte') = 0);
select pg_temp.check('grunneier ser hvem som har lest', (select count(*) from public.news_reads) = 1);
select pg_temp.check('grunneier ser bekreftelsen på varselet', (select count(*) from public.alert_acks) = 1);

-- Trond (styret i Vel) ser ikke Karis samtale med grunneier
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000012';
select pg_temp.check('styret i Vel ser ikke samtaler til grunneier', (select count(*) from public.threads) = 0);
insert into public.news (sender, audience, title) values ('vel', 'vel', 'Dugnad 10. oktober');
do $$ begin
  insert into public.news (sender, audience, title) values ('vei', 'vei', 'Falsk vei-nyhet');
  raise notice 'FEIL Trond kunne publisere som Veiforeningen';
exception when insufficient_privilege then raise notice 'OK   Trond kan ikke publisere som Veiforeningen'; end $$;

-- Per (ikke Vel-medlem) ser ikke Vel-nyheten
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000144';
select pg_temp.check('Per ser ikke nyheter bare for Vel-medlemmer', (select count(*) from public.news where sender = 'vel') = 0);

-- Ukjent innlogget person uten hytte eller rolle
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000999';
select pg_temp.check('uinvitert ser ingen nyheter', (select count(*) from public.news) = 0);
select pg_temp.check('uinvitert ser ingen innlegg', (select count(*) from public.posts) = 0);
select pg_temp.check('uinvitert ser ingen hytter', (select count(*) from public.cabins) = 0);
select pg_temp.check('uinvitert ser bare sin egen profil', (select count(*) from public.profiles) = 1);

-- Anonym (ikke innlogget)
reset request.jwt.claim.sub;
set role anon;
do $$ begin
  perform 1 from public.news;
  raise notice 'FEIL anonym kan lese nyheter';
exception when insufficient_privilege then raise notice 'OK   anonym har ingen tilgang'; end $$;
reset role;
