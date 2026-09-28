import { useMemo, useState } from 'react';
import { useMe } from '../lib/session';
import { useToast } from '../lib/ui';
import { Icon } from './Icon';

interface P { id: string; status: 'aktiv' | 'venter' | 'mangler_epost'; full_name: string; email: string | null; phone: string | null; cabin_ids: string[] }
interface C { id: string; area: 'morvika' | 'torpum'; label: string }
type Area = 'alle' | 'morvika' | 'torpum';

const mailText = (area: Area, name: string) => area === 'torpum' ? `Hei!

Mørvikveien Veilag har fått en egen app. Der får du nyheter og viktige varsler fra Veilaget, for eksempel om brøyting, stengt vei og årsmøte, og du kan sende meldinger med bilder til Veilagets styre.

Slik kommer du i gang på telefonen:
1. Gå til app.morvika.no (iPhone: i Safari, Android: i Chrome).
2. Legg appen på hjemskjermen:
   iPhone: Del-knappen (på nyere iPhone under •••) → «Legg til på Hjem-skjerm»
   Android: menyen (⋮) → «Legg til på startskjermen» eller «Installer app»
3. Åpne appen fra ikonet på hjemskjermen. Skriv inn denne e-postadressen og trykk «Send meg en kode».
4. Skriv inn koden du får på e-post. Sjekk søppelpost hvis den ikke kommer.
5. Trykk «Slå på varsler», så får du beskjed på telefonen.

Veiledning med bilder: app.morvika.no/installer
På PC går du bare til app.morvika.no og logger inn.

Er du registrert med feil e-postadresse, svar på denne e-posten.

Hilsen
${name}
Mørvikveien Veilag` : `Hei!

Nå har Mørvika hytteområde fått en egen app. Der finner du:
• nyheter og viktige varsler fra grunneier, Mørvika Vel og Mørvikveien Veilag
• meldinger til grunneier og styrene, med bilder fra telefonen
• Hyttepraten, der hytteeierne deler bilder og nytt
• dugnader og arrangementer med påmelding
• Min hytte: din private del med dokumenter, bilder og hytteregnskap

Slik kommer du i gang på telefonen:
1. Gå til app.morvika.no (iPhone: i Safari, Android: i Chrome).
2. Legg appen på hjemskjermen:
   iPhone: Del-knappen (på nyere iPhone under •••) → «Legg til på Hjem-skjerm»
   Android: menyen (⋮) → «Legg til på startskjermen» eller «Installer app»
3. Åpne appen fra ikonet på hjemskjermen. Skriv inn denne e-postadressen og trykk «Send meg en kode».
4. Skriv inn koden du får på e-post. Sjekk søppelpost hvis den ikke kommer.
5. Trykk «Slå på varsler», så får du beskjed på telefonen.

Veiledning med bilder: app.morvika.no/installer
På PC går du bare til app.morvika.no og logger inn.

Er du registrert med feil e-postadresse, eller skal en medeier også ha tilgang? Svar på denne e-posten.

Hilsen
${name}
Grunneier, Mørvika`;

const smsText = (area: Area) => area === 'torpum'
  ? 'Mørvikveien Veilag har fått egen app med nyheter og varsler om veien. Gå til app.morvika.no og logg inn med e-postadressen din. Du får en kode på e-post.'
  : 'Mørvika hytteområde har fått egen app med nyheter, varsler og Min hytte. Gå til app.morvika.no og logg inn med e-postadressen din. Du får en kode på e-post.';

