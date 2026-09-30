import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useMe } from '../lib/session';
import { useToast } from '../lib/ui';
import { dShort } from '../lib/format';
import { ROLE_LABEL, type AppRole, type Area } from '../lib/types';
import { Icon } from '../components/Icon';
import { PushSetup } from '../components/PushSetup';
import { ArchiveTab } from '../components/ArchiveTab';
import { SmsTab } from '../components/SmsTab';
import { TransferPanel } from '../components/TransferPanel';
import { InviteCard } from '../components/InviteCard';

/* ---------- Typer ---------- */
interface AdminCabin {
  id: string; area: Area; number: number; label: string; address: string | null;
  gnr: number | null; bnr: number | null; fnr: number | null;
  vel_member: boolean; va_member: boolean; vei_member: boolean; access: 'full' | 'veilag'; tomt: Tomt | null;
}
type Tomt = 'feste' | 'selveier';
const TOMT_LABEL: Record<Tomt, string> = { feste: 'Festetomt', selveier: 'Selveiertomt' };
type PersonStatus = 'aktiv' | 'venter' | 'mangler_epost';
interface Person {
  id: string; status: PersonStatus; full_name: string; email: string | null; phone: string | null;
  roles: AppRole[]; cabin_ids: string[]; last_seen_at: string | null; created_at: string;
  /** Hytter der personen får SMS-varsler (én per hytte) */
  sms_cabin_ids?: string[];
  /** Byggeprosjekter der personen er prosjektmedarbeider */
  worker_cabin_ids?: string[];
}
interface OwnerDraft { key: string; id?: string; name: string; email: string; phone: string; status?: PersonStatus }

const AREA_LABEL: Record<Area, string> = { morvika: 'Mørvika', torpum: 'Torpum' };
const STATUS_LABEL: Record<PersonStatus, string> = { aktiv: 'Aktivert', venter: 'Ikke logget inn ennå', mangler_epost: 'Mangler e-post' };
const ALL_ROLES: AppRole[] = ['grunneier', 'styre_vel', 'styre_va', 'styre_vei', 'admin'];
const labelFor = (area: Area, n: number | '') => (n === '' ? '' : area === 'torpum' ? `Torpum ${n}` : `SB-${n}`);
/** «SB-4 · Mørvikveien»: nummer og vei, uten husnummer (betegnelsen ser alle hytteeiere) */
const autoLabel = (area: Area, n: number | '', address: string) => {
  const base = labelFor(area, n);
  const street = streetOf(address).trim();
  return base && street ? `${base} · ${street}` : base;
};
const newKey = () => Math.random().toString(36).slice(2);
const toInt = (v: string) => (v.trim() === '' ? null : Number.parseInt(v, 10));
const emailOk = (e: string) => e.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

const isSms = (p: Person, cabinId: string) => (p.sms_cabin_ids ?? []).includes(cabinId);
const isWorker = (p: Person, cabinId: string) => (p.worker_cabin_ids ?? []).includes(cabinId);

function StatusPill({ s }: { s: PersonStatus }) {
  return <span className={`pill st-${s}`}>{STATUS_LABEL[s]}</span>;
}

/* ---------- Hovedside ---------- */
export function AdminPage() {
  const [tab, setTab] = useState<'hytter' | 'personer' | 'medarb' | 'arkiv' | 'sms' | 'oppsett'>('hytter');
  const [archiveCabin, setArchiveCabin] = useState<string | null>(null);
  const [cabins, setCabins] = useState<AdminCabin[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, p, n] = await Promise.all([
      supabase.from('cabins').select('id,area,number,label,address,gnr,bnr,fnr,vel_member,va_member,vei_member,access,tomt').order('area').order('number'),
      supabase.rpc('admin_people'),
      supabase.from('cabin_notes').select('cabin_id,note'),
    ]);
    if (c.error || p.error) { setErr('Registeret kunne ikke hentes. Sjekk at databasen er oppdatert, og prøv igjen.'); return; }
    setErr(null);
    setCabins((c.data ?? []) as AdminCabin[]);
    setPeople((p.data ?? []) as Person[]);
    setNotes(Object.fromEntries((n.data ?? []).map((x) => [x.cabin_id as string, x.note as string])));
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'hytter'} className={tab === 'hytter' ? 'on' : ''} onClick={() => setTab('hytter')}>Hytter og eiere</button>
        <button role="tab" aria-selected={tab === 'personer'} className={tab === 'personer' ? 'on' : ''} onClick={() => setTab('personer')}>Personer og roller</button>
        <button role="tab" aria-selected={tab === 'medarb'} className={tab === 'medarb' ? 'on' : ''} onClick={() => setTab('medarb')}>Prosjektmedarbeidere</button>
        <button role="tab" aria-selected={tab === 'arkiv'} className={tab === 'arkiv' ? 'on' : ''} onClick={() => setTab('arkiv')}>Hyttearkiv</button>
        <button role="tab" aria-selected={tab === 'sms'} className={tab === 'sms' ? 'on' : ''} onClick={() => setTab('sms')}>SMS</button>
        <button role="tab" aria-selected={tab === 'oppsett'} className={tab === 'oppsett' ? 'on' : ''} onClick={() => setTab('oppsett')}>Oppsett</button>
      </div>
      {tab === 'oppsett' && <PushSetup />}
      {tab === 'sms' && <SmsTab />}
      {tab !== 'oppsett' && tab !== 'sms' && err && <div className="empty">{err} <button className="linkbtn2" onClick={() => void load()}>Prøv igjen</button></div>}
      {tab !== 'oppsett' && tab !== 'sms' && !err && cabins === null && <div className="empty">Henter registeret …</div>}
      {!err && cabins !== null && tab === 'hytter' && <CabinsTab cabins={cabins} people={people} notes={notes} reload={load} onArchive={(id) => { setArchiveCabin(id); setTab('arkiv'); }} />}
      {!err && cabins !== null && tab === 'arkiv' && <ArchiveTab cabins={cabins} initialCabin={archiveCabin} onChanged={() => {}}
        owners={Object.fromEntries(cabins.map((c) => [c.id, people.filter((p) => p.cabin_ids.includes(c.id)).map((p) => p.full_name)]))} />}
      {!err && cabins !== null && tab === 'personer' && <PeopleTab cabins={cabins} people={people} reload={load} />}
      {!err && cabins !== null && tab === 'medarb' && <WorkersTab cabins={cabins} people={people} reload={load} />}
    </>
  );
}

