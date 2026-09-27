import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../lib/ui';
import { bytesToB64url } from '../lib/push';

/** Administrasjon → Oppsett: nøkler for push-varsler */
export function PushSetup() {
  const toast = useToast();
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [fresh, setFresh] = useState<{ pub: string; priv: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase.from('app_settings').select('value').eq('key', 'vapid_public').maybeSingle()
      .then(({ data, error }) => setCurrent(error ? null : ((data as { value: string } | null)?.value ?? null)));
  }, []);

  async function generate() {
    setBusy(true); setConfirm(false);
    try {
      // Nøklene lages her i nettleseren. Den private nøkkelen lagres ikke i appen.
      const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const pub = bytesToB64url(await crypto.subtle.exportKey('raw', kp.publicKey));
      const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
      const { error } = await supabase.from('app_settings').upsert({ key: 'vapid_public', value: pub, updated_at: new Date().toISOString() });
      if (error) { toast('Nøkkelen ble ikke lagret. Er databasefilen for push kjørt?'); return; }
      setFresh({ pub, priv: jwk.d! });
      setCurrent(pub);
    } finally { setBusy(false); }
  }

  const copy = (s: string) => { void navigator.clipboard?.writeText(s).then(() => toast('Kopiert.')); };

  return (
    <section className="card" style={{ maxWidth: 760 }}>
      <h2 className="serif" style={{ margin: '0 0 6px', fontSize: 22 }}>Push-varsler</h2>
      {current === undefined && <p className="muted">Sjekker …</p>}
      {current === null && !fresh && (
        <>
          <p className="muted">Push er ikke satt opp. Trykk knappen for å lage et nøkkelpar. Nøklene lages her i nettleseren, og den private nøkkelen vises bare én gang.</p>
          <button className="btn primary" disabled={busy} onClick={() => void generate()}>{busy ? 'Lager …' : 'Lag nøkler for push'}</button>
        </>
      )}
      {current && !fresh && (
        <>
          <p className="muted">Push er satt opp. Offentlig nøkkel:</p>
          <div className="keybox"><code>{current}</code></div>
          <p className="muted" style={{ fontSize: 13 }}>
            Lager du nye nøkler, slutter varsler å virke hos alle til de har slått dem på igjen. Gjør det bare hvis den private nøkkelen er mistet.
          </p>
          {confirm ? (
            <span className="confirm">Lage nye nøkler?
              <button className="btn small danger-btn" onClick={() => void generate()}>Ja, lag nye</button>
              <button className="btn small ghost" onClick={() => setConfirm(false)}>Avbryt</button>
            </span>
          ) : <button className="btn small ghost" onClick={() => setConfirm(true)}>Lag nye nøkler</button>}
        </>
      )}
      {fresh && (
        <>
          <p><b>Nøklene er laget.</b> Legg dem inn i Supabase nå. Den private nøkkelen vises ikke igjen.</p>
          <ol className="setup-steps">
            <li>Gå til <b>Edge Functions → Secrets</b> i Supabase.</li>
            <li>Legg til <code>VAPID_PUBLIC_KEY</code> med denne verdien:
              <div className="keybox"><code>{fresh.pub}</code><button className="btn small" onClick={() => copy(fresh.pub)}>Kopier</button></div></li>
            <li>Legg til <code>VAPID_PRIVATE_KEY</code> med denne verdien:
              <div className="keybox"><code>{fresh.priv}</code><button className="btn small" onClick={() => copy(fresh.priv)}>Kopier</button></div></li>
            <li>Trykk <b>Save</b>.</li>
          </ol>
          <button className="btn ghost small" style={{ marginTop: 14 }} onClick={() => setFresh(null)}>Ferdig, skjul nøklene</button>
        </>
      )}
    </section>
  );
}
