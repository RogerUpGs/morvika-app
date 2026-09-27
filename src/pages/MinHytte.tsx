import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useMe } from '../lib/session';
import { useToast } from '../lib/ui';
import { dShort } from '../lib/format';
import { shrinkImage, toDrafts, uploadImages, useSignedUrls, type Draft } from '../lib/images';
import { Lightbox } from '../components/Media';
import { Icon } from '../components/Icon';
import type { Cabin } from '../lib/types';

type Tab = 'home' | 'dok' | 'foto' | 'regn';
const FOLDERS = ['Kontrakter', 'Forsikring', 'Tegninger', 'Kvitteringer'];
const CATS = ['Festeavgift', 'Vei og brøyting', 'Strøm', 'Forsikring', 'Kommunale avgifter', 'Vedlikehold', 'Innkjøp', 'Utleie', 'Annet'];
const ARCHIVE = 'Fra grunneier';

interface Doc { id: string; folder: string; name: string; storage_path: string; size_bytes: number | null; created_at: string }
interface Album { id: string; name: string; created_at: string }
interface Photo { id: string; album_id: string | null; caption: string; storage_path: string; created_at: string }
interface Entry { id: string; entry_date: string; description: string; category: string; amount: number; kind: 'ut' | 'inn'; receipt_path: string | null }
interface Arch { id: string; title: string; category: string; document_date: string | null; storage_path: string; created_at: string }

const kr = (n: number) => `${new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(Math.round(n))} kr`;
const size = (b: number | null) => (b == null ? '' : b > 1_000_000 ? `${(b / 1_000_000).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1000))} kB`);
const ext = (n: string) => (n.split('.').pop() || '').toUpperCase().slice(0, 4);
const safeName = (n: string) => n.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(-80);
const today = () => new Date().toISOString().slice(0, 10);

async function openFile(bucket: string, path: string, toast: (m: string) => void) {
  const w = window.open('', '_blank');
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 600);
  if (error || !data) { w?.close(); toast('Filen kunne ikke åpnes.'); return; }
  if (w) w.location.href = data.signedUrl; else window.location.href = data.signedUrl;
}

export function MinHyttePage() {
  const me = useMe();
  const toast = useToast();
  const cabins = me.fullCabins;
  const [cabinId, setCabinId] = useState(cabins[0]?.id ?? '');
  const cabin = cabins.find((c) => c.id === cabinId) ?? cabins[0];
  const [tab, setTab] = useState<Tab>('home');
  const [own, setOwn] = useState<string | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [ledger, setLedger] = useState<Entry[]>([]);
  const [archive, setArchive] = useState<Arch[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!cabin) return;
    const { data: w } = await supabase.rpc('my_ownership', { c: cabin.id });
    const o = (w as string | null) ?? null;
    setOwn(o);
    if (!o) { setLoaded(true); return; }
    const [d, a, p, l, ar] = await Promise.all([
      supabase.from('cabin_documents').select('id,folder,name,storage_path,size_bytes,created_at').eq('ownership_id', o).order('created_at', { ascending: false }),
      supabase.from('cabin_albums').select('id,name,created_at').eq('ownership_id', o).order('created_at'),
      supabase.from('cabin_photos').select('id,album_id,caption,storage_path,created_at').eq('ownership_id', o).order('created_at', { ascending: false }),
      supabase.from('cabin_ledger').select('id,entry_date,description,category,amount,kind,receipt_path').eq('ownership_id', o).order('entry_date', { ascending: false }),
      supabase.from('cabin_archive').select('id,title,category,document_date,storage_path,created_at').eq('cabin_id', cabin.id).order('created_at', { ascending: false }),
    ]);
    setDocs((d.data ?? []) as Doc[]); setAlbums((a.data ?? []) as Album[]); setPhotos((p.data ?? []) as Photo[]);
    setLedger(((l.data ?? []) as Entry[]).map((x) => ({ ...x, amount: Number(x.amount) })));
    setArchive((ar.data ?? []) as Arch[]);
    setLoaded(true);
  }, [cabin]);
  useEffect(() => { setLoaded(false); void load(); }, [load]);

  if (!cabin) return <div className="empty">Du eier ingen hytte med Min hytte.</div>;
  if (loaded && !own) return <div className="empty">Min hytte kunne ikke åpnes. Ta kontakt med administrator.</div>;

  const titles: Record<Tab, string> = { home: cabin.label, dok: 'Dokumentregister', foto: 'Fotoalbum', regn: 'Hytteregnskap' };
  const others = (['dok', 'foto', 'regn'] as Tab[]).filter((t) => t !== tab);

  return (
    <>
      {cabins.length > 1 && tab === 'home' && (
        <div className="chips" role="group" aria-label="Velg hytte">
          {cabins.map((c) => <button key={c.id} className={`chip ${c.id === cabin.id ? 'on' : ''}`} onClick={() => setCabinId(c.id)}>{c.label}</button>)}
        </div>
      )}
      {tab === 'home' ? (
        <HytteHome cabin={cabin} name={me.profile?.full_name ?? ''} docs={docs} archive={archive} photos={photos} albums={albums} ledger={ledger} go={setTab} />
      ) : (
        <div className="subhead">
          <button className="crumb" onClick={() => setTab('home')}><Icon name="back" size={18} />{cabin.label}</button>
          <h2 className="serif">{titles[tab]}</h2>
          <div className="switch">{others.map((t) => <button key={t} className="chip" onClick={() => setTab(t)}>{titles[t]}</button>)}</div>
        </div>
      )}
      {!loaded && tab !== 'home' && <div className="empty">Henter …</div>}
      {loaded && own && tab === 'dok' && <Documents cabinId={cabin.id} own={own} docs={docs} archive={archive} reload={load} toast={toast} />}
      {loaded && own && tab === 'foto' && <Photos cabinId={cabin.id} own={own} albums={albums} photos={photos} reload={load} toast={toast} />}
      {loaded && own && tab === 'regn' && <Ledger cabinId={cabin.id} own={own} ledger={ledger} reload={load} toast={toast} label={cabin.label} />}
    </>
  );
}

