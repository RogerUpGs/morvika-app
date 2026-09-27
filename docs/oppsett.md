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

## 3. E-posten med innloggingskoden (venter)

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
| `20260927143000_torpum_veilag.sql` | Torpum og tilgangsnivået «Bare Veilaget» | |
