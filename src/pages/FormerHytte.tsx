import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useMe, type FormerCabin } from '../lib/session';
import { useToast } from '../lib/ui';
import { dLong, dShort } from '../lib/format';
import { useSignedUrls } from '../lib/images';
import { Lightbox } from '../components/Media';
import { Icon } from '../components/Icon';

interface Doc { id: string; folder: string; name: string; storage_path: string; size_bytes: number | null; created_at: string }
interface Photo { id: string; caption: string; storage_path: string; created_at: string }
interface Entry { id: string; entry_date: string; description: string; category: string; amount: number; kind: 'ut' | 'inn' }

const kr = (n: number) => `${new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(Math.round(n))} kr`;
const ext = (n: string) => (n.split('.').pop() || '').toUpperCase().slice(0, 4);
const daysLeft = (d: string) => Math.max(0, Math.ceil((new Date(`${d}T23:59:59`).getTime() - Date.now()) / 86_400_000));

/**
 * Min hytte for en hytte man har solgt eller overdratt: lese og laste ned i 90 dager,
 * gi dokumenter og bilder videre til ny eier, og «Overfør alt» ved overdragelse i familien.
 */
export function FormerHytte({ f }: { f: FormerCabin }) {
  const me = useMe();
  const toast = useToast();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [ledger, setLedger] = useState<Entry[]>([]);
  const [selDocs, setSelDocs] = useState<Set<string>>(new Set());
  const [selPhotos, setSelPhotos] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<'gi' | 'alt' | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [d, p, l] = await Promise.all([
      supabase.from('cabin_documents').select('id,folder,name,storage_path,size_bytes,created_at').eq('ownership_id', f.ownership_id).order('created_at', { ascending: false }),
      supabase.from('cabin_photos').select('id,caption,storage_path,created_at').eq('ownership_id', f.ownership_id).order('created_at', { ascending: false }),
      supabase.from('cabin_ledger').select('id,entry_date,description,category,amount,kind').eq('ownership_id', f.ownership_id).order('entry_date', { ascending: false }),
    ]);
    setDocs((d.data ?? []) as Doc[]); setPhotos((p.data ?? []) as Photo[]);
    setLedger(((l.data ?? []) as Entry[]).map((x) => ({ ...x, amount: Number(x.amount) })));
    setSelDocs(new Set()); setSelPhotos(new Set());
  }, [f.ownership_id]);
  useEffect(() => { void load(); }, [load]);
  const urls = useSignedUrls('hytte', photos.map((p) => p.storage_path));

  async function openDoc(d: Doc) {
    const w = window.open('', '_blank');
    const { data, error } = await supabase.storage.from('hytte').createSignedUrl(d.storage_path, 600, { download: d.name });
    if (error || !data) { w?.close(); toast('Filen kunne ikke åpnes.'); return; }
    if (w) w.location.href = data.signedUrl; else window.location.href = data.signedUrl;
  }

  function exportCsv() {
    const rows = [['Dato', 'Type', 'Beskrivelse', 'Kategori', 'Beløp'], ...[...ledger].reverse().map((x) => [x.entry_date, x.kind === 'ut' ? 'Utgift' : 'Inntekt', x.description, x.category, (x.kind === 'ut' ? -x.amount : x.amount).toFixed(2).replace('.', ',')])];
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `Hytteregnskap ${f.label}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function handOver() {
    if (!f.transfer_id) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('hand_over', { p_transfer: f.transfer_id, p_documents: [...selDocs], p_photos: [...selPhotos] });
    setBusy(false); setConfirm(null);
    if (error) { toast('Det gikk ikke å gi dem videre. Prøv igjen.'); return; }
    toast(`${data as number} ${(data as number) === 1 ? 'ting er' : 'ting er'} gitt videre til ny eier.`);
    await load();
  }
  async function transferAll() {
    if (!f.transfer_id) return;
    setBusy(true);
    const { error } = await supabase.rpc('approve_full_transfer', { p_transfer: f.transfer_id });
    setBusy(false); setConfirm(null);
    if (error) { toast('Overføringen ble ikke gjort. Prøv igjen.'); return; }
    toast('Hele Min hytte er overført til ny eier.');
    await me.reload();
  }

  const toggle = (set: Set<string>, id: string, fn: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); fn(n); };
  const selected = selDocs.size + selPhotos.size;
  const left = daysLeft(f.access_until);
  const familyOpen = f.kind === 'familie' && !f.full_transfer_at;

  return (
    <div className="former">
      <section className="card formerbanner">
        <Icon name="lock" size={22} />
        <div>
          <b>{f.label} er {f.kind === 'familie' ? 'overdratt' : 'solgt'} {dLong(f.ends_on)}</b>
          <p>Du kan lese og laste ned det du hadde i Min hytte til og med <b>{dLong(f.access_until)}</b> ({left} {left === 1 ? 'dag' : 'dager'} igjen). Etter det slettes det. Ny eier ser ikke dette, med mindre du gir det videre.</p>
        </div>
      </section>

      {familyOpen && (
        <section className="card familycard">
          <h3 className="serif">Overdragelse i familien</h3>
          <p className="muted">Du kan gi hele Min hytte videre til ny eier: alle dokumenter, bilder, album og hele regnskapet. Da forsvinner det herfra.</p>
          {confirm === 'alt' ? (
            <span className="confirm">Overføre alt til ny eier? Dette kan ikke angres.
              <button className="btn small primary" disabled={busy} onClick={() => void transferAll()}>Ja, overfør alt</button>
              <button className="btn small ghost" onClick={() => setConfirm(null)}>Avbryt</button></span>
          ) : <button className="btn primary" onClick={() => setConfirm('alt')}>Overfør alt til ny eier</button>}
        </section>
      )}

      {selected > 0 && (
        <div className="handbar">
          <span><b>{selected}</b> valgt</span>
          {confirm === 'gi' ? (
            <span className="confirm">Gi {selected === 1 ? 'dette' : `disse ${selected}`} til ny eier? Du mister tilgangen til {selected === 1 ? 'det' : 'dem'}.
              <button className="btn small primary" disabled={busy} onClick={() => void handOver()}>Ja, gi videre</button>
              <button className="btn small ghost" onClick={() => setConfirm(null)}>Avbryt</button></span>
          ) : (
            <span style={{ display: 'flex', gap: 8 }}>
              <button className="btn small ghost" onClick={() => { setSelDocs(new Set()); setSelPhotos(new Set()); }}>Fjern valg</button>
              <button className="btn small primary" onClick={() => setConfirm('gi')}>Gi til ny eier</button>
            </span>
          )}
        </div>
      )}

      <div className="card doclist">
        <div className="doclist-h"><b>Dokumenter</b><span className="muted">Kryss av for det som skal følge hytta, for eksempel tegninger og garantier</span></div>
        {docs.map((d) => (
          <div key={d.id} className="docrow selrow">
            <label className="selbox"><input type="checkbox" checked={selDocs.has(d.id)} onChange={() => toggle(selDocs, d.id, setSelDocs)} aria-label={`Velg ${d.name}`} />
              <span className={`ftag t-${ext(d.name).toLowerCase()}`}>{ext(d.name) || 'FIL'}</span></label>
            <button className="dm docbtn2" onClick={() => void openDoc(d)}><div className="n">{d.name}</div><div className="d">{d.folder} · {dShort(d.created_at)}</div></button>
            <button className="btn small ghost" onClick={() => void openDoc(d)} aria-label={`Last ned ${d.name}`}><Icon name="upload" size={16} /><span className="hide-phone">Last ned</span></button>
          </div>
        ))}
        {!docs.length && <div className="empty" style={{ border: 0, margin: 8 }}>Ingen dokumenter igjen.</div>}
      </div>

      <div className="galhead" style={{ marginTop: 22 }}><h3 className="serif">Bilder</h3><span className="muted">{photos.length} bilder · kryss av for å gi videre, trykk for å se og lagre</span></div>
      {photos.length ? (
        <div className="pgrid">
          {photos.map((p, i) => (
            <div key={p.id} className="ptwrap">
              <button className="pt" style={urls[p.storage_path] ? { backgroundImage: `url("${urls[p.storage_path]}")` } : undefined} onClick={() => setOpen(i)} aria-label={`Vis ${p.caption || 'bilde'}`}>
                {p.caption && <span>{p.caption}</span>}
              </button>
              <label className="ptsel"><input type="checkbox" checked={selPhotos.has(p.id)} onChange={() => toggle(selPhotos, p.id, setSelPhotos)} aria-label="Velg bildet" /></label>
            </div>
          ))}
        </div>
      ) : <div className="empty">Ingen bilder igjen.</div>}
      {open !== null && <Lightbox urls={photos.map((p) => urls[p.storage_path]).filter(Boolean)} start={open} onClose={() => setOpen(null)} />}

      <div className="card ledgerbox" style={{ marginTop: 22 }}>
        <div className="ledgerbox-h"><b>Hytteregnskap</b>
          {ledger.length > 0 ? <button className="linkbtn2" onClick={exportCsv}>Last ned som regneark (CSV)</button> : <span className="muted">Ingen poster</span>}</div>
        {ledger.length > 0 && (
          <div className="tbl-wrap scrollbox">
            <table>
              <thead><tr><th>Dato</th><th>Beskrivelse</th><th>Kategori</th><th className="r">Beløp</th></tr></thead>
              <tbody>{ledger.map((x) => (
                <tr key={x.id}><td className="num">{dShort(x.entry_date)} {x.entry_date.slice(0, 4)}</td><td>{x.description}</td><td className="muted">{x.category}</td>
                  <td className={`r num ${x.kind === 'inn' ? 'in' : ''}`}>{x.kind === 'inn' ? '+ ' : '− '}{kr(x.amount)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