/* ---------- Forsiden for hytta ---------- */
function HytteHome({ cabin, name, docs, archive, photos, albums, ledger, go }: {
  cabin: Cabin; name: string; docs: Doc[]; archive: Arch[]; photos: Photo[]; albums: Album[]; ledger: Entry[]; go: (t: Tab) => void;
}) {
  const yr = new Date().getFullYear();
  const thisYr = ledger.filter((x) => x.entry_date.startsWith(String(yr)));
  const net = thisYr.reduce((s, x) => s + (x.kind === 'ut' ? x.amount : -x.amount), 0);
  const recent = photos.slice(0, 3).map((p) => p.storage_path);
  const urls = useSignedUrls('hytte', recent);
  const folders = new Set(docs.map((d) => d.folder)).size + (archive.length ? 1 : 0);
  return (
    <>
      <section className="hhero">
        <svg className="waves" width="260" height="120" viewBox="0 0 34 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true">
          <path d="M1 6c3-2 5-2 7.5 0s5 2 7.5 0 5-2 7.5 0 5 2 7.5 0" /><path d="M1 11c3-2 5-2 7.5 0s5 2 7.5 0 5-2 7.5 0 5 2 7.5 0" />
        </svg>
        <div className="eyebrow">Mørvika hytteområde</div>
        <h2>{cabin.label}</h2>
        <div className="sub">{cabin.gnr ? `Gnr ${cabin.gnr} / bnr ${cabin.bnr ?? '–'} · ` : ''}{name}</div>
        <div className="lockchip"><Icon name="lock" size={15} />Privat. Bare hyttas eiere har tilgang.</div>
      </section>
      <div className="apps">
        <button className="card apptile" onClick={() => go('dok')}>
          <span className="ic"><Icon name="doc" size={24} /></span>
          <div><h3>Dokumentregister</h3><div className="meta">{docs.length + archive.length} dokumenter i {folders} {folders === 1 ? 'mappe' : 'mapper'}</div></div>
          <div className="pv">{docs.length || archive.length
            ? [...archive.map((a) => a.title), ...docs.map((d) => d.name)].slice(0, 3).map((n, i) => <span key={i} className="ln">{n}</span>)
            : <span className="muted">Last opp festekontrakt, forsikring og tegninger.</span>}</div>
          <span className="go">Åpne <Icon name="chev" size={16} /></span>
        </button>
        <button className="card apptile" onClick={() => go('foto')}>
          <span className="ic"><Icon name="photo" size={24} /></span>
          <div><h3>Fotoalbum</h3><div className="meta">{photos.length} bilder i {albums.length} album</div></div>
          <div className="pv">{recent.length
            ? <div className="thumbs">{recent.map((p) => <span key={p} style={urls[p] ? { backgroundImage: `url("${urls[p]}")` } : undefined} />)}</div>
            : <span className="muted">Samle hyttebildene på ett sted.</span>}</div>
          <span className="go">Åpne <Icon name="chev" size={16} /></span>
        </button>
        <button className="card apptile" onClick={() => go('regn')}>
          <span className="ic"><Icon name="book" size={24} /></span>
          <div><h3>Hytteregnskap</h3><div className="meta">{thisYr.length} poster ført i {yr}</div></div>
          <div className="pv"><span className="muted">Netto kostnad {yr}</span><span className="big">{kr(net)}</span>
            {ledger[0] && <span className="ln muted">Sist: {ledger[0].description}</span>}</div>
          <span className="go">Åpne <Icon name="chev" size={16} /></span>
        </button>
      </div>
    </>
  );
}

