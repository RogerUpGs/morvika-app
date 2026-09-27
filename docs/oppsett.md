# Oppsett av Supabase og Cloudflare

Denne veiledningen gjøres én gang. Rekkefølgen er viktig: databasen må legges inn **før** den første brukeren opprettes, fordi den første brukeren automatisk blir grunneier og administrator.

## 1. Legg inn databasen

1. Åpne filen `supabase/migrations/20260927120000_grunnmur.sql` på GitHub og trykk **Copy raw file** (ikonet med to firkanter øverst til høyre over koden).
2. I Supabase: velg prosjektet **morvika** og gå til **SQL Editor** i menyen til venstre.
3. Trykk **New query**, lim inn og trykk **Run**.
4. Du skal få «Success. No rows returned». Under **Table Editor** ser du nå tabellene.

## 2. Steng for selvregistrering

Bare inviterte skal kunne logge inn.

1. Gå til **Authentication → Sign In / Providers**.
2. Slå **av** «Allow new users to sign up». Sjekk at **Email** fortsatt er slått på.
3. Trykk **Save**.

## 3. E-posten med innloggingskoden (satt opp 27. sep 2026)

E-post sendes via **Resend** fra `noreply@morvika.no` (domenet godkjent med DKIM `resend._domainkey` og CNAME `send`/`rsend` i Cloudflare, «DNS only»). Supabase: Authentication → Emails → SMTP Settings: `smtp.resend.com`, port 465, brukernavn `resend`, passord = API-nøkkel fra Resend. Malene «Magic link» og «Confirm signup» viser koden (`{{ .Token }}`) i emnet og i teksten. Malene har **ingen lenke**: Microsoft 365/Outlook «klikker» lenker i e-post automatisk og bruker da opp koden.

### Opprinnelig notat

Supabase lar oss ikke endre e-postmalene før prosjektet har en egen e-posttjeneste (SMTP). Inntil da sender Supabase en e-post med lenken «Sign in», som logger deg rett inn. Det holder for testing.

Før hytteeierne inviteres, setter vi opp en egen e-posttjeneste (for eksempel Brevo eller Resend) og endrer malen **Magic link or OTP** til å vise koden:

```html
<h2>Innloggingskode</h2>
<p>Skriv inn denne koden i Mørvika-appen:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
<p>Koden gjelder i én time. Har du ikke bedt om den, kan du se bort fra denne e-posten.</p>
```

## 4. Opprett din egen bruker

1. Gå til **Authentication → Users** og trykk **Add user → Create new user**.
2. Skriv inn e-postadressen din. La passordfeltet stå tomt, og huk av for **Auto Confirm User**.
3. Trykk **Create user**. Du er nå grunneier og administrator.

## 5. Publiser appen på Cloudflare

1. Gå til **dash.cloudflare.com → Workers & Pages → Create**.
2. Velg fanen **Pages** (eller lenken «Looking to deploy Pages? Get started») og **Connect to Git**.
3. Koble til GitHub og velg prosjektet **morvika-app**.
4. Innstillinger:
   - **Framework preset:** Vite (eller None)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
5. Trykk **Save and Deploy**. Etter et par minutter får du en adresse som `morvika-app.pages.dev`.

## 6. Fortell Supabase hvor appen ligger

1. I Supabase: **Authentication → URL Configuration**.
2. **Site URL:** adressen fra Cloudflare, for eksempel `https://morvika-app.pages.dev`.
3. Trykk **Save**.

## 7. Test

Åpne adressen på telefonen, skriv inn e-posten din og tast inn koden du får. Legg gjerne appen på hjemskjermen:

- **iPhone:** Safari → Del → «Legg til på Hjem-skjerm».
- **Android:** Chrome → menyen → «Installer app».

## Oppdateringer av databasen

Når det kommer en ny fil i `supabase/migrations/`, kjøres den på samme måte som i steg 1: kopier filen fra GitHub, lim den inn i **SQL Editor** og trykk **Run**. Filene kjøres i rekkefølge etter navnet, og hver fil bare én gang.

| Fil | Innhold | Kjørt |
| --- | --- | --- |
| `20260927120000_grunnmur.sql` | Tabeller, tilgangsregler og lagring | 27. sep 2026 |
| `20260927143000_torpum_veilag.sql` | Torpum og tilgangsnivået «Bare Veilaget» | 27. sep 2026 |
| `20260927153000_grunneier_vel_veilag.sql` | Grunneier har full tilgang til Vel og Veilag | 27. sep 2026 |
| `20260927160000_eierskifte.sql` | Eierperioder, eierskifte og hyttearkiv | 27. sep 2026 |
| `20260927170000_registrering.sql` | Hurtigregistrering, ventende personer og aktivering ved første innlogging | 27. sep 2026 |
| `20260927180000_tomtetype.sql` | Tomtetype på hytta: festetomt eller selveiertomt | 27. sep 2026 |
| `20260927190000_betegnelse.sql` | Veinavn i betegnelsen på hytter som allerede er registrert | 27. sep 2026 |
| `20260927200000_varsler.sql` | Oversikt over hvem som har bekreftet et varsel | 27. sep 2026 |
| `20260927210000_push.sql` | Push-varsler: signal til Edge Function, mottakere, abonnement | 27. sep 2026 |
| `20260927220000_samtale_fra_styret.sql` | Grunneier og styrene kan starte en samtale med en hytteeier | 27. sep 2026 |

## Slipp inn registrerte hytteeiere (etter `20260927170000_registrering.sql`)

Hytteeierne får konto automatisk første gang de logger inn, men bare hvis e-postadressen er registrert i Administrasjon. Det styres av en «hook» i Supabase:

1. Gå til **Authentication → Hooks** (under «Configuration»).
2. Trykk **Add hook** og velg **Before User Created**.
3. **Hook type:** Postgres. **Schema:** public. **Function:** `hook_before_user_created`.
4. Trykk **Create hook**.
5. Gå til **Authentication → Sign In / Providers** og slå **på** «Allow new users to sign up». Trykk **Save changes**.

Rekkefølgen er viktig: hooken først, deretter påmelding. Uten hooken kunne hvem som helst laget en konto, men de ville ikke sett noe innhold.

## Push-varsler til telefonen (etter `20260927210000_push.sql`)

1. **Kjør databasefilen** `20260927210000_push.sql` i SQL Editor.
2. **Lag nøkler i appen:** Administrasjon → Oppsett → «Lag nøkler for push». La siden stå åpen.
3. **Legg inn nøklene i Supabase:** Edge Functions → Secrets → legg til `VAPID_PUBLIC_KEY` og `VAPID_PRIVATE_KEY` med verdiene fra appen.
4. **Lag funksjonen:** Edge Functions → Deploy a new function → Via Editor. Navn: `push`. Lim inn innholdet i `supabase/functions/push/index.ts` og trykk Deploy.
5. **Slå av JWT-sjekken:** åpne funksjonen `push` → Details (eller Settings) → slå **av** «Verify JWT» / «Enforce JWT verification» → Save. Databasen kaller funksjonen uten innlogging; funksjonen sender bare for rader som er nye og ikke varslet før.
6. **Test:** Åpne appen på telefonen (iPhone: lagt på Hjem-skjerm), trykk «Slå på varsler». Send et varsel fra PC-en til en gruppe telefonen er med i.

Feilsøking: Edge Functions → push → Logs viser hvor mange som fikk varsel (`sent`). Ingen logglinjer betyr at databasen ikke når funksjonen (sjekk at pg_net er slått på under Database → Extensions).
