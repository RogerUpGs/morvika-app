import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useMe } from '../lib/session';
import { useToast } from '../lib/ui';
import { isIos, usePush } from '../lib/push';
import { Icon } from './Icon';

const HIDE_KEY = 'push-prompt-hidden';

/** Kort oppfordring på startsiden: «Få varsler på telefonen» */
export function PushPrompt() {
  const { state, busy, enable } = usePush();
  const toast = useToast();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; } });
  if (hidden || !(state === 'av' || state === 'ios-hjemskjerm')) return null;
  const hide = () => { setHidden(true); try { localStorage.setItem(HIDE_KEY, '1'); } catch { /* privat modus */ } };

  return (
    <div className="card pushprompt">
      <Icon name="bell" size={26} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <b>Få varsler på telefonen</b>
        {state === 'ios-hjemskjerm'
          ? <p>På iPhone må appen ligge på Hjem-skjermen først: trykk <b>Del</b> <span aria-hidden="true">⎋</span> nederst i Safari og velg <b>«Legg til på Hjem-skjerm»</b>. Åpne appen derfra og slå på varsler.</p>
          : <p>Du får beskjed med en gang når det kommer et viktig varsel, et svar på en melding eller en ny nyhet.</p>}
        <div className="pp-actions">
          {state === 'av' && (
            <button className="btn primary small" disabled={busy} onClick={async () => { const e = await enable(); toast(e ?? 'Varsler er slått på.'); }}>
              {busy ? 'Slår på …' : 'Slå på varsler'}
            </button>
          )}
          <button className="btn ghost small" onClick={hide}>Ikke nå</button>
        </div>
      </div>
    </div>
  );
}

interface Prefs { news: boolean; messages: boolean; praten: boolean }

/** Full innstilling på Min profil */
export function PushSettings() {
  const me = useMe();
  const toast = useToast();
  const { state, busy, enable, disable } = usePush();
  const [prefs, setPrefs] = useState<Prefs>({ news: true, messages: true, praten: true });

  useEffect(() => {
    void supabase.from('notification_prefs').select('news,messages,praten').maybeSingle().then(({ data }) => { if (data) setPrefs(data as Prefs); });
  }, []);

  async function setPref(k: keyof Prefs, v: boolean) {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    const { error } = await supabase.from('notification_prefs').upsert({ user_id: me.session?.user.id, ...next }, { onConflict: 'user_id' });
    if (error) toast('Valget ble ikke lagret. Prøv igjen.');
  }

  const status: Record<string, string> = {
    'laster': 'Sjekker …',
    'ikke-stottet': 'Denne nettleseren kan ikke ta imot varsler. Bruk Chrome, Edge, Firefox eller Safari, gjerne med appen lagt på hjemskjermen.',
    'ios-hjemskjerm': 'På iPhone og iPad må appen ligge på Hjem-skjermen: trykk Del i Safari og velg «Legg til på Hjem-skjerm». Åpne appen derfra og kom tilbake hit.',
    'ikke-satt-opp': 'Push-varsler er ikke satt opp ennå. Administrator gjør det under Administrasjon → Oppsett.',
    'blokkert': isIos()
      ? 'Varsler er blokkert. Åpne Innstillinger → Varslinger → Mørvika på telefonen og slå på «Tillat varslinger».'
      : 'Varsler er blokkert i nettleseren. Trykk på hengelåsen ved adressefeltet og tillat varsler for app.morvika.no.',
    'av': 'Varsler er av på denne enheten.',
    'på': 'Varsler er på for denne enheten.',
  };

  const rows: [keyof Prefs, string, string][] = [
    ['messages', 'Meldinger', 'Svar fra grunneier og styrene, og nye meldinger til deg'],
    ['news', 'Nyheter', 'Nye oppslag fra grunneier, Velet og Veilaget'],
    ['praten', 'Hyttepraten', 'Når noen kommenterer innlegget ditt'],
  ];

  return (
    <section className="card">
      <h3 className="serif" style={{ margin: '0 0 6px', fontSize: 18 }}>Varsler på telefonen</h3>
      <p className="muted" style={{ margin: '0 0 12px' }}>{status[state]}</p>
      {state === 'av' && <button className="btn primary" disabled={busy} onClick={async () => { const e = await enable(); toast(e ?? 'Varsler er slått på.'); }}><Icon name="bell" size={18} />{busy ? 'Slår på …' : 'Slå på varsler'}</button>}
      {state === 'på' && <button className="btn ghost small" disabled={busy} onClick={() => void disable()}>Slå av på denne enheten</button>}

      <div className="prefs" style={{ marginTop: 16 }}>
        <label className="pref"><span>Akutte og viktige varsler<small>Kan ikke slås av</small></span><input type="checkbox" className="tg" checked disabled /></label>
        {rows.map(([k, t, d]) => (
          <label key={k} className="pref"><span>{t}<small>{d}</small></span>
            <input type="checkbox" className="tg" checked={prefs[k]} onChange={(e) => void setPref(k, e.target.checked)} />
          </label>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>Varsler slås på for hver telefon eller PC du bruker. Valgene over gjelder alle.</p>
    </section>
  );
}
