# Mørvika Hytteområde

Web-app (PWA) for kommunikasjon mellom grunneier, Mørvika Vel, Mørvika Veiforening og hytteeierne i Mørvika og Sandbukta. Én app for PC, nettbrett og telefon.

- **Prototype:** https://claude.ai/artifact/8TNfg7E5mpENvt7xEm34RR
- **Oppsett av Supabase og Cloudflare:** [docs/oppsett.md](docs/oppsett.md)

## Status

| Fase | Innhold | Status |
| --- | --- | --- |
| 1 · Grunnmur | Database, tilgangsregler, innlogging med kode på e-post, appskall, Nyheter | Ferdig, klar for oppsett |
| 2 · Administrasjon | Hytter, eiere, roller, invitasjoner med QR-kode | Neste |
| 3 · Fellesskap og varsler | Hyttepraten, Varsler med push, Meldinger, Arrangementer, Info | |
| 4 · Min hytte | Dokumentregister, fotoalbum, hytteregnskap | |
| 5 · Lansering | Invitasjon til alle hytteeiere | |

## Teknikk

- React + TypeScript, bygget med Vite
- Supabase i Stockholm (eu-north-1): innlogging, Postgres med Row Level Security, fillagring
- Cloudflare Pages: `npm run build`, utdata i `dist`

## Mapper

- `src/` – appen
- `supabase/migrations/` – databasen (tabeller, tilgangsregler, lagring)
- `supabase/tests/` – tester av tilgangsreglene mot en lokal PostgreSQL (`PGHOST=… PGPORT=… npm run test:db`)
- `docs/` – veiledninger

## Tilgangsregler i korte trekk

- Ingenting er åpent for anonyme brukere.
- Bare inviterte (eier av en hytte, eller med en rolle) ser innhold.
- Nyheter, varsler og arrangementer vises for mottakergruppen: alle, Mørvika, Sandbukta, Vel-medlemmer eller Vei-medlemmer.
- Meldinger ses bare av hytteeieren og mottakeren (grunneier, styret i Vel eller styret i Veiforeningen).
- Min hytte ses bare av hyttas eiere. Grunneier og administrator har ingen unntak.
- E-post og telefonnummer er skjult for andre brukere.
- Den første brukeren som opprettes, blir grunneier og administrator.
