import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useMe } from '../lib/session';
import { useToast } from '../lib/ui';
import { ROLE_LABEL } from '../lib/types';
import { Icon } from '../components/Icon';
import { PushSettings } from '../components/PushCard';

export function ProfilePage() {
  const me = useMe();
  const toast = useToast();
  const [name, setName] = useState(me.profile?.full_name ?? '');
  const [phone, setPhone] = useState(me.profile?.phone ?? '');
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!me.session) return;
    setBusy(true);
    const { error } = await supabase.from('profiles')
      .update({ full_name: name.trim(), phone: phone.trim() || null })
      .eq('id', me.session.user.id);
    setBusy(false);
    if (error) toast('Endringene ble ikke lagret. Prøv igjen.');
    else { toast('Profilen er lagret.'); void me.reload(); }
  }

  return (
    <div className="stack" style={{ maxWidth: 620 }}>
      <form className="card form" onSubmit={save}>
        <label className="field full" htmlFor="pf-name">Navn
          <input id="pf-name" type="text" autoComplete="name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field full" htmlFor="pf-email">E-post
          <input id="pf-email" type="email" value={me.profile?.email ?? me.session?.user.email ?? ''} disabled />
        </label>
        <label className="field full" htmlFor="pf-phone">Telefon (valgfritt)
          <input id="pf-phone" type="text" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <div className="actions full"><button className="btn primary" disabled={busy || name.trim().length < 2}>{busy ? 'Lagrer …' : 'Lagre'}</button></div>
      </form>

      <PushSettings />

      <section className="card">
        <h3 className="serif" style={{ margin: '0 0 8px', fontSize: 18 }}>Hytter og roller</h3>
        <p className="muted" style={{ margin: 0 }}>
          {me.cabins.length ? me.cabins.map((c) => `${c.label}${c.gnr ? ` (gnr ${c.gnr} / bnr ${c.bnr})` : ''}`).join(', ') : 'Ingen hytte registrert.'}
        </p>
        <div className="rolechips" style={{ marginTop: 10 }}>
          {me.cabins.length > 0 && <span className="pill">Hytteeier</span>}
          {me.roles.map((r) => <span key={r} className="pill">{ROLE_LABEL[r]}</span>)}
        </div>
        <p className="muted" style={{ margin: '10px 0 0', fontSize: 13 }}>Hytter og roller endres av administrator.</p>
      </section>

      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => void me.signOut()}><Icon name="out" size={18} />Logg ut</button>
    </div>
  );
}
