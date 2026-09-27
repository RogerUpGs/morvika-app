# Mørvika Hytteområde

Web-app (PWA) for kommunikasjon mellom grunneier, Mørvika Vel, Mørvikveien Veilag og hytteeierne i Mørvika og Torpum. Én app for PC, nettbrett og telefon.

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
- Nyheter, varsler og arrangementer vises for mottakergruppen: alle, Mørvika, Torpum, Vel-medlemmer eller Veilag-medlemmer.
- Torpum (ekstern eiendom, tilgang «veilag») ser bare det som kommer fra Mørvikveien Veilag: nyheter, varsler, arrangementer, dokumenter og meldinger til Veilagets styre.
- Meldinger ses bare av hytteeieren og mottakeren (grunneier, styret i Vel eller styret i Mørvikveien Veilag).
- Grunneier har full tilgang til Velet og Veilaget: kan publisere, varsle og lage arrangementer for begge, og leser meldinger til begge styrene.
- Min hytte ses bare av hyttas eiere, og bare for hytter med full tilgang. Grunneier og administrator har ingen unntak.
- E-post og telefonnummer er skjult for andre brukere.

## Eierskifte

- Min hytte hører til en **eierperiode** for hytta. Medeiere i samme periode deler Min hytte.
- Administrator registrerer eierskiftet (`register_transfer`): salg eller overdragelse i familien.
- Ny eier starter med tom Min hytte. Tidligere eiere kan lese og laste ned sine data i 90 dager.
- Selgeren velger dokumenter og bilder som skal følge hytta (`hand_over`).
- Ved overdragelse i familien kan selgeren godkjenne at hele Min hytte følger med (`approve_full_transfer`).
- **Hyttearkivet** følger hytta: grunneier legger inn festekontrakt o.l., nåværende eiere kan lese.
- Sletting etter fristen gjøres av en planlagt jobb som lages sammen med Min hytte.
- Den første brukeren som opprettes, blir grunneier og administrator.
