import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useMe } from '../lib/session';
import { useToast } from '../lib/ui';
import { dLong, dShort } from '../lib/format';
import { SENDER_LABEL, type Sender } from '../lib/types';
import { fetchSmsSettings, kr, type SmsSettings } from '../lib/sms';
import { Icon } from './Icon';

interface Usage { sender: Sender; sms: number; parts: number; failed: number; cost: number | null }
interface Part { sender: Sender; sms: number; parts: number; share: number; amount: number | null }
interface Settlement { id: string; settled_at: string; invoice_amount: number | null; note: string; breakdown: Part[] }
interface LogRow { id: string; created_at: string; sender: Sender; person_name: string; cabin_label: string; phone: string; status: 'sendt' | 'feilet'; parts: number; error: string | null }

const pct = (x: number) => `${Math.round(x * 100)} %`;

/** Administrasjon → SMS: forbruk per avsender, oppgjør, innstillinger og test */
export function SmsTab() {
  const me = useMe();
  const toast = useToast();
  const [usage, setUsage] = useState<Usage[] | null>(null);
  const [hist, setHist] = useState<Settlement[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [cfg, setCfg] = useState<SmsSettings | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [u, h, l, c] = await Promise.all([
      supabase.rpc('sms_usage'),
      supabase.from('sms_settlements').select('id,settled_at,invoice_amount,note,breakdown').order('settled_at', { ascending: false }).limit(24),
      supabase.from('sms_log').select('id,created_at,sender,person_name,cabin_label,phone,status,parts,error').order('created_at', { ascending: false }).limit(40),
      fetchSmsSettings(),
    ]);
    setUsage(((u.data ?? []) as Usage[]).map((r) => ({ ...r, cost: r.cost === null ? null : Number(r.cost) })));
    setHist(((h.data ?? []) as Settlement[]).map((r) => ({ ...r, invoice_amount: r.invoice_amount === null ? null : Number(r.invoice_amount) })));
    setLog((l.data ?? []) as LogRow[]);
    setCfg(c);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rows = (usage ?? []).filter((r) => r.sms > 0 || r.failed > 0);
  const totalParts = rows.reduce((a, r) => a + r.parts, 0);
  const totalSms = rows.reduce((a, r) => a + r.sms, 0);
  const invoice = Number.parseFloat(amount.replace(/\s/g, '').replace(',', '.'));
  const hasInvoice = Number.isFinite(invoice) && invoice > 0;
  const last = hist[0];

  async function settle(e: FormEvent) {
    e.preventDefault();
    if (!confirm) { setConfirm(true); return; }
    setBusy(true);
    const { error } = await supabase.rpc('sms_settle', { p_amount: hasInvoice ? invoice : null, p_note: note.trim() });
    setBusy(false); setConfirm(false);
    if (error) { toast('Oppgjøret ble ikke registrert. Prøv igjen.'); return; }
    toast('Oppgjøret er registrert. Oversikten starter på null.');
    setAmount(''); setNote('');
    void load();
  }

  return (
    <div className="stack" style={{ gap: 22 }}>
      <section className="card">
        <div className="head-row" style={{ marginBottom: 8 }}>
          <h2 className="serif h2" style={{ margin: 0 }}>Til fordeling</h2>
          <span className="muted">{last ? `Siden oppgjøret ${dLong(last.settled_at)}` : 'Siden SMS ble tatt i bruk'}</span>
        </div>
        {usage === null ? <p className="muted">Henter …</p> : rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Ingen SMS er sendt siden forrige oppgjør.</p>
        ) : (
          <div className="tbl-wrap">
            <table className="usage">
              <thead><tr><th>Avsender</th><th className="r">SMS</th><th className="r">SMS-deler</th><th className="r">Andel</th><th className="r">{hasInvoice ? 'Å betale' : 'Anslått'}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.sender}>
                    <td><span className={`badge ${r.sender === 'grunneier' ? '' : r.sender}`}>{SENDER_LABEL[r.sender]}</span>{r.failed > 0 && <div className="muted" style={{ fontSize: 12 }}>{r.failed} feilet (ikke med)</div>}</td>
                    <td className="r num">{r.sms}</td>
                    <td className="r num">{r.parts}</td>
                    <td className="r num">{totalParts ? pct(r.parts / totalParts) : '–'}</td>
                    <td className="r num">{hasInvoice ? kr(invoice * r.parts / totalParts) : cfg ? kr(r.parts * cfg.price) : '–'}</td>
                  </tr>
                ))}
                <tr><td><b>Sum</b></td><td className="r num"><b>{totalSms}</b></td><td className="r num"><b>{totalParts}</b></td><td /><td className="r num"><b>{hasInvoice ? kr(invoice) : cfg ? kr(totalParts * cfg.price) : '–'}</b></td></tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>Regningen fordeles etter antall SMS-deler. En lang SMS teller som flere deler. Anslaget bruker prisen under Innstillinger.</p>

        {totalParts > 0 && (
          <form onSubmit={(e) => void settle(e)} className="smsset" style={{ marginTop: 14 }}>
            <label className="field" htmlFor="sms-amount">Beløp på regningen (kr)
              <input id="sms-amount" type="text" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setConfirm(false); }} placeholder="F.eks. 412,50" />
            </label>
            <label className="field" htmlFor="sms-note">Merknad
              <input id="sms-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="F.eks. Faktura 46elks oktober" />
            </label>
            <div className="field">
              {confirm ? (
                <span className="confirm">Registrere oppgjør{hasInvoice ? ` på ${kr(invoice)}` : ''}? Oversikten starter på null.
                  <button className="btn small primary" disabled={busy}>Ja, registrer</button>
                  <button type="button" className="btn small ghost" onClick={() => setConfirm(false)}>Avbryt</button></span>
              ) : <button className="btn primary"><Icon name="check" size={18} />Registrer oppgjør</button>}
            </div>
          </form>
        )}
      </section>

      {hist.length > 0 && (
        <section className="card settlehist">
          <h2 className="serif h2" style={{ margin: '0 0 6px' }}>Tidligere oppgjør</h2>
          {hist.map((h) => (
            <details key={h.id}>
              <summary><b>{dLong(h.settled_at)}</b><span className="muted">{h.invoice_amount !== null ? kr(h.invoice_amount) : 'uten beløp'}{h.note ? ` · ${h.note}` : ''}</span></summary>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {h.breakdown.map((b) => (
                  <li key={b.sender}>{SENDER_LABEL[b.sender]}: {b.sms} SMS, {b.parts} deler ({pct(Number(b.share))}){b.amount !== null ? ` · ${kr(Number(b.amount))}` : ''}</li>
                ))}
              </ul>
            </details>
          ))}
        </section>
      )}

      {log.length > 0 && (
        <section className="card ledgerbox">
          <div className="ledgerbox-h"><b>Siste SMS</b><span className="muted">De {log.length} siste</span></div>
          <div className="tbl-wrap scrollbox">
            <table>
              <thead><tr><th>Når</th><th>Fra</th><th>Til</th><th>Status</th></tr></thead>
              <tbody>{log.map((r) => (
                <tr key={r.id}>
                  <td className="num">{dShort(r.created_at)} {new Date(r.created_at).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{SENDER_LABEL[r.sender]}</td>
                  <td>{r.person_name || r.phone}<div className="muted" style={{ fontSize: 12 }}>{[r.cabin_label, r.phone].filter(Boolean).join(' · ')}</div></td>
                  <td>{r.status === 'sendt' ? `Sendt${r.parts > 1 ? ` (${r.parts} deler)` : ''}` : <span style={{ color: 'var(--danger)' }}>Feilet{r.error ? `: ${r.error}` : ''}</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      {cfg && <SmsSetup cfg={cfg} myPhone={me.profile?.phone ?? ''} onSaved={load} />}
    </div>
  );
}

function SmsSetup({ cfg, myPhone, onSaved }: { cfg: SmsSettings; myPhone: string; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [enabled, setEnabled] = useState(cfg.enabled);
  const [from, setFrom] = useState(cfg.from);
  const [price, setPrice] = useState(String(cfg.price).replace('.', ','));
  const [phone, setPhone] = useState(myPhone);
  const [test, setTest] = useState<{ status: string; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const fromOk = /^[A-Za-z0-9]{1,11}$/.test(from) || /^\+[0-9]{8,15}$/.test(from);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!fromOk) { toast('Avsendernavnet kan ha opptil 11 bokstaver og tall, uten mellomrom og æøå.'); return; }
    const p = Number.parseFloat(price.replace(',', '.'));
    setBusy(true);
    const now = new Date().toISOString();
    const { error } = await supabase.from('app_settings').upsert([
      { key: 'sms_enabled', value: enabled ? 'true' : 'false', updated_at: now },
      { key: 'sms_from', value: from, updated_at: now },
      { key: 'sms_price', value: String(Number.isFinite(p) && p >= 0 ? p : 0.6), updated_at: now },
    ]);
    setBusy(false);
    if (error) { toast('Innstillingene ble ikke lagret.'); return; }
    toast(enabled ? 'Lagret. SMS kan nå velges på akutte og viktige varsler.' : 'Lagret. SMS er slått av.');
    await onSaved();
  }

  async function sendTest() {
    if (!phone.trim()) { toast('Skriv inn et mobilnummer.'); return; }
    setTest({ status: 'venter', error: null });
    const { data, error } = await supabase.from('sms_tests').insert({ phone: phone.trim() }).select('id').single();
    if (error || !data) { setTest({ status: 'feilet', error: 'Kunne ikke starte testen. Er databasen oppdatert?' }); return; }
    // Vent på svar fra Edge Function (inntil 25 sekunder)
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const { data: row } = await supabase.from('sms_tests').select('status,error').eq('id', data.id).single();
      if (row && row.status !== 'venter') { setTest(row as { status: string; error: string | null }); void onSaved(); return; }
    }
    setTest({ status: 'feilet', error: 'Fikk ikke svar. Sjekk at Edge Function «push» er oppdatert.' });
  }

  return (
    <section className="card">
      <h2 className="serif h2" style={{ margin: '0 0 8px' }}>Innstillinger</h2>
      <ol className="smssteps muted" style={{ fontSize: 14 }}>
        <li>Opprett konto på <b>46elks.se</b> og fyll på kreditt. Det er ingen månedsavgift.</li>
        <li>Under Account finner du <b>API username</b> og <b>API password</b>. Legg dem inn i Supabase → Edge Functions → Secrets som <code>ELKS_API_USERNAME</code> og <code>ELKS_API_PASSWORD</code>. Ikke send dem til noen.</li>
        <li>Oppdater Edge Function «push» med ny kode fra GitHub.</li>
        <li>Slå på SMS her, og send en test til deg selv.</li>
      </ol>

      <form onSubmit={(e) => void save(e)} className="smsset" style={{ marginTop: 14 }}>
        <label className="check" style={{ alignSelf: 'center' }}><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> <b>SMS er på</b></label>
        <label className="field" htmlFor="sms-from">Avsendernavn
          <input id="sms-from" type="text" maxLength={15} value={from} onChange={(e) => setFrom(e.target.value.trim())} aria-invalid={!fromOk} />
          <small className="hint">Opptil 11 bokstaver/tall, uten æøå. Vises som avsender på telefonen.</small>
        </label>
        <label className="field" htmlFor="sms-price">Pris per SMS-del (kr, for anslag)
          <input id="sms-price" type="text" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <div className="field"><button className="btn primary" disabled={busy}>Lagre</button></div>
      </form>

      <div className="smsset" style={{ marginTop: 18 }}>
        <label className="field" htmlFor="sms-test">Send test-SMS til
          <input id="sms-test" type="text" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="912 34 567" />
        </label>
        <div className="field"><button type="button" className="btn" disabled={test?.status === 'venter'} onClick={() => void sendTest()}>{test?.status === 'venter' ? 'Sender …' : 'Send test'}</button></div>
        {test && test.status !== 'venter' && (
          <p className="full" style={{ margin: 0, color: test.status === 'sendt' ? 'var(--ok)' : 'var(--danger)' }}>
            {test.status === 'sendt' ? 'Test-SMS er sendt. Sjekk telefonen.' : `Test-SMS feilet: ${test.error ?? 'ukjent feil'}`}
          </p>
        )}
      </div>
    </section>
  );
}