/* ---------- Hytter og eiere ---------- */
function CabinsTab({ cabins, people, notes, reload, onArchive }: { cabins: AdminCabin[]; people: Person[]; notes: Record<string, string>; reload: () => Promise<void>; onArchive: (cabinId: string) => void }) {
  const [q, setQ] = useState('');
  const [area, setArea] = useState<Area | 'alle'>('alle');
  const [tomt, setTomt] = useState<Tomt | 'alle'>('alle');
  const [editing, setEditing] = useState<AdminCabin | null>(null);
  const [transfer, setTransfer] = useState<AdminCabin | null>(null);
  const [showQuick, setShowQuick] = useState(true);
  const formRef = useRef<HTMLDivElement>(null);

  // SMS-kontakten først, så de andre
  const ownersOf = useCallback((cabinId: string) => people.filter((p) => p.cabin_ids.includes(cabinId))
    .sort((a, b) => Number(isSms(b, cabinId)) - Number(isSms(a, cabinId))), [people]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return cabins.filter((c) => (area === 'alle' || c.area === area) && (tomt === 'alle' || c.tomt === tomt) && (!s
      || c.label.toLowerCase().includes(s) || String(c.number) === s || (c.address ?? '').toLowerCase().includes(s)
      || ownersOf(c.id).some((o) => o.full_name.toLowerCase().includes(s) || (o.email ?? '').includes(s))));
  }, [cabins, area, tomt, q, ownersOf]);

  const owners = people.filter((p) => p.cabin_ids.length > 0);
  const stats = [
    ['Mørvika', cabins.filter((c) => c.area === 'morvika').length, 'hytter'],
    ['Torpum', cabins.filter((c) => c.area === 'torpum').length, 'hytter'],
    ['Eiere registrert', owners.length, `${owners.filter((o) => o.status === 'aktiv').length} har logget inn`],
    ['Mangler e-post', owners.filter((o) => o.status === 'mangler_epost').length, 'kan ikke logge inn'],
  ] as const;

  function startTransfer(c: AdminCabin) {
    setTransfer(c); setEditing(null);
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }
  function edit(c: AdminCabin) {
    setEditing(c); setShowQuick(true); setTransfer(null);
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  return (
    <>
      <div className="stats">
        {stats.map(([l, v, sub]) => (
          <div key={l} className="card stat"><div className="l">{l}</div><div className="v">{v}</div><div className="muted" style={{ fontSize: 13 }}>{sub}</div></div>
        ))}
      </div>

      <div ref={formRef}>
        {transfer ? (
          <TransferPanel key={transfer.id} cabin={transfer} sellers={ownersOf(transfer.id)} onDone={reload} onClose={() => setTransfer(null)} />
        ) : showQuick ? (
          <CabinForm key={editing?.id ?? 'ny'} cabins={cabins} editing={editing} owners={editing ? ownersOf(editing.id) : []}
            workers={editing ? people.filter((p) => isWorker(p, editing.id)) : []} reload={reload}
            note={editing ? notes[editing.id] ?? '' : ''}
            onSaved={async () => { await reload(); }}
            onClose={() => { setEditing(null); if (editing === null) setShowQuick(false); }} />
        ) : (
          <button className="btn primary" style={{ marginBottom: 20 }} onClick={() => setShowQuick(true)}><Icon name="plus" size={18} />Hurtigregistrering</button>
        )}
      </div>

      <div className="head-row" style={{ marginTop: 8 }}>
        <h2 className="serif h2" style={{ margin: 0 }}>Hytteregister</h2>
        <span className="muted">{shown.length} av {cabins.length} hytter</span>
      </div>
      <div className="filters">
        <input type="search" id="admin-search" placeholder="Søk på hytte, adresse, navn eller e-post" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips" style={{ margin: 0 }}>
          {(['alle', 'morvika', 'torpum'] as const).map((a) => (
            <button key={a} className={`chip ${area === a ? 'on' : ''}`} onClick={() => setArea(a)}>{a === 'alle' ? 'Alle' : AREA_LABEL[a]}</button>
          ))}
        </div>
        <div className="chips" style={{ margin: 0 }}>
          {(['alle', 'feste', 'selveier'] as const).map((t) => (
            <button key={t} className={`chip ${tomt === t ? 'on' : ''}`} onClick={() => setTomt(t)}>{t === 'alle' ? 'Alle tomter' : TOMT_LABEL[t]}</button>
          ))}
        </div>
      </div>
      {cabins.length === 0 ? (
        <div className="empty">Ingen hytter registrert ennå. Bruk hurtigregistreringen over.</div>
      ) : (
        <div className="card ledgerbox">
          <div className="tbl-wrap scrollbox">
            <table>
              <thead><tr><th>Hytte</th><th>Eiendom</th><th>Hytteadresse</th><th>Tomt</th><th>Gnr/Bnr/Fnr</th><th>Eiere</th><th>Vel</th><th>VA</th><th /></tr></thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.label}</b>{notes[c.id] && <div className="muted" style={{ fontSize: 12 }} title={notes[c.id]}>Merknad</div>}</td>
                    <td>{AREA_LABEL[c.area]}{c.access === 'veilag' && <div className="muted" style={{ fontSize: 12 }}>Bare Veilaget</div>}</td>
                    <td>{c.address || <span className="muted">–</span>}</td>
                    <td>{c.tomt ? TOMT_LABEL[c.tomt] : <span className="muted">–</span>}</td>
                    <td className="num">{[c.gnr, c.bnr, c.fnr].map((x) => x ?? '–').join(' / ')}</td>
                    <td>
                      {ownersOf(c.id).length === 0 ? <span className="muted">Ingen eier</span> : (
                        <div className="ownerlist">
                          {ownersOf(c.id).map((o) => <div key={o.id}>{o.full_name} <StatusPill s={o.status} />{isSms(o, c.id) && <span className="pill smspill" title={o.phone ? `SMS-varsler går til ${o.phone}` : 'Får SMS, men mangler mobilnummer'}>SMS{o.phone ? '' : ' · mangler mobil'}</span>}</div>)}
                        </div>
                      )}
                      {people.some((p) => isWorker(p, c.id)) && (
                        <div className="muted workerline" title="Prosjektmedarbeidere ser bare dokumenter og bilder i Min hytte">
                          Prosjekt: {people.filter((p) => isWorker(p, c.id)).map((p) => p.full_name).join(', ')}
                        </div>
                      )}
                    </td>
                    <td>{c.vel_member ? 'Ja' : '–'}</td>
                    <td>{c.va_member ? 'Ja' : '–'}</td>
                    <td><span className="rowacts col"><button className="btn small" onClick={() => edit(c)}>Rediger</button><button className="btn small ghost" onClick={() => startTransfer(c)}>Eierskifte</button><button className="btn small ghost" onClick={() => onArchive(c.id)}>Arkiv</button></span></td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={9} className="muted">Ingen treff.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Skjema for ny hytte og redigering ---------- */
// Husker veinavn og gnr per eiendom, så neste hytte bare trenger husnummer og bnr
const memo = {
  get(key: string): string { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } },
  set(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* privat modus */ } },
};
/** «Mørvikveien 209 B» → «Mørvikveien » (veinavnet med mellomrom, klar for nytt nummer) */
function streetOf(address: string): string {
  const m = address.trim().match(/^(.*?\D)\s*\d+\s*[A-Za-zÆØÅæøå]?$/);
  const street = (m ? m[1] : address).trim();
  return street ? `${street} ` : '';
}
const defaultGnr = (a: Area) => memo.get(`admin-gnr-${a}`) || (a === 'morvika' ? '23' : '');
const defaultStreet = (a: Area) => memo.get(`admin-street-${a}`);
const defaultTomt = (a: Area): Tomt | null => (a === 'torpum' ? null : (memo.get('admin-tomt') as Tomt) || 'feste');

function CabinForm({ cabins, editing, owners, workers, reload, note: initialNote, onSaved, onClose }: {
  cabins: AdminCabin[]; editing: AdminCabin | null; owners: Person[]; workers: Person[]; reload: () => Promise<void>; note: string;
  onSaved: () => Promise<void>; onClose: () => void;
}) {
  const toast = useToast();
  const nextNumber = (a: Area, from = 0) => {
    const used = new Set(cabins.filter((c) => c.area === a).map((c) => c.number));
    let n = Math.max(from, 1);
    while (used.has(n)) n++;
    return n;
  };
  const startArea: Area = editing?.area ?? ((() => { try { return (localStorage.getItem('admin-area') as Area) || 'morvika'; } catch { return 'morvika'; } })());

  const [area, setArea] = useState<Area>(startArea);
  const [number, setNumber] = useState<string>(editing ? String(editing.number) : String(nextNumber(startArea)));
  const [label, setLabel] = useState(editing?.label ?? '');
  // Betegnelsen følger nummer og adresse til du skriver en egen
  const [labelTouched, setLabelTouched] = useState(Boolean(editing) && editing!.label !== labelFor(editing!.area, editing!.number)
    && editing!.label !== autoLabel(editing!.area, editing!.number, editing!.address ?? ''));
  const [address, setAddress] = useState(editing ? (editing.address ?? '') : defaultStreet(startArea));
  const [gnr, setGnr] = useState(editing ? (editing.gnr != null ? String(editing.gnr) : '') : defaultGnr(startArea));
  const [bnr, setBnr] = useState(editing?.bnr != null ? String(editing.bnr) : '');
  const [fnr, setFnr] = useState(editing?.fnr != null ? String(editing.fnr) : '');
  const [vel, setVel] = useState(editing ? editing.vel_member : startArea === 'morvika');
  const [va, setVa] = useState(editing ? editing.va_member : startArea === 'morvika');
  const [tomt, setTomt] = useState<Tomt | null>(editing ? editing.tomt : defaultTomt(startArea));
  const [note, setNote] = useState(initialNote);
  const [ownerRows, setOwnerRows] = useState<OwnerDraft[]>(() => editing && owners.length
    ? owners.map((o) => ({ key: o.id, id: o.id, name: o.full_name, email: o.email ?? '', phone: o.phone ?? '', status: o.status }))
    : [{ key: newKey(), name: '', email: '', phone: '' }]);
  const [removed, setRemoved] = useState<string[]>([]);
  const initialSms = editing ? owners.find((o) => isSms(o, editing.id))?.id ?? null : null;
  const [smsId, setSmsId] = useState<string | null>(initialSms);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const numberRef = useRef<HTMLInputElement>(null);

  const shownLabel = labelTouched ? label : autoLabel(area, number === '' ? '' : Number(number), address);
  const duplicate = !editing && number !== '' && cabins.some((c) => c.area === area && c.number === Number(number));

  function pickArea(a: Area) {
    setArea(a);
    try { localStorage.setItem('admin-area', a); } catch { /* privat modus */ }
    if (!editing) {
      setNumber(String(nextNumber(a)));
      setVel(a === 'morvika');
      setVa(a === 'morvika');
      setAddress(defaultStreet(a)); setGnr(defaultGnr(a)); setTomt(defaultTomt(a));
    }
  }
  const setOwner = (k: string, patch: Partial<OwnerDraft>) => setOwnerRows((rows) => rows.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  function removeOwner(r: OwnerDraft) {
    if (r.id) setRemoved((x) => [...x, r.id!]);
    setOwnerRows((rows) => { const left = rows.filter((x) => x.key !== r.key); return left.length ? left : [{ key: newKey(), name: '', email: '', phone: '' }]; });
  }

  async function save(e: FormEvent, andNext: boolean) {
    e.preventDefault();
    setError(null);
    const n = Number.parseInt(number, 10);
    if (!Number.isFinite(n) || n <= 0) { setError('Skriv inn et gyldig hyttenummer.'); return; }
    if (duplicate) { setError(`${labelFor(area, n)} finnes allerede i ${AREA_LABEL[area]}.`); return; }
    const bad = ownerRows.find((o) => !emailOk(o.email));
    if (bad) { setError(`E-postadressen «${bad.email}» ser ikke riktig ut.`); return; }
    const nameless = ownerRows.find((o) => !o.name.trim() && (o.email.trim() || o.phone.trim()));
    if (nameless) { setError('En eier mangler navn.'); return; }

    setBusy(true);
    const row = {
      area, number: n, label: shownLabel.trim() || autoLabel(area, n, address), address: address.trim() || null,
      gnr: toInt(gnr), bnr: toInt(bnr), fnr: tomt === 'selveier' ? null : toInt(fnr),
      tomt: area === 'torpum' ? null : tomt,
      vel_member: area === 'torpum' ? false : vel, va_member: area === 'torpum' ? false : va, vei_member: true,
      access: area === 'torpum' ? 'veilag' : 'full',
    };
    let cabinId = editing?.id;
    if (editing) {
      const { error: e1 } = await supabase.from('cabins').update(row).eq('id', editing.id);
      if (e1) { setBusy(false); setError(e1.code === '23505' ? `${row.label} finnes allerede.` : 'Hytta ble ikke lagret. Prøv igjen.'); return; }
    } else {
      const { data, error: e1 } = await supabase.from('cabins').insert(row).select('id').single();
      if (e1 || !data) { setBusy(false); setError(e1?.code === '23505' ? `${row.label} finnes allerede i ${AREA_LABEL[area]}.` : 'Hytta ble ikke lagret. Prøv igjen.'); return; }
      cabinId = data.id as string;
    }

    const problems: string[] = [];
    if (note.trim() || initialNote) {
      const { error: e2 } = await supabase.from('cabin_notes').upsert({ cabin_id: cabinId, note: note.trim(), updated_at: new Date().toISOString() });
      if (e2) problems.push('merknaden');
    }
    for (const id of removed) {
      const { error: e3 } = await supabase.rpc('admin_remove_owner', { p_cabin: cabinId, p_person: id });
      if (e3) problems.push('fjerning av eier');
    }
    for (const o of ownerRows) {
      if (!o.name.trim()) continue;
      if (o.id) {
        const orig = owners.find((x) => x.id === o.id);
        if (orig && (orig.full_name !== o.name.trim() || (orig.email ?? '') !== o.email.trim().toLowerCase() || (orig.phone ?? '') !== o.phone.trim())) {
          const { error: e4 } = await supabase.rpc('admin_update_person', { p_person: o.id, p_name: o.name, p_email: o.email, p_phone: o.phone });
          if (e4) problems.push(o.name);
        }
      } else {
        const { error: e5 } = await supabase.rpc('admin_add_owner', { p_cabin: cabinId, p_name: o.name, p_email: o.email, p_phone: o.phone });
        if (e5) problems.push(o.name);
      }
    }
    if (editing && smsId && smsId !== initialSms && !removed.includes(smsId)) {
      const { error: e6 } = await supabase.rpc('admin_set_sms_contact', { p_cabin: cabinId, p_person: smsId });
      if (e6) problems.push('valg av SMS-mottaker');
    }
    setBusy(false);
    if (!editing) {
      const street = streetOf(address);
      if (street) memo.set(`admin-street-${area}`, street);
      if (gnr.trim()) memo.set(`admin-gnr-${area}`, gnr.trim());
      if (area === 'morvika' && tomt) memo.set('admin-tomt', tomt);
    }
    await onSaved();

    if (problems.length) toast(`${row.label} er lagret, men dette gikk ikke: ${problems.join(', ')}.`);
    else toast(`${row.label} er ${editing ? 'oppdatert' : 'registrert'}.`);

    if (editing) { onClose(); return; }
    if (andNext) {
      setNumber(String(nextNumber(area, n + 1)));
      setLabel(''); setLabelTouched(false); setAddress(streetOf(address)); setBnr(''); setFnr(''); setNote('');
      setOwnerRows([{ key: newKey(), name: '', email: '', phone: '' }]); setRemoved([]);
      numberRef.current?.focus();
    } else onClose();
  }

  return (
    <form className="card quick" onSubmit={(e) => void save(e, true)}>
      <div className="quick-h">
        <h2 className="serif">{editing ? `Rediger ${editing.label}` : 'Hurtigregistrering'}</h2>
        <button type="button" className="btn small ghost" onClick={onClose}>{editing ? 'Avbryt' : 'Skjul'}</button>
      </div>

      <div className="seg" role="radiogroup" aria-label="Eiendom">
        {(['morvika', 'torpum'] as Area[]).map((a) => (
          <button type="button" key={a} role="radio" aria-checked={area === a} className={area === a ? 'on' : ''} onClick={() => pickArea(a)}>
            {AREA_LABEL[a]}<small>{a === 'morvika' ? 'Full tilgang' : 'Bare Veilaget'}</small>
          </button>
        ))}
      </div>

      <fieldset className="qgrid">
        <legend>Hytta</legend>
        <label className="field" htmlFor="q-number">Hyttenummer
          <input id="q-number" ref={numberRef} type="number" min={1} inputMode="numeric" required value={number} onChange={(e) => setNumber(e.target.value)} />
        </label>
        <label className="field" htmlFor="q-label">Betegnelse
          <input id="q-label" type="text" value={shownLabel} onChange={(e) => { setLabel(e.target.value); setLabelTouched(e.target.value !== ''); }} />
        </label>
        <label className="field span2" htmlFor="q-address">Hytteadresse
          <input id="q-address" type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="F.eks. Mørvikveien 209"
            onFocus={(e) => { const el = e.currentTarget; const end = el.value.length; requestAnimationFrame(() => el.setSelectionRange(end, end)); }} />
          <small className="hint">Veinavnet blir stående til neste hytte. Skriv bare nummeret, eller bytt veinavn når du kommer til en ny vei.</small>
        </label>
        <label className="field" htmlFor="q-gnr">Gnr<input id="q-gnr" type="number" min={1} inputMode="numeric" value={gnr} onChange={(e) => setGnr(e.target.value)} /></label>
        <label className="field" htmlFor="q-bnr">Bnr<input id="q-bnr" type="number" min={1} inputMode="numeric" value={bnr} onChange={(e) => setBnr(e.target.value)} /></label>
        <label className="field" htmlFor="q-fnr">Fnr<input id="q-fnr" type="number" min={1} inputMode="numeric" disabled={tomt === 'selveier'}
          value={tomt === 'selveier' ? '' : fnr} onChange={(e) => setFnr(e.target.value)} placeholder={tomt === 'selveier' ? 'Ikke festet' : ''} /></label>
        {area === 'morvika' && (
          <div className="field span2">Tomt
            <div className="seg small" role="radiogroup" aria-label="Tomt">
              {(['feste', 'selveier'] as Tomt[]).map((t) => (
                <button type="button" key={t} role="radio" aria-checked={tomt === t} className={tomt === t ? 'on' : ''} onClick={() => setTomt(t)}>{TOMT_LABEL[t]}</button>
              ))}
            </div>
          </div>
        )}
        <div className="field">Medlemskap
          <div className="checks">
            <label className="check"><input type="checkbox" checked={area === 'torpum' ? false : vel} disabled={area === 'torpum'} onChange={(e) => setVel(e.target.checked)} /> Mørvika Vel</label>
            <label className="check"><input type="checkbox" checked={area === 'torpum' ? false : va} disabled={area === 'torpum'} onChange={(e) => setVa(e.target.checked)} /> Vann og avløp</label>
            <label className="check"><input type="checkbox" checked disabled /> Veilaget (obligatorisk)</label>
          </div>
        </div>
      </fieldset>
      {duplicate && <p className="err">{labelFor(area, Number(number))} finnes allerede i {AREA_LABEL[area]}. Velg «Rediger» i listen for å endre den.</p>}

      <fieldset>
        <legend>Eier{ownerRows.length > 1 ? 'e' : ''}</legend>
        <div className="owners">
          {ownerRows.map((o, i) => (
            <div key={o.key} className="ownerrow">
              <label className="field" htmlFor={`q-name-${o.key}`}>Fullt navn
                <input id={`q-name-${o.key}`} type="text" autoComplete="off" value={o.name} onChange={(e) => setOwner(o.key, { name: e.target.value })} required={i === 0 && !editing} />
              </label>
              <label className="field" htmlFor={`q-email-${o.key}`}>E-post (brukes til innlogging)
                <input id={`q-email-${o.key}`} type="email" autoComplete="off" value={o.email} disabled={o.status === 'aktiv'}
                  onChange={(e) => setOwner(o.key, { email: e.target.value })} aria-invalid={!emailOk(o.email)} />
              </label>
              <label className="field" htmlFor={`q-phone-${o.key}`}>Mobil
                <input id={`q-phone-${o.key}`} type="text" inputMode="tel" autoComplete="off" value={o.phone} onChange={(e) => setOwner(o.key, { phone: e.target.value })} />
              </label>
              <div className="ownerrow-end">
                {o.status && <StatusPill s={o.status} />}
                {editing && o.id && (
                  <label className="check smspick" title="Bare én eier per hytte får SMS-varsler">
                    <input type="radio" name="sms-contact" checked={smsId === o.id} onChange={() => setSmsId(o.id!)} /> Får SMS
                  </label>
                )}
                {(ownerRows.length > 1 || o.id) && <button type="button" className="linkbtn" onClick={() => removeOwner(o)}>Fjern</button>}
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="btn small" onClick={() => setOwnerRows((r) => [...r, { key: newKey(), name: '', email: '', phone: '' }])}>
          <Icon name="plus" size={16} />Legg til medeier
        </button>
        <p className="muted" style={{ margin: '10px 0 0', fontSize: 13 }}>
          {editing ? 'SMS-varsler går bare til eieren som er merket «Får SMS». Nye medeiere kan velges etter at de er lagret.'
            : 'Den første eieren får SMS-varsler for hytta. Det kan endres senere under «Rediger».'}
        </p>
        {!ownerRows.every((o) => o.email.trim() || !o.name.trim()) && (
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 13 }}>Eiere uten e-post blir registrert, men kan ikke logge inn før e-post er lagt inn.</p>
        )}
      </fieldset>

      {editing && editing.access === 'full' && area === 'morvika' && <WorkersSection cabin={editing} workers={workers} reload={reload} />}

      <label className="field" htmlFor="q-note">Intern merknad (bare administrator ser den)
        <textarea id="q-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="F.eks. faktura sendes til annen adresse, dødsbo, kontaktperson …" style={{ minHeight: 60 }} />
      </label>

      {error && <p className="err" role="alert">{error}</p>}
      {editing && <DeleteCabin cabin={editing} onDeleted={async () => { onClose(); await onSaved(); }} />}
      <div className="actions">
        {editing ? (
          <button className="btn primary" disabled={busy}>{busy ? 'Lagrer …' : 'Lagre endringer'}</button>
        ) : (
          <>
            <button type="button" className="btn" disabled={busy} onClick={(e) => void save(e as unknown as FormEvent, false)}>Lagre</button>
            <button className="btn primary" disabled={busy}>{busy ? 'Lagrer …' : 'Lagre og registrer neste'}</button>
          </>
        )}
      </div>
    </form>
  );
}

/* ---------- Slette en hytte (registrert ved en feil, eller skal ikke brukes) ---------- */
interface Content { owners: number; workers: number; documents: number; photos: number; ledger: number; archive: number; transfers: number }
function DeleteCabin({ cabin, onDeleted }: { cabin: AdminCabin; onDeleted: () => Promise<void> }) {
  const toast = useToast();
  const [content, setContent] = useState<Content | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_cabin_content', { p_cabin: cabin.id });
    const row = (Array.isArray(data) ? data[0] : data) as Content | undefined;
    setBusy(false);
    if (error || !row) { toast(error?.message.includes('function') ? 'Databasen må oppdateres først (slett hytte).' : 'Kunne ikke sjekke hytta. Prøv igjen.'); return; }
    setContent(row);
  }
  async function remove() {
    setBusy(true);
    const { error } = await supabase.rpc('admin_delete_cabin', { p_cabin: cabin.id });
    setBusy(false);
    if (error) { toast(error.message.includes('Fjern') ? 'Fjern eiere og prosjektmedarbeidere først.' : 'Hytta ble ikke slettet. Prøv igjen.'); return; }
    toast(`${cabin.label} er slettet.`);
    await onDeleted();
  }

  if (!content) return (
    <div className="delcabin"><button type="button" className="linkbtn" disabled={busy} onClick={() => void start()}>Slett hytta …</button></div>
  );
  const blocked = content.owners + content.workers > 0;
  const parts = [
    [content.documents, 'dokument', 'dokumenter'], [content.photos, 'bilde', 'bilder'], [content.ledger, 'regnskapspost', 'regnskapsposter'],
    [content.archive, 'arkivdokument', 'arkivdokumenter'], [content.transfers, 'eierskifte', 'eierskifter'],
  ].filter(([n]) => (n as number) > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  return (
    <div className="delcabin card">
      {blocked ? (
        <p style={{ margin: 0 }}><b>{cabin.label} har {content.owners ? `${content.owners} ${content.owners === 1 ? 'eier' : 'eiere'}` : ''}{content.owners && content.workers ? ' og ' : ''}{content.workers ? `${content.workers} ${content.workers === 1 ? 'prosjektmedarbeider' : 'prosjektmedarbeidere'}` : ''}.</b> Fjern dem først: eiere med «Fjern» og «Lagre endringer», prosjektmedarbeidere med «Fjern» i listen over. Deretter kan hytta slettes.</p>
      ) : (
        <p style={{ margin: 0 }}><b>Slette {cabin.label} for godt?</b> {parts.length ? `Dette sletter også ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} og ${parts[parts.length - 1]}` : parts[0]}.` : 'Hytta har ikke noe innhold.'} Det kan ikke angres.</p>
      )}
      <div className="actions">
        <button type="button" className="btn small ghost" onClick={() => setContent(null)}>Avbryt</button>
        {!blocked && <button type="button" className="btn small danger-fill" disabled={busy} onClick={() => void remove()}>{busy ? 'Sletter …' : 'Ja, slett hytta'}</button>}
      </div>
    </div>
  );
}

/* ---------- Prosjektmedarbeidere: én person, flere prosjekter ---------- */
/** Byggeprosjektene er hyttene som eies av prosjekt-e-posten (Administrasjon → Prosjektmedarbeidere) */
const PROJECT_OWNER_DEFAULT = 'roger@morvika.no';
const splitEmails = (v: string) => v.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);

function WorkersTab({ cabins, people, reload }: { cabins: AdminCabin[]; people: Person[]; reload: () => Promise<void> }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [projectEmail, setProjectEmail] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState<string | null>(null);

  useEffect(() => {
    void supabase.from('app_settings').select('value').eq('key', 'project_owner_email').maybeSingle()
      .then(({ data }) => setProjectEmail((data as { value?: string } | null)?.value || PROJECT_OWNER_DEFAULT));
  }, []);
  async function saveEmail() {
    const list = splitEmails(editEmail ?? '');
    if (!list.length || list.some((e) => !emailOk(e))) { toast('Skriv inn en gyldig e-postadresse.'); return; }
    const { error } = await supabase.from('app_settings').upsert({ key: 'project_owner_email', value: list.join(', '), updated_at: new Date().toISOString() });
    if (error) { toast('Prosjekt-e-posten ble ikke lagret.'); return; }
    setProjectEmail(list.join(', ')); setEditEmail(null);
    toast('Prosjekt-e-posten er lagret.');
  }

  const ownerEmails = splitEmails(projectEmail ?? '');
  const owners = people.filter((p) => ownerEmails.includes((p.email ?? '').toLowerCase()));
  const missing = ownerEmails.filter((e) => !owners.some((o) => (o.email ?? '').toLowerCase() === e));
  const workers = people.filter((p) => (p.worker_cabin_ids ?? []).length > 0).sort((a, b) => a.full_name.localeCompare(b.full_name, 'nb'));
  // Hyttene til prosjekt-e-posten, og hytter som allerede har medarbeidere
  const projectIds = new Set([...owners.flatMap((o) => o.cabin_ids), ...workers.flatMap((w) => w.worker_cabin_ids ?? [])]);
  const projects = cabins.filter((c) => projectIds.has(c.id) && c.access === 'full').sort((a, b) => a.label.localeCompare(b.label, 'nb', { numeric: true }));
  const shown = workers.filter((w) => !q.trim() || `${w.full_name} ${w.email ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));

  async function toggle(w: Person, c: AdminCabin) {
    const on = (w.worker_cabin_ids ?? []).includes(c.id);
    if (on && (w.worker_cabin_ids ?? []).length === 1) { setConfirmAll(w.id); return; }
    setBusy(`${w.id}:${c.id}`);
    const { error } = on
      ? await supabase.rpc('admin_remove_worker', { p_cabin: c.id, p_person: w.id })
      : await supabase.rpc('admin_add_worker', { p_cabin: c.id, p_name: w.full_name, p_email: w.email, p_phone: w.phone });
    setBusy(null);
    if (error) { toast(error.message.includes('function') ? 'Databasen må oppdateres først (prosjektmedarbeider).' : 'Endringen ble ikke lagret. Prøv igjen.'); return; }
    toast(`${w.full_name}: ${c.label} ${on ? 'fjernet' : 'lagt til'}.`);
    await reload();
  }
  async function removeAll(w: Person) {
    setConfirmAll(null); setBusy(w.id);
    for (const id of w.worker_cabin_ids ?? []) await supabase.rpc('admin_remove_worker', { p_cabin: id, p_person: w.id });
    setBusy(null);
    toast(`${w.full_name} har ikke lenger tilgang til noen prosjekter.`);
    await reload();
  }

  return (
    <>
      <div className="head-row">
        <p className="lede">Håndverkere på byggeprosjektene dine. De ser bare dokumenter og bilder i Min hytte for prosjektene som er krysset av,
          kan laste opp, og kan bare endre det de selv har lastet opp. Tilgangen forsvinner også ved eierskifte.</p>
        <button className="btn primary" onClick={() => setAdding((v) => !v)}><Icon name="plus" size={18} />Ny prosjektmedarbeider</button>
      </div>
      <div className="card projmail">
        {editEmail === null ? (
          <>
            <span><b>Prosjekt-e-post:</b> {projectEmail ?? '…'}
              <small className="muted">Hyttene som er registrert med denne e-posten som eier, er byggeprosjektene i listen under.</small>
              {projectEmail && missing.length > 0 && <small className="err">{missing.join(', ')} er ikke registrert som eier av noen hytte ennå.</small>}
            </span>
            <button className="btn small ghost" disabled={projectEmail === null} onClick={() => setEditEmail(projectEmail ?? '')}>Endre</button>
          </>
        ) : (
          <form className="projmail-f" onSubmit={(e) => { e.preventDefault(); void saveEmail(); }}>
            <label className="field" htmlFor="pm-email">Prosjekt-e-post (flere skilles med komma)
              <input id="pm-email" type="text" inputMode="email" autoFocus value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
            </label>
            <div className="actions"><button type="button" className="btn small ghost" onClick={() => setEditEmail(null)}>Avbryt</button><button className="btn small primary">Lagre</button></div>
          </form>
        )}
      </div>
      {projectEmail !== null && !projects.length && (
        <div className="empty">Ingen prosjekter ennå. Registrer {ownerEmails.join(' eller ')} som eier av prosjekthyttene under «Hytter og eiere».</div>
      )}
      {adding && projects.length > 0 && <NewWorkerForm projects={projects} onDone={async () => { setAdding(false); await reload(); }} onCancel={() => setAdding(false)} />}
      {workers.length > 3 && (
        <div className="filters"><input type="search" placeholder="Søk på navn eller e-post" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      )}
      {workers.length === 0 && projects.length > 0 && !adding && <div className="empty">Ingen prosjektmedarbeidere registrert ennå.</div>}
      <div className="wcards">
        {shown.map((w) => (
          <section key={w.id} className="card wcard">
            <div className="wcard-h">
              <div><b>{w.full_name}</b><div className="muted">{w.email}{w.phone ? ` · ${w.phone}` : ''}</div></div>
              <StatusPill s={w.status} />
            </div>
            <div className="wcard-l">Tilgang til prosjekter</div>
            <div className="rolechips">
              {projects.map((c) => {
                const on = (w.worker_cabin_ids ?? []).includes(c.id);
                return (
                  <button key={c.id} className={`rolebtn big ${on ? 'on' : ''}`} aria-pressed={on} disabled={busy !== null} onClick={() => void toggle(w, c)}>
                    {on ? '✓ ' : ''}{c.label}
                  </button>
                );
              })}
            </div>
            <div className="wcard-f">
              {confirmAll === w.id
                ? <span className="confirm">Fjerne all prosjekttilgang for {w.full_name}?<button className="btn small danger-btn" onClick={() => void removeAll(w)}>Fjern</button><button className="btn small ghost" onClick={() => setConfirmAll(null)}>Avbryt</button></span>
                : <button className="linkbtn" disabled={busy !== null} onClick={() => setConfirmAll(w.id)}>Fjern all tilgang</button>}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function NewWorkerForm({ projects, onDone, onCancel }: { projects: AdminCabin[]; onDone: () => Promise<void>; onCancel: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [picked, setPicked] = useState<string[]>(projects.length === 1 ? [projects[0].id] : []);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!emailOk(email) || !email.trim()) { toast('Skriv inn en gyldig e-postadresse. Den brukes til innlogging.'); return; }
    if (!picked.length) { toast('Kryss av for minst ett prosjekt.'); return; }
    setBusy(true);
    let status = ''; let failed = 0;
    for (const id of picked) {
      const { data, error } = await supabase.rpc('admin_add_worker', { p_cabin: id, p_name: name, p_email: email, p_phone: phone });
      if (error) failed++; else status = String(data);
    }
    setBusy(false);
    if (failed === picked.length) { toast('Medarbeideren ble ikke lagt til. Er databasen oppdatert?'); return; }
    toast(status === 'koblet'
      ? `${name.trim()} har nå tilgang til ${picked.length - failed} ${picked.length - failed === 1 ? 'prosjekt' : 'prosjekter'}.`
      : `${name.trim()} er lagt til. Hen logger inn på app.morvika.no med ${email.trim().toLowerCase()}.`);
    await onDone();
  }

  return (
    <form className="card form" onSubmit={submit}>
      <label className="field" htmlFor="nw-name">Fullt navn<input id="nw-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="F.eks. Sven Snekker (Snekker AS)" /></label>
      <label className="field" htmlFor="nw-email">E-post (brukes til innlogging)<input id="nw-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="field" htmlFor="nw-phone">Mobil<input id="nw-phone" type="text" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
      <div className="field full">Tilgang til prosjekter
        <div className="checks">
          {projects.map((c) => (
            <label key={c.id} className="check"><input type="checkbox" checked={picked.includes(c.id)}
              onChange={(e) => setPicked((x) => (e.target.checked ? [...x, c.id] : x.filter((y) => y !== c.id)))} /> {c.label}</label>
          ))}
        </div>
      </div>
      <div className="actions full">
        <button type="button" className="btn ghost" onClick={onCancel}>Avbryt</button>
        <button className="btn primary" disabled={busy || !name.trim()}>{busy ? 'Lagrer …' : 'Legg til'}</button>
      </div>
    </form>
  );
}

/* ---------- Prosjektmedarbeidere (håndverkere på byggeprosjekt) ---------- */
function WorkersSection({ cabin, workers, reload }: { cabin: AdminCabin; workers: Person[]; reload: () => Promise<void> }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  async function add() {
    if (!name.trim() || !email.trim()) { toast('Skriv inn navn og e-post.'); return; }
    if (!emailOk(email)) { toast('E-postadressen ser ikke riktig ut.'); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_add_worker', { p_cabin: cabin.id, p_name: name, p_email: email, p_phone: phone });
    setBusy(false);
    if (error) { toast(error.message.includes('function') ? 'Databasen må oppdateres først (prosjektmedarbeider).' : 'Medarbeideren ble ikke lagt til. Prøv igjen.'); return; }
    toast(data === 'koblet'
      ? `${name.trim()} har nå tilgang til ${cabin.label}.`
      : `${name.trim()} er lagt til. Hen logger inn på app.morvika.no med ${email.trim().toLowerCase()}.`);
    setName(''); setEmail(''); setPhone(''); setAdding(false);
    await reload();
  }
  async function remove(p: Person) {
    setConfirm(null);
    const { error } = await supabase.rpc('admin_remove_worker', { p_cabin: cabin.id, p_person: p.id });
    if (error) { toast('Medarbeideren ble ikke fjernet. Prøv igjen.'); return; }
    toast(`${p.full_name} har ikke lenger tilgang til ${cabin.label}.`);
    await reload();
  }

  return (
    <fieldset className="workers">
      <legend>Prosjektmedarbeidere</legend>
      <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
        Håndverkere på byggeprosjektet. De ser bare dokumenter og bilder i Min hytte for denne hytta, kan laste opp,
        og kan bare endre det de selv har lastet opp. Tilgangen forsvinner ved eierskifte, eller når du fjerner dem.
      </p>
      {workers.length > 0 && (
        <div className="workerlist">
          {workers.map((p) => (
            <div key={p.id} className="workerrow">
              <span><b>{p.full_name}</b> <span className="muted">{p.email}{p.phone ? ` · ${p.phone}` : ''}</span></span>
              <StatusPill s={p.status} />
              {confirm === p.id
                ? <span className="confirm">Fjerne tilgangen?<button type="button" className="btn small danger-btn" onClick={() => void remove(p)}>Fjern</button><button type="button" className="btn small ghost" onClick={() => setConfirm(null)}>Avbryt</button></span>
                : <button type="button" className="linkbtn" onClick={() => setConfirm(p.id)}>Fjern</button>}
            </div>
          ))}
        </div>
      )}
      {adding ? (
        <div className="ownerrow">
          <label className="field" htmlFor="w-name">Fullt navn<input id="w-name" type="text" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} placeholder="F.eks. Sven Snekker" /></label>
          <label className="field" htmlFor="w-email">E-post (brukes til innlogging)<input id="w-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!emailOk(email)} /></label>
          <label className="field" htmlFor="w-phone">Mobil<input id="w-phone" type="text" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
          <div className="ownerrow-end">
            <button type="button" className="btn small primary" disabled={busy} onClick={() => void add()}>{busy ? 'Legger til …' : 'Legg til'}</button>
            <button type="button" className="btn small ghost" onClick={() => setAdding(false)}>Avbryt</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn small" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Legg til prosjektmedarbeider</button>
      )}
    </fieldset>
  );
}

/* ---------- Personer og roller ---------- */
function PeopleTab({ cabins, people, reload }: { cabins: AdminCabin[]; people: Person[]; reload: () => Promise<void> }) {
  const me = useMe();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<PersonStatus | 'alle'>('alle');
  const [adding, setAdding] = useState(false);
  const cabinLabel = useMemo(() => Object.fromEntries(cabins.map((c) => [c.id, c.label])), [cabins]);

  const shown = people
    .filter((p) => (status === 'alle' || p.status === status) && (!q.trim()
      || p.full_name.toLowerCase().includes(q.trim().toLowerCase()) || (p.email ?? '').includes(q.trim().toLowerCase())
      || p.cabin_ids.some((id) => (cabinLabel[id] ?? '').toLowerCase().includes(q.trim().toLowerCase()))))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'nb'));

  async function toggleRole(p: Person, r: AppRole) {
    const next = p.roles.includes(r) ? p.roles.filter((x) => x !== r) : [...p.roles, r];
    const { error } = await supabase.rpc('admin_set_roles', { p_person: p.id, p_roles: next });
    if (error) { toast(error.message.includes('egen') ? 'Du kan ikke fjerne din egen administratorrolle.' : 'Rollen ble ikke endret. Prøv igjen.'); return; }
    toast(`${p.full_name}: ${ROLE_LABEL[r]} ${next.includes(r) ? 'lagt til' : 'fjernet'}.`);
    await reload();
    if (p.id === me.session?.user.id) void me.reload();
  }

  return (
    <>
      <div className="head-row">
        <p className="lede">Alle som er registrert. Personer som ikke har logget inn ennå, kobles til hytta si første gang de logger inn med e-posten sin.</p>
        <button className="btn primary" onClick={() => setAdding((v) => !v)}><Icon name="plus" size={18} />Legg til person uten hytte</button>
      </div>
      {adding && <AddPersonForm onDone={async () => { setAdding(false); await reload(); }} onCancel={() => setAdding(false)} />}
      <InviteCard people={people} cabins={cabins} />
      <div className="filters">
        <input type="search" id="people-search" placeholder="Søk på navn, e-post eller hytte" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips" style={{ margin: 0 }}>
          {(['alle', 'aktiv', 'venter', 'mangler_epost'] as const).map((s) => (
            <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>
              {s === 'alle' ? 'Alle' : STATUS_LABEL[s]} <span className="num">({s === 'alle' ? people.length : people.filter((p) => p.status === s).length})</span>
            </button>
          ))}
        </div>
      </div>
      <div className="card ledgerbox">
        <div className="tbl-wrap scrollbox">
          <table>
            <thead><tr><th>Navn</th><th>E-post</th><th>Mobil</th><th>Hytter</th><th>Roller</th><th>Status</th><th>Sist inne</th></tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.full_name || <span className="muted">Uten navn</span>}</b></td>
                  <td>{p.email ?? <span className="muted">–</span>}</td>
                  <td className="num">{p.phone ?? <span className="muted">–</span>}</td>
                  <td>{p.cabin_ids.map((id) => cabinLabel[id]).filter(Boolean).join(', ') || (p.worker_cabin_ids?.length ? '' : <span className="muted">–</span>)}
                    {(p.worker_cabin_ids ?? []).length > 0 && <div className="muted workerline">Prosjekt: {(p.worker_cabin_ids ?? []).map((id) => cabinLabel[id]).filter(Boolean).join(', ')}</div>}</td>
                  <td>
                    <div className="rolechips">
                      {ALL_ROLES.map((r) => (
                        <button key={r} className={`rolebtn ${p.roles.includes(r) ? 'on' : ''}`} aria-pressed={p.roles.includes(r)} onClick={() => void toggleRole(p, r)}>
                          {ROLE_LABEL[r]}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td><StatusPill s={p.status} /></td>
                  <td className="num">{p.last_seen_at ? dShort(p.last_seen_at) : <span className="muted">–</span>}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={7} className="muted">Ingen treff.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function AddPersonForm({ onDone, onCancel }: { onDone: () => Promise<void>; onCancel: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [roles, setRoles] = useState<AppRole[]>(['styre_vei']);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!emailOk(email)) { toast('E-postadressen ser ikke riktig ut.'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('admin_add_person', { p_name: name, p_email: email, p_phone: phone, p_roles: roles });
    setBusy(false);
    if (error) { toast('Personen ble ikke lagt til. Prøv igjen.'); return; }
    toast(`${name} er lagt til.`);
    await onDone();
  }

  return (
    <form className="card form" onSubmit={submit}>
      <label className="field" htmlFor="ap-name">Fullt navn<input id="ap-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field" htmlFor="ap-email">E-post<input id="ap-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="field" htmlFor="ap-phone">Mobil<input id="ap-phone" type="text" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
      <div className="field full">Roller
        <div className="checks">
          {ALL_ROLES.map((r) => (
            <label key={r} className="check"><input type="checkbox" checked={roles.includes(r)}
              onChange={(e) => setRoles((x) => (e.target.checked ? [...x, r] : x.filter((y) => y !== r)))} /> {ROLE_LABEL[r]}</label>
          ))}
        </div>
      </div>
      <div className="actions full">
        <button type="button" className="btn ghost" onClick={onCancel}>Avbryt</button>
        <button className="btn primary" disabled={busy || !name.trim()}>{busy ? 'Lagrer …' : 'Legg til'}</button>
      </div>
    </form>
  );
}
