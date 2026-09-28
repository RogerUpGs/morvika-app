import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../lib/ui';
import { dLong } from '../lib/format';
import { Icon } from './Icon';

type Kind = 'salg' | 'familie';
type Mode = Kind | 'utbygger';
interface Row { key: string; name: string; email: string; phone: string }
interface Hist { id: string; transfer_date: string; kind: Kind; sellers: string; access_until: string | null; full_transfer_at: string | null; note: string; from_builder?: boolean }

const newRow = (): Row => ({ key: Math.random().toString(36).slice(2), name: '', email: '', phone: '' });
const emailOk = (e: string) => e.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
const today = () => new Date().toISOString().slice(0, 10);
const plus90 = (d: string) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + 90); return x.toISOString().slice(0, 10); };

/** Administrasjon: registrer salg eller overdragelse i familien for en hytte */
export function TransferPanel({ cabin, sellers, onDone, onClose }: {
  cabin: { id: string; label: string; address: string | null };
  sellers: { id: string; full_name: string; status: string }[];
  onDone: () => Promise<void>; onClose: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('salg');
  const kind: Kind = mode === 'familie' ? 'familie' : 'salg';
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hist, setHist] = useState<Hist[]>([]);

  useEffect(() => {
    void supabase.rpc('admin_transfers', { p_cabin: cabin.id }).then(({ data }) => setHist((data ?? []) as Hist[]));
  }, [cabin.id]);

  const set = (k: string, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === k ? { ...x, ...patch } : x)));
  const buyers = rows.filter((r) => r.name.trim());
  const active = sellers.filter((s) => s.status === 'aktiv');

  function check(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!buyers.length) { setErr('Skriv inn minst én ny eier.'); return; }
    const bad = rows.find((r) => !emailOk(r.email));
    if (bad) { setErr(`E-postadressen «${bad.email}» ser ikke riktig ut.`); return; }
    if (buyers.some((r) => !r.email.trim())) { setErr('Alle nye eiere bør ha e-post, ellers kan de ikke logge inn. Legg inn e-post, eller fjern raden.'); return; }
    setConfirm(true);
  }

  async function submit() {
    setBusy(true);
    const { error } = await supabase.rpc('admin_transfer', {
      p_cabin: cabin.id, p_date: date, p_kind: kind, p_note: note.trim(), p_builder: mode === 'utbygger',
      p_owners: buyers.map((r) => ({ name: r.name.trim(), email: r.email.trim(), phone: r.phone.trim() })),
    });
    setBusy(false);
    if (error) { setConfirm(false); setErr('Eierskiftet ble ikke registrert. Sjekk at databasen er oppdatert, og prøv igjen.'); return; }
    toast(`Eierskiftet for ${cabin.label} er registrert.`);
    await onDone();
    onClose();
  }

  return (
    <form className="card quick" onSubmit={check}>
      <div className="quick-h">
        <h2 className="serif">Eierskifte · {cabin.label}</h2>
        <button type="button" className="btn small ghost" onClick={onClose}>Avbryt</button>
      </div>

      <div className="seg three3" role="radiogroup" aria-label="Type eierskifte">
        <button type="button" role="radio" aria-checked={mode === 'salg'} className={mode === 'salg' ? 'on' : ''} onClick={() => setMode('salg')}>Salg<small>Ny eier starter med tom Min hytte</small></button>
        <button type="button" role="radio" aria-checked={mode === 'familie'} className={mode === 'familie' ? 'on' : ''} onClick={() => setMode('familie')}>Overdragelse i familien<small>Selger kan gi hele Min hytte videre</small></button>
        <button type="button" role="radio" aria-checked={mode === 'utbygger'} className={mode === 'utbygger' ? 'on' : ''} onClick={() => setMode('utbygger')}>Overlevering fra utbygger<small>Dokumenter, bilder og FDV følger med til kjøper</small></button>
      </div>

      <fieldset>
        <legend>Fra (nåværende eiere)</legend>
        {sellers.length
          ? <p style={{ margin: 0 }}>{sellers.map((s) => s.full_name).join(', ')}{active.length < sellers.length && <span className="muted"> · {sellers.length - active.length} har aldri logget inn</span>}</p>
          : <p className="muted" style={{ margin: 0 }}>Ingen registrert eier.</p>}
      </fieldset>

      <fieldset className="qgrid">
        <legend>Eierskiftet</legend>
        <label className="field" htmlFor="tr-date">Dato for overtakelse
          <input id="tr-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field span2" htmlFor="tr-note">Merknad (bare administrator ser den)
          <input id="tr-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="F.eks. Solgt via megler, oppgjør 1. november" />
        </label>
      </fieldset>

      <fieldset>
        <legend>Til (nye eiere)</legend>
        <div className="owners">
          {rows.map((r, i) => (
            <div key={r.key} className="ownerrow">
              <label className="field" htmlFor={`tr-name-${r.key}`}>Fullt navn
                <input id={`tr-name-${r.key}`} type="text" autoComplete="off" value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} required={i === 0} />
              </label>
              <label className="field" htmlFor={`tr-mail-${r.key}`}>E-post (brukes til innlogging)
                <input id={`tr-mail-${r.key}`} type="email" autoComplete="off" value={r.email} onChange={(e) => set(r.key, { email: e.target.value })} aria-invalid={!emailOk(r.email)} />
              </label>
              <label className="field" htmlFor={`tr-tel-${r.key}`}>Mobil
                <input id={`tr-tel-${r.key}`} type="text" inputMode="tel" autoComplete="off" value={r.phone} onChange={(e) => set(r.key, { phone: e.target.value })} />
              </label>
              <div className="ownerrow-end">
                {rows.length > 1 && <button type="button" className="linkbtn" onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))} aria-label="Fjern">Fjern</button>}
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="btn small ghost" onClick={() => setRows((x) => [...x, newRow()])}><Icon name="plus" size={16} />Legg til medeier</button>
      </fieldset>

      <div className="transfer-sum">
        <b>Dette skjer:</b>
        <ul>
          <li>{sellers.length ? sellers.map((s) => s.full_name).join(' og ') : 'Tidligere eiere'} slutter å være eiere{active.length ? ` og kan lese og laste ned Min hytte til ${dLong(plus90(date))}. Etter det slettes det` : ''}.</li>
          <li>{buyers.length ? buyers.map((b) => b.name.trim()).join(' og ') : 'Ny eier'} blir eier{buyers.length > 1 ? 'e' : ''} fra {dLong(date)} og {mode === 'utbygger' ? 'får dokumentene og bildene i Min hytte' : 'starter med tom Min hytte'}. De får tilgang første gang de logger inn med e-posten sin.</li>
          <li>{mode === 'utbygger' ? 'Alle dokumenter, bilder og album (FDV-dokumentasjonen) flyttes til kjøper med en gang. Hytteregnskapet blir ikke med.'
            : mode === 'salg' ? 'Selgeren kan velge dokumenter og bilder som skal følge hytta.' : 'Selgeren kan velge enkeltting eller gi hele Min hytte videre («Overfør alt»).'}</li>
          <li>Hyttearkivet (festekontrakt o.l.) følger hytta til ny eier.</li>
        </ul>
      </div>

      {err && <p className="err">{err}</p>}
      <div className="actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {confirm ? (
          <span className="confirm">Registrere eierskiftet? Det kan ikke angres i appen.
            <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Registrerer …' : 'Ja, registrer'}</button>
            <button type="button" className="btn ghost" onClick={() => setConfirm(false)}>Tilbake</button>
          </span>
        ) : <button className="btn primary">Registrer eierskifte</button>}
      </div>

      {hist.length > 0 && (
        <fieldset>
          <legend>Tidligere eierskifter</legend>
          <ul className="histlist">
            {hist.map((h) => (
              <li key={h.id}><b>{dLong(h.transfer_date)}</b> · {h.from_builder ? 'Overlevering fra utbygger' : h.kind === 'salg' ? 'Salg' : 'Overdragelse i familien'}{h.sellers ? ` fra ${h.sellers}` : ''}
                {h.full_transfer_at && <span className="pill" style={{ marginLeft: 6 }}>{h.from_builder ? 'FDV overlevert' : 'Alt overført'}</span>}
                {h.note && <div className="muted" style={{ fontSize: 13 }}>{h.note}</div>}</li>
            ))}
          </ul>
        </fieldset>
      )}
    </form>
  );
}