/** Administrasjon → Personer og roller: hjelp til å invitere dem som ikke har logget inn */
export function InviteCard({ people, cabins }: { people: P[]; cabins: C[] }) {
  const me = useMe();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [area, setArea] = useState<Area>('alle');
  const [text, setText] = useState<string | null>(null);

  const areaOf = useMemo(() => new Map(cabins.map((c) => [c.id, c.area])), [cabins]);
  const inArea = (p: P) => area === 'alle' || p.cabin_ids.some((id) => areaOf.get(id) === area);
  const owners = people.filter((p) => p.cabin_ids.length > 0);
  const waiting = owners.filter((p) => p.status === 'venter' && p.email && inArea(p));
  const noEmail = owners.filter((p) => p.status === 'mangler_epost' && inArea(p));
  const phones = waiting.filter((p) => p.phone);
  const body = text ?? mailText(area, me.profile?.full_name ?? '');

  async function copy(s: string, what: string) {
    try { await navigator.clipboard.writeText(s); toast(`${what} er kopiert.`); }
    catch { toast('Kopieringen virket ikke i denne nettleseren. Marker og kopier manuelt.'); }
  }

  if (!open) {
    return (
      <button className="card invitebar" onClick={() => setOpen(true)}>
        <Icon name="mail" size={22} />
        <span><b>Inviter hytteeiere</b><small>{owners.filter((p) => p.status === 'venter').length} har ikke logget inn ennå · kopier e-postadresser og ferdig invitasjonstekst</small></span>
        <Icon name="chev" size={18} />
      </button>
    );
  }

  return (
    <section className="card invite">
      <div className="quick-h">
        <h2 className="serif" style={{ margin: 0, fontSize: 22 }}>Inviter hytteeiere</h2>
        <button className="btn small ghost" onClick={() => setOpen(false)}>Lukk</button>
      </div>
      <p className="muted" style={{ margin: '4px 0 12px' }}>
        Send e-posten fra ditt eget e-postprogram eller forvaltningssystem. Legg adressene i <b>Blindkopi (BCC)</b>, så ser ikke mottakerne hverandre.
      </p>

      <div className="chips" role="group" aria-label="Hvem skal inviteres" style={{ marginBottom: 12 }}>
        {(['alle', 'morvika', 'torpum'] as Area[]).map((a) => (
          <button key={a} className={`chip ${area === a ? 'on' : ''}`} onClick={() => { setArea(a); setText(null); }}>
            {a === 'alle' ? 'Alle' : a === 'morvika' ? 'Mørvika' : 'Torpum'}
          </button>
        ))}
      </div>

      <div className="invite-steps">
        <div className="istep">
          <span className="inum">1</span>
          <div>
            <b>E-postadresser ({waiting.length})</b>
            <p className="muted">Alle som er registrert{area !== 'alle' ? ` i ${area === 'morvika' ? 'Mørvika' : 'Torpum'}` : ''}, men ikke har logget inn ennå.</p>
            <button className="btn primary small" disabled={!waiting.length} onClick={() => void copy(waiting.map((p) => p.email).join('; '), `${waiting.length} e-postadresser`)}>
              <Icon name="mail" size={16} />Kopier e-postadressene</button>
          </div>
        </div>

        <div className="istep">
          <span className="inum">2</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <b>Emne og tekst</b>
            <div className="subjectline">
              <code>{area === 'torpum' ? 'Mørvikveien Veilag har fått egen app' : 'Ny app for Mørvika hytteområde'}</code>
              <button className="btn small ghost" onClick={() => void copy(area === 'torpum' ? 'Mørvikveien Veilag har fått egen app' : 'Ny app for Mørvika hytteområde', 'Emnet')}>Kopier emne</button>
            </div>
            <textarea className="invitetext" value={body} onChange={(e) => setText(e.target.value)} aria-label="Invitasjonstekst" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <button className="btn primary small" onClick={() => void copy(body, 'Teksten')}>Kopier teksten</button>
              {text !== null && <button className="btn small ghost" onClick={() => setText(null)}>Tilbakestill teksten</button>}
            </div>
          </div>
        </div>

        <div className="istep">
          <span className="inum">3</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <b>Påminnelse på SMS (valgfritt)</b>
            <p className="muted">For dem som ikke har logget inn etter e-posten. Send fra forvaltningssystemet ditt.</p>
            <div className="subjectline"><code style={{ whiteSpace: 'normal' }}>{smsText(area)}</code></div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <button className="btn small" disabled={!phones.length} onClick={() => void copy(phones.map((p) => p.phone!.replace(/\s/g, '')).join(', '), `${phones.length} mobilnumre`)}>Kopier mobilnumre ({phones.length})</button>
              <button className="btn small ghost" onClick={() => void copy(smsText(area), 'SMS-teksten')}>Kopier SMS-teksten</button>
            </div>
          </div>
        </div>
      </div>

      {noEmail.length > 0 && (
        <div className="noemail">
          <b>{noEmail.length} {noEmail.length === 1 ? 'eier mangler' : 'eiere mangler'} e-post og kan ikke logge inn:</b>
          <ul>{noEmail.map((p) => <li key={p.id}>{p.full_name}{p.phone ? ` · ${p.phone}` : ''} <span className="muted">{p.cabin_ids.map((id) => cabins.find((c) => c.id === id)?.label).filter(Boolean).join(', ')}</span></li>)}</ul>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Legg inn e-post via «Rediger» på hytta i hytteregisteret.</p>
        </div>
      )}
    </section>
  );
}
