import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { dShort } from '../lib/format';
import { shrinkImage, toDrafts, type Draft } from '../lib/images';
import { Icon } from './Icon';
import { DraftStrip, MessagePhotos } from './Media';

/** Vedlegg i prosjektsamtalen (bilder og filer ligger i bøtta «hytte», mappen <eierperiode>/chat) */
export interface Attachment { path: string; name: string; type: string; size: number }
export interface ProjectMessage {
  id: string; author_id: string | null; body: string; attachments: Attachment[]; created_at: string;
  channel: 'kunde' | 'handverker'; worker_id: string | null;
  fwd_author: string | null; fwd_at: string | null; fwd_from: string | null;
  change_marked_at: string | null; change_marked_by: string | null; change_confirmed_at: string | null; change_confirmed_by: string | null;
}
export interface Participant { id: string; full_name: string; role: 'eier' | 'medarbeider' | 'kjoper'; active: boolean }

export const ROLE_TXT: Record<Participant['role'], string> = { eier: 'Eier', medarbeider: 'Håndverker', kjoper: 'Kjøper' };

/** En tråd: kunden (eier + kjøper), eller én håndverker (eier + håndverkeren) */
interface Thread { key: string; channel: 'kunde' | 'handverker'; worker: string | null; title: string; people: Participant[]; canWrite: boolean; note: string }
const keyOf = (m: { channel: string; worker_id: string | null }) => (m.channel === 'kunde' ? 'kunde' : `h:${m.worker_id}`);

const tm = (d: string) => new Date(d).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
const size = (b: number) => (b > 1_000_000 ? `${(b / 1_000_000).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1000))} kB`);
const safe = (n: string) => n.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(-80);
const COLS = 'id,author_id,body,attachments,created_at,channel,worker_id,fwd_author,fwd_at,fwd_from,change_marked_at,change_marked_by,change_confirmed_at,change_confirmed_by';

async function openFile(path: string, toast: (m: string) => void) {
  const w = window.open('', '_blank');
  const { data, error } = await supabase.storage.from('hytte').createSignedUrl(path, 600);
  if (error || !data) { w?.close(); toast('Filen kunne ikke åpnes.'); return; }
  if (w) w.location.href = data.signedUrl; else window.location.href = data.signedUrl;
}

