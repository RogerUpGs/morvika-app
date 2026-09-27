import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useMe } from '../lib/session';
import { Logo } from '../components/Icon';

export function Splash() {
  return (
    <main className="gate" aria-busy="true">
      <div style={{ display: 'grid', placeItems: 'center', gap: 16, color: 'var(--primary)' }}>
        <Logo size={44} /><div className="spinner" /><span className="muted">Laster …</span>
      </div>
    </main>
  );
}

/** Innlogget, men ikke knyttet til noen hytte eller rolle ennå. */
export function NotInvited() {
  const { session, signOut, reload, error } = useMe();
  return (
    <main className="gate">
      <div className="gate-card">
        <div className="gate-brand"><Logo /><div><b>Mørvika</b><small>Hytteområde</small></div></div>
        <div>
          <h1>Kontoen er ikke koblet til en hytte ennå</h1>
          <p>Du er logget inn som <b>{session?.user.email}</b>, men administrator har ikke koblet deg til en hytte eller gitt deg en rolle. Ta kontakt med styret eller grunneier.</p>
        </div>
        {error && <p className="err">{error}</p>}
        <button className="btn primary" onClick={() => void reload()}>Prøv igjen</button>
        <button className="btn" onClick={() => void signOut()}>Logg ut</button>
      </div>
    </main>
  );
}

/** Første innlogging: be om navn. */
export function AskName() {
  const { session, reload } = useMe();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!session) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', session.user.id);
    setBusy(false);
    if (error) setErr('Navnet ble ikke lagret. Prøv igjen.');
    else await reload();
  }

  return (
    <main className="gate">
      <div className="gate-card">
        <div className="gate-brand"><Logo /><div><b>Mørvika</b><small>Hytteområde</small></div></div>
        <div><h1>Velkommen!</h1><p>Hva heter du? Navnet vises for de andre i hytteområdet.</p></div>
        <form onSubmit={save}>
          <label className="field" htmlFor="ask-name">Fullt navn
            <input id="ask-name" type="text" autoComplete="name" required minLength={2}
              value={name} onChange={(e) => setName(e.target.value)} placeholder="Fornavn Etternavn" />
          </label>
          {err && <p className="err">{err}</p>}
          <button className="btn primary" disabled={busy || name.trim().length < 2}>{busy ? 'Lagrer …' : 'Fortsett'}</button>
        </form>
      </div>
    </main>
  );
}