/* ---------- Dokumentregister ---------- */
function Documents({ cabinId, own, docs, archive, reload, toast }: {
  cabinId: string; own: string; docs: Doc[]; archive: Arch[]; reload: () => Promise<void>; toast: (m: string) => void;
}) {
  const custom = [...new Set(docs.map((d) => d.folder))].filter((f) => !FOLDERS.includes(f));
  const [extra, setExtra] = useState<string[]>([]);
  const folders = [...FOLDERS, ...custom, ...extra.filter((f) => !custom.includes(f))];
  const [folder, setFolder] = useState<string>('Alle');
  const [target, setTarget] = useState(FOLDERS[0]);
  const [busy, setBusy] = useState('');
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  useEffect(() => { if (folder !== 'Alle' && folder !== ARCHIVE) setTarget(folder); }, [folder]);
  const count = (f: string) => (f === 'Alle' ? docs.length : f === ARCHIVE ? archive.length : docs.filter((d) => d.folder === f).length);
  const shown = folder === 'Alle' ? docs : docs.filter((d) => d.folder === folder);

  async function upload(files: FileList | File[] | null) {
    const list = [...(files ?? [])];
    if (!list.length) return;
    const tooBig = list.filter((f) => f.size > 25_000_000);
    if (tooBig.length) toast(`${tooBig.map((f) => f.name).join(', ')} er for stor (over 25 MB).`);
    let ok = 0;
    for (const [i, f] of list.filter((x) => x.size <= 25_000_000).entries()) {
      setBusy(`Laster opp ${i + 1} av ${list.length} …`);
      const path = `${own}/${crypto.randomUUID()}-${safeName(f.name)}`;
      const up = await supabase.storage.from('hytte').upload(path, f, { contentType: f.type || 'application/octet-stream' });
      if (up.error) continue;
      const { error } = await supabase.from('cabin_documents').insert({ cabin_id: cabinId, ownership_id: own, folder: target, name: f.name, storage_path: path, size_bytes: f.size });
      if (error) { await supabase.storage.from('hytte').remove([path]); continue; }
      ok++;
    }
    setBusy('');
    toast(ok === list.length ? `${ok} ${ok === 1 ? 'dokument' : 'dokumenter'} lagt i «${target}».` : `${ok} av ${list.length} ble lastet opp.`);
    await reload();
  }

  async function remove(d: Doc) {
    const { error } = await supabase.from('cabin_documents').delete().eq('id', d.id);
    setConfirmDel(null);
    if (error) { toast('Dokumentet ble ikke slettet.'); return; }
    await supabase.storage.from('hytte').remove([d.storage_path]);
    toast('Dokumentet er slettet.'); await reload();
  }

  async function move(d: Doc, to: string) {
    const { error } = await supabase.from('cabin_documents').update({ folder: to }).eq('id', d.id);
    if (error) toast('Dokumentet ble ikke flyttet.'); else { toast(`Flyttet til «${to}».`); await reload(); }
  }

  return (
    <>
      <div className="folders">
        {['Alle', ...(archive.length ? [ARCHIVE] : []), ...folders].map((f) => (
          <button key={f} className={`folder ${folder === f ? 'on' : ''}`} onClick={() => setFolder(f)}>
            <span className="fi"><Icon name={f === ARCHIVE ? 'lock' : 'folder'} size={22} /></span>
            <span><b>{f === 'Alle' ? 'Alle dokumenter' : f}</b><small>{count(f)} {count(f) === 1 ? 'fil' : 'filer'}</small></span>
          </button>
        ))}
        {newFolder === null
          ? <button className="folder newf" onClick={() => setNewFolder('')}><span className="fi"><Icon name="plus" size={22} /></span><span><b>Ny mappe</b></span></button>
          : (
            <form className="folder newf" onSubmit={(e) => { e.preventDefault(); const n = newFolder.trim(); if (n && !folders.includes(n)) { setExtra((x) => [...x, n]); setFolder(n); } setNewFolder(null); }}>
              <input type="text" autoFocus value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="Navn på mappe" aria-label="Navn på ny mappe" maxLength={40} />
              <button className="btn small primary">OK</button>
            </form>
          )}
      </div>

      {folder === ARCHIVE ? (
        <div className="card doclist">
          <div className="doclist-h"><b>Fra grunneier</b><span className="muted">Følger hytta. Kan leses, ikke endres.</span></div>
          {archive.map((a) => (
            <button key={a.id} className="docrow docbtn" onClick={() => void openFile('arkiv', a.storage_path, toast)}>
              <span className="ftag">{ext(a.storage_path) || 'FIL'}</span>
              <div className="dm"><div className="n">{a.title}</div><div className="d">{a.category}</div></div>
              <span className="d num">{a.document_date ? dShort(a.document_date) : dShort(a.created_at)}</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className={`dropzone ${drag ? "over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); void upload(e.dataTransfer.files); }}>
            <span className="dz-ic"><Icon name="upload" size={26} /></span>
            <div className="dz-tx"><b>{busy || 'Last opp dokumenter'}</b><small>Dra filer hit, eller velg fra PC eller telefon. Du kan også ta bilde av et papir.</small></div>
            <div className="dz-act">
              <label className="field dz-sel" htmlFor="doc-folder">Legg i mappe
                <select id="doc-folder" value={target} onChange={(e) => setTarget(e.target.value)}>{folders.map((f) => <option key={f}>{f}</option>)}</select>
              </label>
              <label className={`btn primary ${busy ? 'disabled' : ''}`}><Icon name="upload" size={18} />Velg filer
                <input type="file" multiple hidden disabled={!!busy} onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
              </label>
            </div>
          </div>
          <div className="card doclist">
            <div className="doclist-h"><b>{folder === 'Alle' ? 'Alle dokumenter' : folder}</b><span className="muted">{shown.length} {shown.length === 1 ? 'fil' : 'filer'}</span></div>
            {shown.map((d) => (
              <div key={d.id} className="docrow">
                <span className={`ftag t-${ext(d.name).toLowerCase()}`}>{ext(d.name) || 'FIL'}</span>
                <button className="dm docbtn2" onClick={() => void openFile('hytte', d.storage_path, toast)}>
                  <div className="n">{d.name}</div><div className="d">{d.folder}{d.size_bytes ? ` · ${size(d.size_bytes)}` : ''} · {dShort(d.created_at)}</div>
                </button>
                <span className="docacts">
                  <select aria-label={`Flytt ${d.name}`} value="" onChange={(e) => e.target.value && void move(d, e.target.value)}>
                    <option value="">Flytt …</option>{folders.filter((f) => f !== d.folder).map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                  {confirmDel === d.id
                    ? <><button className="btn small danger-btn" onClick={() => void remove(d)}>Slett</button><button className="btn small ghost" onClick={() => setConfirmDel(null)}>Avbryt</button></>
                    : <button className="linkbtn" onClick={() => setConfirmDel(d.id)}>Slett</button>}
                </span>
              </div>
            ))}
            {shown.length === 0 && <div className="empty" style={{ border: 0, margin: 8 }}>Ingen dokumenter i denne mappen ennå.</div>}
          </div>
        </>
      )}
    </>
  );
}

/* ---------- Fotoalbum ---------- */
function Photos({ cabinId, own, albums, photos, reload, toast }: {
  cabinId: string; own: string; albums: Album[]; photos: Photo[]; reload: () => Promise<void>; toast: (m: string) => void;
}) {
  const [album, setAlbum] = useState<string>('alle');
  const [target, setTarget] = useState<string>(albums[0]?.id ?? '');
  const [newName, setNewName] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [selected, setSelected] = useState<Photo | null>(null);

  useEffect(() => { if (album !== 'alle' && album !== 'ingen') setTarget(album); }, [album]);
  useEffect(() => { if (!target && albums[0]) setTarget(albums[0].id); }, [albums, target]);

  const inAlbum = (a: string) => (a === 'alle' ? photos : a === 'ingen' ? photos.filter((p) => !p.album_id) : photos.filter((p) => p.album_id === a));
  const shown = inAlbum(album);
  const covers = useMemo(() => albums.map((a) => photos.find((p) => p.album_id === a.id)?.storage_path).filter(Boolean) as string[], [albums, photos]);
  const urls = useSignedUrls('hytte', [...new Set([...shown.map((p) => p.storage_path), ...covers, ...(photos[0] ? [photos[0].storage_path] : [])])]);
  const unsorted = photos.filter((p) => !p.album_id).length;

  async function createAlbum(e: FormEvent) {
    e.preventDefault();
    const name = (newName ?? '').trim();
    if (!name) return;
    const { data, error } = await supabase.from('cabin_albums').insert({ cabin_id: cabinId, ownership_id: own, name }).select('id').single();
    if (error || !data) { toast(error?.code === '23505' ? 'Du har allerede et album med det navnet.' : 'Albumet ble ikke laget.'); return; }
    setNewName(null); await reload(); setAlbum(data.id as string); setTarget(data.id as string);
  }

  async function add(files: FileList | null) {
    const { drafts, skipped } = toDrafts(files, 0);
    const all: Draft[] = drafts;
    if (skipped) toast('Du kan legge til opptil 10 bilder om gangen.');
    if (!all.length) return;
    setBusy(`Laster opp ${all.length} ${all.length === 1 ? 'bilde' : 'bilder'} …`);
    try {
      const paths = await uploadImages('hytte', own, all);
      const { error } = await supabase.from('cabin_photos').insert(paths.map((p) => ({ cabin_id: cabinId, ownership_id: own, album_id: target || null, storage_path: p })));
      if (error) { await supabase.storage.from('hytte').remove(paths); throw error; }
      toast(`${paths.length} ${paths.length === 1 ? 'bilde' : 'bilder'} lagt til.`);
    } catch { toast('Bildene ble ikke lastet opp. Sjekk nettet og prøv igjen.'); }
    all.forEach((d) => URL.revokeObjectURL(d.url));
    setBusy(''); await reload();
  }

  async function removePhoto(p: Photo) {
    const { error } = await supabase.from('cabin_photos').delete().eq('id', p.id);
    setConfirmDel(null); setSelected(null);
    if (error) { toast('Bildet ble ikke slettet.'); return; }
    await supabase.storage.from('hytte').remove([p.storage_path]);
    toast('Bildet er slettet.'); await reload();
  }
  async function saveCaption(p: Photo, caption: string, albumId: string | null) {
    const { error } = await supabase.from('cabin_photos').update({ caption: caption.trim(), album_id: albumId }).eq('id', p.id);
    if (error) toast('Endringen ble ikke lagret.'); else { setSelected(null); await reload(); }
  }
  async function removeAlbum(a: Album) {
    const { error } = await supabase.from('cabin_albums').delete().eq('id', a.id);
    setConfirmDel(null);
    if (error) toast('Albumet ble ikke slettet.'); else { toast('Albumet er slettet. Bildene ligger under «Uten album».'); setAlbum('alle'); await reload(); }
  }

  const cover = (a: string) => { const p = inAlbum(a)[0]; return p && urls[p.storage_path] ? { backgroundImage: `url("${urls[p.storage_path]}")` } : undefined; };

  return (
    <>
      <div className="albums">
        {[['alle', 'Alle bilder'] as const, ...albums.map((a) => [a.id, a.name] as const), ...(unsorted && albums.length ? [['ingen', 'Uten album'] as const] : [])].map(([id, name]) => (
          <button key={id} className={`album ${album === id ? 'on' : ''}`} onClick={() => setAlbum(id)}>
            <span className="cv" style={cover(id)}>{!cover(id) && <Icon name="photo" size={28} />}</span>
            <span className="nm"><b>{name}</b><small>{inAlbum(id).length} {inAlbum(id).length === 1 ? 'bilde' : 'bilder'}</small></span>
          </button>
        ))}
        {newName === null ? (
          <button className="album new" onClick={() => setNewName('')}><span className="cv"><Icon name="plus" size={28} /></span>
            <span className="nm"><b>Nytt album</b><small>Samle bilder fra en tur eller et prosjekt</small></span></button>
        ) : (
          <form className="album new" onSubmit={createAlbum}><span className="cv"><Icon name="plus" size={28} /></span>
            <span className="nm"><input type="text" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Navn på album" aria-label="Navn på album" maxLength={60} />
              <button className="btn primary small" style={{ marginTop: 8, width: '100%' }}>Lag album</button></span></form>
        )}
      </div>

      <div className="dropzone">
        <span className="dz-ic"><Icon name="camera" size={26} /></span>
        <div className="dz-tx"><b>{busy || 'Legg til bilder'}</b><small>Ta bilde med telefonen, eller velg fra kamerarullen. Bildene gjøres mindre før opplasting.</small></div>
        <div className="dz-act">
          {albums.length > 0 && (
            <label className="field dz-sel" htmlFor="photo-album">Legg i album
              <select id="photo-album" value={target} onChange={(e) => setTarget(e.target.value)}>
                {albums.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}<option value="">Uten album</option>
              </select>
            </label>
          )}
          <label className={`btn primary ${busy ? 'disabled' : ''}`}><Icon name="upload" size={18} />Velg bilder
            <input type="file" accept="image/*" multiple hidden disabled={!!busy} onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
          </label>
        </div>
      </div>

      <div className="galhead">
        <h3 className="serif">{album === 'alle' ? 'Alle bilder' : album === 'ingen' ? 'Uten album' : albums.find((a) => a.id === album)?.name}</h3>
        <span className="muted">{shown.length} {shown.length === 1 ? 'bilde' : 'bilder'}{shown.length ? ' · trykk for å se stort' : ''}</span>
        {album !== 'alle' && album !== 'ingen' && (confirmDel === album
          ? <span className="confirm">Slette albumet? Bildene blir liggende.<button className="btn small danger-btn" onClick={() => void removeAlbum(albums.find((a) => a.id === album)!)}>Slett album</button><button className="btn small ghost" onClick={() => setConfirmDel(null)}>Avbryt</button></span>
          : <button className="linkbtn" onClick={() => setConfirmDel(album)}>Slett album</button>)}
      </div>
      {shown.length ? (
        <div className="pgrid">
          {shown.map((p, i) => (
            <div key={p.id} className="ptwrap">
              <button className="pt" style={urls[p.storage_path] ? { backgroundImage: `url("${urls[p.storage_path]}")` } : undefined} onClick={() => setOpen(i)} aria-label={`Vis ${p.caption || 'bilde'}`}>
                {p.caption && <span>{p.caption}</span>}
              </button>
              <button className="ptedit" onClick={() => setSelected(p)} aria-label="Endre bildetekst eller album"><Icon name="more" size={18} /></button>
            </div>
          ))}
        </div>
      ) : <div className="empty">Ingen bilder her ennå.</div>}

      {open !== null && <Lightbox urls={shown.map((p) => urls[p.storage_path]).filter(Boolean)} start={open} onClose={() => setOpen(null)} />}
      {selected && <PhotoEdit p={selected} albums={albums} url={urls[selected.storage_path]} onSave={saveCaption} onClose={() => setSelected(null)}
        onDelete={() => (confirmDel === selected.id ? void removePhoto(selected) : setConfirmDel(selected.id))} confirming={confirmDel === selected.id} />}
    </>
  );
}

function PhotoEdit({ p, albums, url, onSave, onClose, onDelete, confirming }: {
  p: Photo; albums: Album[]; url?: string; onSave: (p: Photo, caption: string, album: string | null) => void; onClose: () => void; onDelete: () => void; confirming: boolean;
}) {
  const [caption, setCaption] = useState(p.caption);
  const [album, setAlbum] = useState(p.album_id ?? '');
  return (
    <div className="sheet-bg" onClick={onClose}>
      <form className="sheet card" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSave(p, caption, album || null); }}>
        {url && <img src={url} alt="" className="sheet-img" />}
        <label className="field" htmlFor="ph-cap">Bildetekst
          <input id="ph-cap" type="text" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="F.eks. Nytt tak, august 2026" maxLength={200} />
        </label>
        <label className="field" htmlFor="ph-alb">Album
          <select id="ph-alb" value={album} onChange={(e) => setAlbum(e.target.value)}>
            <option value="">Uten album</option>{albums.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <div className="actions">
          <button type="button" className={`btn small ${confirming ? 'danger-fill' : 'danger-btn ghost'}`} onClick={onDelete}>{confirming ? 'Ja, slett bildet' : 'Slett bildet'}</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={onClose}>Avbryt</button>
          <button className="btn primary">Lagre</button>
        </div>
      </form>
    </div>
  );
}

/* ---------- Hytteregnskap ---------- */
function Ledger({ cabinId, own, ledger, reload, toast, label }: {
  cabinId: string; own: string; ledger: Entry[]; reload: () => Promise<void>; toast: (m: string) => void; label: string;
}) {
  const years = useMemo(() => {
    const s = new Set(ledger.map((x) => Number(x.entry_date.slice(0, 4))));
    s.add(new Date().getFullYear());
    return [...s].sort((a, b) => b - a);
  }, [ledger]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const L = ledger.filter((x) => x.entry_date.startsWith(String(year)));
  const out = L.filter((x) => x.kind === 'ut').reduce((s, x) => s + x.amount, 0);
  const inn = L.filter((x) => x.kind === 'inn').reduce((s, x) => s + x.amount, 0);
  const byCat: Record<string, number> = {};
  L.filter((x) => x.kind === 'ut').forEach((x) => { byCat[x.category] = (byCat[x.category] ?? 0) + x.amount; });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const max = cats[0]?.[1] || 1;
  const receipts = useSignedUrls('hytte', L.map((x) => x.receipt_path).filter(Boolean) as string[]);
  const [lb, setLb] = useState<string | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  function edit(x: Entry) {
    setEditing(x); setConfirmDel(null);
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  }

  async function remove(x: Entry) {
    const { error } = await supabase.from('cabin_ledger').delete().eq('id', x.id);
    setConfirmDel(null);
    if (error) { toast('Posten ble ikke slettet.'); return; }
    if (x.receipt_path) await supabase.storage.from('hytte').remove([x.receipt_path]);
    await reload();
  }

  function exportCsv() {
    const rows = [['Dato', 'Type', 'Beskrivelse', 'Kategori', 'Beløp'], ...[...L].reverse().map((x) => [x.entry_date, x.kind === 'ut' ? 'Utgift' : 'Inntekt', x.description, x.category, (x.kind === 'ut' ? -x.amount : x.amount).toFixed(2).replace('.', ',')])];
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `Hytteregnskap ${label} ${year}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return (
    <>
      <div className="chips" role="group" aria-label="Velg år" style={{ alignItems: 'center' }}>
        {years.map((y) => <button key={y} className={`chip ${y === year ? 'on' : ''}`} onClick={() => setYear(y)}>{y}</button>)}
        {L.length > 0 && <button className="linkbtn2" style={{ marginLeft: 'auto' }} onClick={exportCsv}>Last ned som regneark (CSV)</button>}
      </div>
      <div className="stats">
        <div className="card stat"><div className="l">Utgifter {year}</div><div className="v neg">{kr(out)}</div></div>
        <div className="card stat"><div className="l">Inntekter {year}</div><div className="v pos">{kr(inn)}</div></div>
        <div className="card stat"><div className="l">Netto kostnad</div><div className="v net">{kr(out - inn)}</div></div>
      </div>
      <div className="two">
        <div className="card">
          <h3 className="serif" style={{ margin: '0 0 12px', fontSize: 18 }}>Utgifter per kategori</h3>
          <div className="bars">
            {cats.map(([c, v]) => (
              <div key={c} className="bar"><div className="lab"><span>{c}</span><span className="num">{kr(v)}</span></div>
                <div className="track"><div className="fill" style={{ width: `${(v / max * 100).toFixed(1)}%` }} /></div></div>
            ))}
            {!cats.length && <p className="muted" style={{ margin: 0 }}>Ingen utgifter ført i {year}.</p>}
          </div>
        </div>
        <div ref={formRef}>
          <EntryForm key={editing?.id ?? 'ny'} cabinId={cabinId} own={own} editing={editing} toast={toast}
            onDone={async () => { setEditing(null); await reload(); }} onCancel={() => setEditing(null)} />
        </div>
      </div>
      <div className="card ledgerbox" style={{ marginTop: 16 }}>
        <div className="ledgerbox-h"><b>Bilag {year}</b><span className="muted">{L.length} {L.length === 1 ? 'post' : 'poster'}</span></div>
        <div className="tbl-wrap scrollbox">
          <table>
            <thead><tr><th>Dato</th><th>Beskrivelse</th><th>Kategori</th><th className="r">Beløp</th><th /></tr></thead>
            <tbody>
              {L.map((x) => (
                <tr key={x.id} className={editing?.id === x.id ? 'editing' : ''}>
                  <td className="num">{dShort(x.entry_date)}</td>
                  <td>{x.description}{x.receipt_path && receipts[x.receipt_path] && (
                    <button className="rcptbtn" onClick={() => setLb(receipts[x.receipt_path!])} aria-label="Vis kvittering"><Icon name="photo" size={14} />Kvittering</button>)}</td>
                  <td className="muted">{x.category}</td>
                  <td className={`r num ${x.kind === 'inn' ? 'in' : ''}`}>{x.kind === 'inn' ? '+ ' : '− '}{kr(x.amount)}</td>
                  <td className="r"><span className="rowacts">
                    <button className="linkbtn2" onClick={() => edit(x)} aria-label={`Rediger ${x.description}`}>Rediger</button>
                    {confirmDel === x.id
                      ? <button className="btn small danger-btn" onClick={() => void remove(x)}>Slett</button>
                      : <button className="linkbtn" onClick={() => setConfirmDel(x.id)} aria-label={`Slett ${x.description}`}>Slett</button>}</span></td>
                </tr>
              ))}
              {!L.length && <tr><td colSpan={5} className="muted">Ingen poster i {year}.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {lb && <Lightbox urls={[lb]} start={0} onClose={() => setLb(null)} />}
    </>
  );
}

function EntryForm({ cabinId, own, editing, onDone, onCancel, toast }: {
  cabinId: string; own: string; editing: Entry | null; onDone: () => Promise<void>; onCancel: () => void; toast: (m: string) => void;
}) {
  const [date, setDate] = useState(editing?.entry_date ?? today());
  const [kind, setKind] = useState<'ut' | 'inn'>(editing?.kind ?? 'ut');
  const [text, setText] = useState(editing?.description ?? '');
  const [cat, setCat] = useState(editing?.category ?? CATS[0]);
  const [amount, setAmount] = useState(editing ? String(editing.amount).replace('.', ',') : '');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [dropReceipt, setDropReceipt] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const amt = Number(amount.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(amt) || amt <= 0) { toast('Skriv inn et beløp.'); return; }
    setBusy(true);
    let receipt_path: string | null = null;
    if (receipt) {
      const blob = await shrinkImage(receipt, 2000, 0.85);
      const path = `${own}/kvittering-${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from('hytte').upload(path, blob, { contentType: blob.type || 'image/jpeg' });
      if (up.error) { setBusy(false); toast('Kvitteringen ble ikke lastet opp.'); return; }
      receipt_path = path;
    }
    const fields = { entry_date: date, kind, description: text.trim(), category: cat, amount: amt };
    const old = editing?.receipt_path ?? null;
    const newReceipt = receipt_path ?? (dropReceipt ? null : old);
    const { error } = editing
      ? await supabase.from('cabin_ledger').update({ ...fields, receipt_path: newReceipt }).eq('id', editing.id)
      : await supabase.from('cabin_ledger').insert({ cabin_id: cabinId, ownership_id: own, ...fields, receipt_path });
    setBusy(false);
    if (error) { if (receipt_path) await supabase.storage.from('hytte').remove([receipt_path]); toast('Posten ble ikke lagret.'); return; }
    if (editing && old && old !== newReceipt) await supabase.storage.from('hytte').remove([old]);
    setText(''); setAmount(''); setReceipt(null); if (fileRef.current) fileRef.current.value = '';
    toast(editing ? 'Endringene er lagret.' : 'Posten er ført.');
    await onDone();
  }

  return (
    <div className={`card ${editing ? 'editcard' : ''}`}>
      <h3 className="serif" style={{ margin: '0 0 12px', fontSize: 18 }}>{editing ? 'Rediger post' : 'Før ny post'}</h3>
      <form className="form" style={{ margin: 0 }} onSubmit={submit}>
        <label className="field" htmlFor="lg-date">Dato<input id="lg-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field" htmlFor="lg-kind">Type
          <select id="lg-kind" value={kind} onChange={(e) => { const k = e.target.value as 'ut' | 'inn'; setKind(k); if (k === 'inn') setCat('Utleie'); }}>
            <option value="ut">Utgift</option><option value="inn">Inntekt</option>
          </select></label>
        <label className="field full" htmlFor="lg-text">Beskrivelse<input id="lg-text" type="text" required value={text} onChange={(e) => setText(e.target.value)} placeholder="F.eks. Strøm juli–september" /></label>
        <label className="field" htmlFor="lg-cat">Kategori<select id="lg-cat" value={cat} onChange={(e) => setCat(e.target.value)}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field" htmlFor="lg-amt">Beløp (kr)<input id="lg-amt" type="text" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></label>
        <label className="field full" htmlFor="lg-rcpt">{editing?.receipt_path ? 'Bytt kvittering (valgfritt)' : 'Kvittering (valgfritt)'}
          <input id="lg-rcpt" ref={fileRef} type="file" accept="image/*" onChange={(e) => { setReceipt(e.target.files?.[0] ?? null); setDropReceipt(false); }} />
        </label>
        {editing?.receipt_path && !receipt && (
          <label className="check full"><input type="checkbox" checked={dropReceipt} onChange={(e) => setDropReceipt(e.target.checked)} />Fjern kvitteringen</label>
        )}
        <div className="actions full">
          {editing && <button type="button" className="btn ghost" onClick={onCancel}>Avbryt</button>}
          <button className="btn primary" disabled={busy}>{busy ? 'Lagrer …' : editing ? 'Lagre endringer' : 'Legg til'}</button>
        </div>
      </form>
    </div>
  );
}