export function ProjectChat({ own, uid, participants, open, toast, onChange }: {
  own: string; uid: string; participants: Participant[]; open: boolean; toast: (m: string) => void; onChange?: () => void;
}) {
  const [msgs, setMsgs] = useState<ProjectMessage[] | null>(null);
  const [text, setText] = useState('');
  const [images, setImages] = useState<Draft[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState('');
  const [only, setOnly] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[] | null>(null);   // valgte meldinger for videresending
  const [fwdTo, setFwdTo] = useState('');
  const box = useRef<HTMLDivElement>(null);

  const names = Object.fromEntries(participants.map((p) => [p.id, p.full_name]));
  const roleOf = Object.fromEntries(participants.map((p) => [p.id, p.role]));
  const myRole = roleOf[uid] ?? 'eier';
  const isOwner = myRole === 'eier';
  const owners = participants.filter((p) => p.role === 'eier');
  const buyers = participants.filter((p) => p.role === 'kjoper');
  const crafts = participants.filter((p) => p.role === 'medarbeider');

  const load = useCallback(async () => {
    const { data } = await supabase.from('project_messages').select(COLS).eq('ownership_id', own).order('created_at');
    setMsgs(((data ?? []) as ProjectMessage[]).map((m) => ({ ...m, channel: m.channel ?? 'kunde', worker_id: m.worker_id ?? null })));
  }, [own]);
  useEffect(() => {
    void load();
    const i = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 20_000);
    return () => window.clearInterval(i);
  }, [load]);

  // Trådene jeg har tilgang til
  const threads = useMemo<Thread[]>(() => {
    const list: Thread[] = [];
    const seen = new Set((msgs ?? []).map(keyOf));
    if (isOwner || myRole === 'kjoper') {
      if (buyers.length || seen.has('kunde') || myRole === 'kjoper') list.push({
        key: 'kunde', channel: 'kunde', worker: null,
        title: isOwner ? `Kjøper${buyers.length ? `: ${buyers.map((b) => b.full_name).join(', ')}` : ''}` : 'Samtale med utbygger',
        people: [...owners, ...buyers], canWrite: isOwner || myRole === 'kjoper',
        note: isOwner ? 'Samtale med kjøperen. Håndverkerne ser ikke denne.' : 'Samtale mellom deg og utbyggeren.',
      });
    }
    if (isOwner) {
      for (const c of crafts) list.push({
        key: `h:${c.id}`, channel: 'handverker', worker: c.id, title: c.full_name, people: [...owners, c], canWrite: c.active,
        note: c.active ? `Samtale med ${c.full_name}. Kjøperen og de andre håndverkerne ser ikke denne.`
          : `${c.full_name} har ikke logget inn ennå. Du kan skrive når hen har logget inn første gang.`,
      });
      // Tidligere håndverkere som har meldinger
      for (const k of seen) if (k.startsWith('h:') && !list.some((t) => t.key === k)) {
        const id = k.slice(2);
        list.push({ key: k, channel: 'handverker', worker: id, title: `${names[id] ?? 'Tidligere håndverker'}`, people: owners, canWrite: false, note: 'Håndverkeren er ikke lenger på prosjektet.' });
      }
    }
    if (myRole === 'medarbeider') list.push({
      key: `h:${uid}`, channel: 'handverker', worker: uid, title: 'Samtale med utbygger', people: [...owners, ...crafts.filter((c) => c.id === uid)], canWrite: true,
      note: 'Samtale mellom deg og utbyggeren. Kjøperen ser ikke denne.',
    });
    return list;
  }, [msgs, isOwner, myRole, buyers, owners, crafts, names, uid]);

  const [sel, setSel] = useState<string>('');
  const thread = threads.find((t) => t.key === sel) ?? threads[0];
  useEffect(() => { setOnly(false); setPicked(null); setMenu(null); }, [thread?.key]);

  const inThread = (msgs ?? []).filter((m) => thread && keyOf(m) === thread.key);
  const changes = inThread.filter((m) => m.change_marked_at);
  const shown = only ? changes : inThread;
  const count = (k: string) => (msgs ?? []).filter((m) => keyOf(m) === k).length;

  // Rull til siste melding inne i samtalen (ikke hele siden)
  useLayoutEffect(() => { const b = box.current; if (b && !only) b.scrollTop = b.scrollHeight; }, [inThread.length, only, thread?.key]);

  function pickImages(list: FileList | null) {
    const { drafts, skipped } = toDrafts(list, images.length);
    setImages((d) => [...d, ...drafts]);
    if (skipped) toast('Du kan sende opptil 10 bilder om gangen.');
  }
  function pickFiles(list: FileList | null) {
    const add = [...(list ?? [])];
    const big = add.filter((f) => f.size > 25_000_000);
    if (big.length) toast(`${big.map((f) => f.name).join(', ')} er for stor (over 25 MB).`);
    setFiles((f) => [...f, ...add.filter((x) => x.size <= 25_000_000)].slice(0, 10));
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!thread) return;
    const body = text.trim();
    if (!body && !images.length && !files.length) return;
    setBusy('Sender …');
    const done: Attachment[] = [];
    try {
      for (const d of images) {
        const blob = await shrinkImage(d.file);
        const path = `${own}/chat/${crypto.randomUUID()}.jpg`;
        const { error } = await supabase.storage.from('hytte').upload(path, blob, { contentType: blob.type || 'image/jpeg' });
        if (error) throw error;
        done.push({ path, name: d.file.name, type: 'image/jpeg', size: blob.size });
      }
      for (const f of files) {
        const path = `${own}/chat/${crypto.randomUUID()}-${safe(f.name)}`;
        const { error } = await supabase.storage.from('hytte').upload(path, f, { contentType: f.type || 'application/octet-stream' });
        if (error) throw error;
        done.push({ path, name: f.name, type: f.type || 'application/octet-stream', size: f.size });
      }
    } catch {
      if (done.length) await supabase.storage.from('hytte').remove(done.map((a) => a.path));
      setBusy(''); toast('Vedleggene ble ikke lastet opp. Sjekk nettet og prøv igjen.'); return;
    }
    const { error } = await supabase.from('project_messages').insert({
      ownership_id: own, body, attachments: done, channel: thread.channel, worker_id: thread.worker,
    });
    setBusy('');
    if (error) {
      if (done.length) await supabase.storage.from('hytte').remove(done.map((a) => a.path));
      toast('Meldingen ble ikke sendt. Prøv igjen.'); return;
    }
    images.forEach((d) => URL.revokeObjectURL(d.url));
    setText(''); setImages([]); setFiles([]);
    await load(); onChange?.();
  }

  // Videresend valgte meldinger (med vedlegg) til en annen tråd. Vedleggene deles, de kopieres ikke.
  async function forward() {
    const target = threads.find((t) => t.key === fwdTo);
    if (!thread || !target || !picked?.length) return;
    setBusy('Videresender …');
    const rows = inThread.filter((m) => picked.includes(m.id)).map((m) => ({
      ownership_id: own, channel: target.channel, worker_id: target.worker, body: m.body, attachments: m.attachments,
      fwd_author: m.fwd_author ?? (m.author_id === uid ? names[uid] ?? 'Eier' : (m.author_id && names[m.author_id]) || 'Tidligere deltaker'),
      fwd_at: m.fwd_at ?? m.created_at,
      fwd_from: m.fwd_from ?? (thread.channel === 'kunde' ? 'samtalen med kjøper' : `samtalen med ${thread.title}`),
    }));
    const { error } = await supabase.from('project_messages').insert(rows);
    setBusy('');
    if (error) { toast('Meldingene ble ikke videresendt. Prøv igjen.'); return; }
    toast(`${rows.length} ${rows.length === 1 ? 'melding' : 'meldinger'} videresendt til ${target.title}.`);
    setPicked(null); setFwdTo('');
    await load(); setSel(target.key); onChange?.();
  }

  async function mark(m: ProjectMessage, on: boolean) {
    setMenu(null);
    const { error } = await supabase.rpc('project_mark_change', { p_msg: m.id, p_on: on });
    if (error) { toast('Endringen ble ikke lagret.'); return; }
    toast(on ? 'Merket som avtalt endring. Kjøperen kan bekrefte den.' : 'Merket er fjernet.');
    await load();
  }
  async function confirm(m: ProjectMessage) {
    const { error } = await supabase.rpc('project_confirm_change', { p_msg: m.id });
    if (error) { toast('Bekreftelsen ble ikke lagret.'); return; }
    toast('Takk! Endringen er bekreftet.');
    await load();
  }
  async function remove(m: ProjectMessage) {
    setMenu(null);
    const { error } = await supabase.from('project_messages').delete().eq('id', m.id);
    if (error) { toast('Meldingen ble ikke slettet.'); return; }
    // Vedlegg fra videresendte meldinger kan være i bruk andre steder
    if (m.attachments.length && !m.fwd_author && !(msgs ?? []).some((x) => x.id !== m.id && x.attachments.some((a) => m.attachments.some((b) => b.path === a.path)))) {
      await supabase.storage.from('hytte').remove(m.attachments.map((a) => a.path));
    }
    await load();
  }

  const who = (id: string | null) => (id === uid ? 'Du' : (id && names[id]) || 'Tidligere deltaker');
  if (!thread) return <div className="empty">Ingen samtaler ennå. Legg til kjøper eller håndverkere på prosjektet under Administrasjon → Prosjektmedarbeidere.</div>;
  const kunde = thread.channel === 'kunde';
  const canWrite = open && thread.canWrite;
  const others = threads.filter((t) => t.key !== thread.key && t.canWrite);

  return (
    <>
      {threads.length > 1 && (
        <div className="threadtabs" role="tablist" aria-label="Velg samtale">
          {threads.map((t) => (
            <button key={t.key} role="tab" aria-selected={t.key === thread.key} className={`threadtab ${t.key === thread.key ? 'on' : ''} ${t.channel}`} onClick={() => setSel(t.key)}>
              <span className="tt-role">{t.channel === 'kunde' ? 'Kunde' : 'Håndverker'}</span>
              <b>{t.channel === 'kunde' ? (buyers.map((b) => b.full_name).join(', ') || 'Kjøper') : t.title}</b>
              <small>{count(t.key)} {count(t.key) === 1 ? 'melding' : 'meldinger'}{t.canWrite ? '' : ' · venter'}</small>
            </button>
          ))}
        </div>
      )}
      <div className={`card convo pchat ${kunde ? 'ch-kunde' : 'ch-handverker'}`}>
        <div className="pchat-h">
          <div className="pchat-who">
            {thread.people.map((p) => (
              <span key={p.id} className={`ppl r-${p.role} ${p.active ? '' : 'wait'}`} title={p.active ? '' : 'Har ikke logget inn ennå'}>
                {p.id === uid ? 'Du' : p.full_name} <small>{ROLE_TXT[p.role]}</small>
              </span>
            ))}
          </div>
          <div className="pchat-note"><Icon name="lock" size={14} />{thread.note}</div>
          <div className="pchat-tools">
            {kunde && (
              <div className="chips" style={{ margin: 0 }}>
                <button className={`chip ${!only ? 'on' : ''}`} onClick={() => setOnly(false)}>Alle</button>
                <button className={`chip ${only ? 'on' : ''}`} onClick={() => setOnly(true)}>Avtalte endringer ({changes.length})</button>
              </div>
            )}
            {isOwner && open && others.length > 0 && inThread.length > 0 && (
              picked === null
                ? <button className="btn small ghost" onClick={() => setPicked([])}><Icon name="send" size={15} />Videresend …</button>
                : <button className="btn small ghost" onClick={() => setPicked(null)}>Avbryt videresending</button>
            )}
          </div>
        </div>
        {!open && <div className="pchat-closed"><Icon name="lock" size={15} />Hytta er overlevert. Samtalen er lagret som historikk og kan ikke endres.</div>}
        {picked !== null && (
          <div className="fwdbar">
            <span>{picked.length ? `${picked.length} valgt` : 'Trykk på meldingene du vil videresende'}</span>
            <select value={fwdTo} onChange={(e) => setFwdTo(e.target.value)} aria-label="Videresend til">
              <option value="">Videresend til …</option>
              {others.map((t) => <option key={t.key} value={t.key}>{t.channel === 'kunde' ? `Kjøper (${buyers.map((b) => b.full_name).join(', ')})` : `${t.title} (håndverker)`}</option>)}
            </select>
            <button className="btn small primary" disabled={!picked.length || !fwdTo || !!busy} onClick={() => void forward()}>{busy || 'Videresend'}</button>
          </div>
        )}
        <div className="bubbles" ref={box}>
          {msgs === null && <p className="muted">Henter …</p>}
          {msgs && !shown.length && (
            <p className="muted" style={{ margin: 'auto', textAlign: 'center', maxWidth: 420 }}>
              {only ? 'Ingen meldinger er merket som avtalt endring ennå. Trykk ⋯ på en melding for å merke den.'
                : 'Ingen meldinger ennå. Del løsninger, bilder og PDF-er her.'}
            </p>
          )}
          {shown.map((m) => {
            const me = m.author_id === uid;
            const imgs = m.attachments.filter((a) => a.type.startsWith('image/'));
            const docs = m.attachments.filter((a) => !a.type.startsWith('image/'));
            const isPicked = picked?.includes(m.id) ?? false;
            return (
              <div key={m.id} className={`bub ${me ? 'mine' : ''} ${m.change_marked_at ? 'agreed' : ''} ${picked !== null ? 'pickable' : ''} ${isPicked ? 'picked' : ''}`}
                onClick={picked !== null ? () => setPicked((p) => (p ?? []).includes(m.id) ? (p ?? []).filter((x) => x !== m.id) : [...(p ?? []), m.id]) : undefined}
                role={picked !== null ? 'checkbox' : undefined} aria-checked={picked !== null ? isPicked : undefined}>
                {picked !== null && <span className="pickbox">{isPicked && <Icon name="check" size={14} />}</span>}
                {!me && <b className="bwho">{who(m.author_id)}{m.author_id && roleOf[m.author_id] ? <small> · {ROLE_TXT[roleOf[m.author_id]]}</small> : null}</b>}
                {m.fwd_author && (
                  <div className="fwdtag">↪ Videresendt fra {m.fwd_from ?? 'en annen samtale'} · {m.fwd_author}{m.fwd_at ? `, ${dShort(m.fwd_at)} ${tm(m.fwd_at)}` : ''}</div>
                )}
                {m.change_marked_at && (
                  <div className="agreetag">
                    <Icon name="check" size={14} />Avtalt endring
                    {m.change_confirmed_at
                      ? <span> · bekreftet av {m.change_confirmed_by === uid ? 'deg' : who(m.change_confirmed_by)} {dShort(m.change_confirmed_at)}</span>
                      : <span> · venter på kjøper</span>}
                  </div>
                )}
                {imgs.length > 0 && <MessagePhotos bucket="hytte" paths={imgs.map((a) => a.path)} />}
                {docs.map((a) => (
                  <button key={a.path} className="battach" onClick={(e) => { if (picked !== null) return; e.stopPropagation(); void openFile(a.path, toast); }}>
                    <span className="ftag">{(a.name.split('.').pop() || 'FIL').toUpperCase().slice(0, 4)}</span>
                    <span><b>{a.name}</b><small>{size(a.size)}</small></span>
                  </button>
                ))}
                {m.body && <span style={{ whiteSpace: 'pre-line' }}>{m.body}</span>}
                <small>{me ? 'Du · ' : ''}{dShort(m.created_at)} {tm(m.created_at)}</small>
                {open && kunde && myRole === 'kjoper' && m.change_marked_at && !m.change_confirmed_at && picked === null && (
                  <button className="btn small primary agreebtn" onClick={() => void confirm(m)}>Bekreft endringen</button>
                )}
                {open && picked === null && ((kunde && isOwner) || me) && (
                  <button className="bmore" aria-label="Valg for meldingen" onClick={() => setMenu(menu === m.id ? null : m.id)}><Icon name="more" size={16} /></button>
                )}
                {open && menu === m.id && (
                  <div className="bmenu">
                    {kunde && isOwner && !m.change_confirmed_at && (m.change_marked_at
                      ? <button onClick={() => void mark(m, false)}>Fjern «avtalt endring»</button>
                      : <button onClick={() => void mark(m, true)}>Merk som avtalt endring</button>)}
                    {me && !m.change_marked_at && <button className="danger" onClick={() => void remove(m)}>Slett meldingen</button>}
                    {m.change_confirmed_at && <span className="muted">Bekreftet – kan ikke endres</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {canWrite && picked === null && (
          <form className="composer" onSubmit={send}>
            <DraftStrip drafts={images} className="mdrafts" onRemove={(k) => setImages((d) => d.filter((x) => x.key !== k))} />
            {files.length > 0 && (
              <div className="mfiles">
                {files.map((f, i) => (
                  <span key={i} className="mfile">{f.name}<button type="button" aria-label={`Fjern ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button></span>
                ))}
              </div>
            )}
            <label className="cambtn" title="Legg ved bilde" aria-label="Legg ved bilde">
              <Icon name="camera" size={22} />
              <input type="file" accept="image/*" multiple hidden onChange={(e) => { pickImages(e.target.files); e.target.value = ''; }} />
            </label>
            <label className="cambtn" title="Legg ved PDF eller annen fil" aria-label="Legg ved PDF eller annen fil">
              <Icon name="doc" size={22} />
              <input type="file" accept=".pdf,application/pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf,.txt" multiple hidden onChange={(e) => { pickFiles(e.target.files); e.target.value = ''; }} />
            </label>
            <textarea value={text} onChange={(e) => setText(e.target.value)}
              placeholder={kunde ? (isOwner ? 'Skriv til kjøperen' : 'Skriv til utbyggeren') : isOwner ? `Skriv til ${thread.title}` : 'Skriv til utbyggeren'} aria-label="Skriv en melding" />
            <button className="btn primary" disabled={!!busy || (!text.trim() && !images.length && !files.length)} aria-label="Send">
              {busy ? '…' : <Icon name="send" size={18} />}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
