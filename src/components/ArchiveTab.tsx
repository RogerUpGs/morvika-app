import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../lib/ui';
import { dShort } from '../lib/format';
import { Icon } from './Icon';

export const ARCHIVE_CATEGORIES = ['Festekontrakt', 'Skjøte', 'Kart og tomtegrense', 'Avtale', 'Byggetillatelse', 'Annet'];

interface CabinLite { id: string; label: string; number: number; area: 'morvika' | 'torpum'; address: string | null; gnr: number | null; bnr: number | null; fnr: number | null }
interface Arch { id: string; cabin_id: string; title: string; category: string; document_date: string | null; storage_path: string; created_at: string }

const safeName = (n: string) => n.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(-80);
const ext = (n: string) => (n.split('.').pop() || '').toUpperCase().slice(0, 4);

/** Administrasjon → Hyttearkiv: grunneier legger inn festekontrakt o.l. per hytte. Eierne ser dem i Min hytte. */
export function ArchiveTab({ cabins, owners, initialCabin, onChanged }: { cabins: CabinLite[]; owners: Record<string, string[]>; initialCabin: string | null; onChanged: () => void }) {
  const toast = useToast();
  const [cabinId, setCabinId] = useState<string | null>(initialCabin);
  const [q, setQ] = useState('');
  const [docs, setDocs] = useState<Arch[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const loadCounts = useCallback(async () => {
    const { data } = await supabase.from('cabin_archive').select('cabin_id');
    const c: Record<string, number> = {};
    for (const x of (data ?? []) as { cabin_id: string }[]) c[x.cabin_id] = (c[x.cabin_id] ?? 0) + 1;
    setCounts(c);
  }, []);
  const loadDocs = useCallback(async () => {
    if (!cabinId) { setDocs(null); return; }
    const { data } = await supabase.from('cabin_archive').select('id,cabin_id,title,category,document_date,storage_path,created_at')
      .eq('cabin_id', cabinId).order('document_date', { ascending: false, nullsFirst: false });
    setDocs((data ?? []) as Arch[]);
  }, [cabinId]);
  useEffect(() => { void loadCounts(); }, [loadCounts]);
  useEffect(() => { void loadDocs(); }, [loadDocs]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return cabins.filter((c) => !s || c.label.toLowerCase().includes(s) || String(c.number) === s
      || (c.address ?? '').toLowerCase().includes(s) || (owners[c.id] ?? []).some((n) => n.toLowerCase().includes(s)));
  }, [cabins, owners, q]);
  const cabin = cabins.find((c) => c.id === cabinId);
  const without = cabins.filter((c) => !counts[c.id]).length;

  async function open(d: Arch) {
    const w = window.open('', '_blank');
    const { data, error } = await supabase.storage.from('arkiv').createSignedUrl(d.storage_path, 600);
    if (error || !data) { w?.close(); toast('Dokumentet kunne ikke åpnes.'); return; }
    if (w) w.location.href = data.signedUrl; else window.location.href = data.signedUrl;
  }
  async function remove(d: Arch) {
    const { error } = await supabase.from('cabin_archive').delete().eq('id', d.id);
    setConfirmDel(null);
    if (error) { toast('Dokumentet ble ikke slettet.'); return; }
    await supabase.storage.from('arkiv').remove([d.storage_path]);
    toast('Dokumentet er slettet.');
    await Promise.all([loadDocs(), loadCounts()]); onChanged();
  }

  return (
    <div className="archive">
      <div className="card ledgerbox">
        <div className="archive-h">
          <input type="search" placeholder="Søk på navn, adresse eller nummer" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Søk etter hytte" />
          <small className="muted">{list.length} av {cabins.length} hytter · {without} uten dokumenter i arkivet</small>
        </div>
        <div className="tbl-wrap scrollbox archive-scroll">
          <table className="picktable">
            <thead><tr><th>Hytte</th><th>Eier</th><th>Hytteadresse</th><th>Gnr/Bnr/Fnr</th><th className="r">Arkiv</th></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className={c.id === cabinId ? 'on' : ''} onClick={() => setCabinId(c.id)} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCabinId(c.id); } }} aria-selected={c.id === cabinId}>
                  <td><b>{c.label}</b>{c.area === 'torpum' && <div className="muted" style={{ fontSize: 12 }}>Torpum</div>}</td>
                  <td>{(owners[c.id] ?? []).join(', ') || <span className="muted">Ingen eier</span>}</td>
                  <td>{c.address || <span className="muted">–</span>}</td>
                  <td className="num">{[c.gnr, c.bnr, c.fnr].map((x) => x ?? '–').join(' / ')}</td>
                  <td className="r">{counts[c.id] ? <span className="pill">{counts[c.id]}</span> : <span className="muted" style={{ fontSize: 12 }}>tomt</span>}</td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={5} className="muted">Ingen hytter passer.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {!cabin ? (
        <div className="empty">Velg en hytte i tabellen. Dokumentene du legger inn her, ser hyttas eiere under <b>Min hytte → Dokumentregister → «Fra grunneier»</b>. De kan lese dem, men ikke endre eller slette. Arkivet følger hytta ved eierskifte.</div>
      ) : (
        <div className="archive-main">
          <h2 className="serif h2" style={{ margin: '0 0 4px' }}>{cabin.label}</h2>
          <p className="muted" style={{ margin: '0 0 12px' }}>{[(owners[cabin.id] ?? []).join(', '), cabin.address].filter(Boolean).join(' · ') || 'Ingen eier registrert'}</p>
          <div className="archive-cols">
            <ArchiveUpload cabinId={cabin.id} label={cabin.label} onDone={async () => { await Promise.all([loadDocs(), loadCounts()]); onChanged(); }} />
            <div className="card doclist">
              <div className="doclist-h"><b>Hyttearkiv</b><span className="muted">{docs?.length ?? 0} dokumenter</span></div>
              {docs?.map((d) => (
                <div key={d.id} className="docrow">
                  <span className={`ftag t-${ext(d.storage_path).toLowerCase()}`}>{ext(d.storage_path) || 'FIL'}</span>
                  <button className="dm docbtn2" onClick={() => void open(d)}>
                    <div className="n">{d.title}</div><div className="d">{d.category}{d.document_date ? ` · datert ${dShort(d.document_date)} ${d.document_date.slice(0, 4)}` : ''}</div>
                  </button>
                  <span className="docacts">
                    {confirmDel === d.id
                      ? <><button className="btn small danger-btn" onClick={() => void remove(d)}>Slett</button><button className="btn small ghost" onClick={() => setConfirmDel(null)}>Avbryt</button></>
                      : <button className="linkbtn" onClick={() => setConfirmDel(d.id)}>Slett</button>}
                  </span>
                </div>
              ))}
              {docs && !docs.length && <div className="empty" style={{ border: 0, margin: 8 }}>Ingen dokumenter i arkivet for denne hytta ennå.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ArchiveUpload({ cabinId, label, onDone }: { cabinId: string; label: string; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(ARCHIVE_CATEGORIES[0]);
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (file.size > 25_000_000) { toast('Filen er for stor (over 25 MB).'); return; }
    setBusy(true);
    const path = `${cabinId}/${crypto.randomUUID()}-${safeName(file.name)}`;
    const up = await supabase.storage.from('arkiv').upload(path, file, { contentType: file.type || 'application/octet-stream' });
    if (up.error) { setBusy(false); toast('Filen ble ikke lastet opp. Prøv igjen.'); return; }
    const { error } = await supabase.from('cabin_archive').insert({
      cabin_id: cabinId, title: title.trim() || file.name.replace(/\.[^.]+$/, ''), category, document_date: date || null, storage_path: path,
    });
    setBusy(false);
    if (error) { await supabase.storage.from('arkiv').remove([path]); toast('Dokumentet ble ikke lagret.'); return; }
    toast('Dokumentet er lagt i hyttearkivet.');
    setFile(null); setTitle(''); setDate(''); setKey((k) => k + 1);
    await onDone();
  }

  return (
    <form className="card form" onSubmit={submit}>
      <label className="field full" htmlFor="ar-file">Fil (PDF, bilde eller Word)
        <input key={key} id="ar-file" type="file" required accept=".pdf,.doc,.docx,.odt,image/*" onChange={(e) => {
          const f = e.target.files?.[0] ?? null; setFile(f);
          if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
        }} />
      </label>
      <label className="field full" htmlFor="ar-title">Tittel
        <input id="ar-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`F.eks. Festekontrakt ${label.split(' · ')[0]}`} />
      </label>
      <label className="field" htmlFor="ar-cat">Type
        <select id="ar-cat" value={category} onChange={(e) => setCategory(e.target.value)}>{ARCHIVE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
      </label>
      <label className="field" htmlFor="ar-date">Datert (valgfritt)
        <input id="ar-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="actions full"><button className="btn primary" disabled={busy || !file}><Icon name="upload" size={18} />{busy ? 'Laster opp …' : 'Legg i arkivet'}</button></div>
    </form>
  );
}
