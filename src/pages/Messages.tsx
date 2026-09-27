import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useMe } from '../lib/session';
import { useToast } from '../lib/ui';
import { dShort } from '../lib/format';
import { nameOf, placeOf, useDirectory, type Directory } from '../lib/people';
import { toDrafts, uploadImages, MAX_IMAGES, type Draft } from '../lib/images';
import { DraftStrip, MessagePhotos } from '../components/Media';
import { Icon } from '../components/Icon';
import type { AppRole } from '../lib/types';

type Recipient = 'grunneier' | 'vel' | 'vei';
export const RECIPIENT_LABEL: Record<Recipient, string> = { grunneier: 'Grunneier', vel: 'Styret i Mørvika Vel', vei: 'Styret i Mørvikveien Veilag' };
const TO_TEXT: Record<Recipient, string> = { grunneier: 'grunneier', vel: 'styret i Mørvika Vel', vei: 'styret i Mørvikveien Veilag' };
const RECIPIENT_HELP: Record<Recipient, string> = {
  grunneier: 'Tomt, feste, trær, grenser og byggesaker',
  vel: 'Fellesarealer, badeplass, arrangementer',
  vei: 'Vei, brøyting, grøfter og bommer',
};

interface Thread { id: string; owner_id: string; recipient: Recipient; subject: string; created_at: string; last_message_at: string }
interface Message { id: string; thread_id: string; author_id: string; body: string; images: string[]; created_at: string }

const tm = (d: string) => new Date(d).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
const when = (d: string) => (new Date(d).toDateString() === new Date().toDateString() ? tm(d) : dShort(d));
const snip = (m?: Message) => (m ? m.body || (m.images.length ? `Bilde (${m.images.length})` : '') : '');

/** Mottakere brukeren selv tar imot meldinger for */
export function handles(roles: AppRole[]): Recipient[] {
  const r: Recipient[] = [];
  if (roles.includes('grunneier')) r.push('grunneier', 'vel', 'vei'); // grunneier leser alt til styrene
  if (roles.includes('styre_vel') && !r.includes('vel')) r.push('vel');
  if (roles.includes('styre_vei') && !r.includes('vei')) r.push('vei');
  return r;
}

/** Antall samtaler med noe nytt (til startsiden) */
export async function countUnreadThreads(uid: string): Promise<number> {
  const [t, r] = await Promise.all([
    supabase.from('threads').select('id,last_message_at').order('last_message_at', { ascending: false }).limit(100),
    supabase.from('thread_reads').select('thread_id,read_at').eq('user_id', uid),
  ]);
  const read = new Map((r.data ?? []).map((x) => [x.thread_id as string, x.read_at as string]));
  const cand = ((t.data ?? []) as { id: string; last_message_at: string }[]).filter((x) => !read.has(x.id) || read.get(x.id)! < x.last_message_at);
  if (!cand.length) return 0;
  // Bare tell samtaler der siste melding er fra noen andre
  const m = await supabase.from('messages').select('thread_id,author_id,created_at').in('thread_id', cand.map((x) => x.id)).order('created_at', { ascending: false });
  const last = new Map<string, string>();
  for (const x of (m.data ?? []) as { thread_id: string; author_id: string }[]) if (!last.has(x.thread_id)) last.set(x.thread_id, x.author_id);
  return cand.filter((x) => last.get(x.id) && last.get(x.id) !== uid).length;
}

export function MessagesPage() {
  const me = useMe();
  const toast = useToast();
  const dir = useDirectory();
  const uid = me.session?.user.id ?? '';
  const mine = handles(me.roles);
  const canStart = me.isResident || me.veilagOnly;
  const choices: Recipient[] = me.veilagOnly ? ['vei'] : ['grunneier', 'vel', 'vei'];

  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [lastMsg, setLastMsg] = useState<Record<string, Message>>({});
  const [reads, setReads] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [filter, setFilter] = useState<'alle' | 'mine' | Recipient>('alle');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, r] = await Promise.all([
      supabase.from('threads').select('id,owner_id,recipient,subject,created_at,last_message_at').order('last_message_at', { ascending: false }).limit(200),
      supabase.from('thread_reads').select('thread_id,read_at').eq('user_id', uid),
    ]);
    if (t.error) { setErr('Meldingene kunne ikke hentes. Sjekk nettet og prøv igjen.'); return; }
    setErr(null);
    const list = (t.data ?? []) as Thread[];
    setThreads(list);
    setReads(Object.fromEntries((r.data ?? []).map((x) => [x.thread_id as string, x.read_at as string])));
    if (list.length) {
      const m = await supabase.from('messages').select('id,thread_id,author_id,body,images,created_at').in('thread_id', list.map((x) => x.id)).order('created_at', { ascending: false }).limit(400);
      const last: Record<string, Message> = {};
      for (const x of (m.data ?? []) as Message[]) last[x.thread_id] ??= x;
      setLastMsg(last);
    }
  }, [uid]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVis);
    const t = window.setInterval(onVis, 45_000);
    return () => { document.removeEventListener('visibilitychange', onVis); window.clearInterval(t); };
  }, [load]);

  const isUnread = (t: Thread) => {
    const lm = lastMsg[t.id];
    return !!lm && lm.author_id !== uid && (!reads[t.id] || reads[t.id] < t.last_message_at);
  };
  const counterpart = (t: Thread) => t.owner_id === uid
    ? RECIPIENT_LABEL[t.recipient]
    : `${nameOf(dir, t.owner_id)}${placeOf(dir.get(t.owner_id)) ? ` · ${placeOf(dir.get(t.owner_id))}` : ''}`;

  const shown = (threads ?? []).filter((t) => filter === 'alle' || (filter === 'mine' ? t.owner_id === uid : t.recipient === filter && t.owner_id !== uid));
  const open = (threads ?? []).find((t) => t.id === openId) ?? null;
  const filters: ['alle' | 'mine' | Recipient, string][] = mine.length
    ? [['alle', 'Alle'], ...mine.map((r) => [r, r === 'grunneier' ? 'Til grunneier' : r === 'vel' ? 'Til Velet' : 'Til Veilaget'] as [Recipient, string]), ['mine', 'Sendt av meg']]
    : [];

  function markRead(id: string) {
    const now = new Date().toISOString();
    setReads((r) => ({ ...r, [id]: now }));
    void supabase.from('thread_reads').upsert({ thread_id: id, read_at: now }, { onConflict: 'thread_id,user_id' })
      .then(() => window.dispatchEvent(new Event('messages-changed')));
  }

  return (
    <>
      <p className={`lede msg-lede ${open || composing ? 'hide-phone' : ''}`} style={{ marginBottom: 14 }}>
        {mine.length
          ? 'Meldinger fra hytteeierne til deg og styrene du er med i. Bare de som er med i samtalen ser den.'
          : me.veilagOnly
            ? 'Private meldinger til styret i Mørvikveien Veilag. Meldingene leses av styret og grunneier.'
            : 'Private meldinger til grunneier eller styrene. Meldinger til styrene leses også av grunneier, så ingen henvendelse blir liggende.'}
      </p>
      {filters.length > 0 && (
        <div className={`chips msg-lede ${open || composing ? 'hide-phone' : ''}`} role="group" aria-label="Filtrer samtaler">
          {filters.map(([k, t]) => <button key={k} className={`chip ${filter === k ? 'on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{t}</button>)}
        </div>
      )}
      {err && <div className="empty">{err} <button className="linkbtn2" onClick={() => void load()}>Prøv igjen</button></div>}

      <div className={`split ${open || composing ? 'has-open' : ''}`}>
        <div className="card threads threads-card">
          {canStart && <button className="btn primary" style={{ margin: '6px 6px 8px' }} onClick={() => { setComposing(true); setOpenId(null); }}><Icon name="plus" size={18} />Ny melding</button>}
          {threads === null && !err && <p className="muted" style={{ padding: 10 }}>Henter …</p>}
          {shown.map((t) => (
            <button key={t.id} className={`thread ${t.id === openId ? 'on' : ''} ${isUnread(t) ? 'unread' : ''}`}
              onClick={() => { setOpenId(t.id); setComposing(false); markRead(t.id); }}>
              <b>{t.owner_id === uid ? RECIPIENT_LABEL[t.recipient] : nameOf(dir, t.owner_id)}</b><span className="t">{when(t.last_message_at)}</span>
              {t.owner_id !== uid && <span className="s">{[placeOf(dir.get(t.owner_id)), mine.length > 1 ? `Til ${TO_TEXT[t.recipient]}` : ''].filter(Boolean).join(' · ')}</span>}
              <span className="subj">{t.subject}</span>
              <span className="s">{lastMsg[t.id]?.author_id === uid ? 'Du: ' : ''}{snip(lastMsg[t.id])}</span>
            </button>
          ))}
          {threads !== null && shown.length === 0 && <p className="muted" style={{ padding: 10 }}>Ingen samtaler ennå.</p>}
        </div>

        {composing ? (
          <NewThread choices={choices} onCancel={() => setComposing(false)}
            onSent={(id) => { setComposing(false); setOpenId(id); markRead(id); void load(); }} />
        ) : open ? (
          <Conversation key={open.id} t={open} dir={dir} uid={uid} title={counterpart(open)}
            onBack={() => setOpenId(null)} onSent={() => { markRead(open.id); void load(); }} toast={toast} />
        ) : (
          <div className="card convo"><div className="empty" style={{ margin: 'auto', border: 0 }}>
            Velg en samtale{canStart ? ', eller trykk «Ny melding»' : ''}.
          </div></div>
        )}
      </div>
    </>
  );
}

/* ---------- Én samtale ---------- */
function Conversation({ t, dir, uid, title, onBack, onSent, toast }: {
  t: Thread; dir: Directory; uid: string; title: string; onBack: () => void; onSent: () => void; toast: (m: string) => void;
}) {
  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('messages').select('id,thread_id,author_id,body,images,created_at').eq('thread_id', t.id).order('created_at');
    setMsgs((data ?? []) as Message[]);
  }, [t.id]);
  useEffect(() => { void load(); const i = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 20_000); return () => window.clearInterval(i); }, [load]);
  useLayoutEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs?.length]);

  function pick(files: FileList | null) {
    const { drafts: add, skipped } = toDrafts(files, drafts.length);
    setDrafts((d) => [...d, ...add]);
    if (skipped) toast(`Du kan sende opptil ${MAX_IMAGES} bilder om gangen.`);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body && !drafts.length) return;
    setBusy(true);
    let images: string[] = [];
    try { if (drafts.length) images = await uploadImages('meldinger', t.id, drafts); }
    catch { setBusy(false); toast('Bildene ble ikke lastet opp. Sjekk nettet og prøv igjen.'); return; }
    const { error } = await supabase.from('messages').insert({ thread_id: t.id, body, images });
    setBusy(false);
    if (error) { toast('Meldingen ble ikke sendt. Prøv igjen.'); return; }
    setText(''); setDrafts([]);
    await load();
    onSent();
  }

  return (
    <div className="card convo">
      <div className="convo-h">
        <button className="btn ghost small back" onClick={onBack} aria-label="Tilbake til samtalene"><Icon name="back" size={18} /></button>
        <div style={{ minWidth: 0 }}><h3 className="serif">{t.subject}</h3><div className="muted" style={{ fontSize: 13 }}>{title}</div></div>
      </div>
      <div className="bubbles">
        {msgs === null && <p className="muted">Henter …</p>}
        {msgs?.map((m) => {
          const me = m.author_id === uid;
          return (
            <div key={m.id} className={`bub ${me ? 'mine' : ''}`}>
              {m.images.length > 0 && <MessagePhotos bucket="meldinger" paths={m.images} />}
              {m.body && <span style={{ whiteSpace: 'pre-line' }}>{m.body}</span>}
              <small>{me ? 'Du' : nameOf(dir, m.author_id)} · {dShort(m.created_at)} {tm(m.created_at)}</small>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={send}>
        <DraftStrip drafts={drafts} className="mdrafts" onRemove={(k) => setDrafts((d) => d.filter((x) => x.key !== k))} />
        <label className="cambtn" title="Legg ved bilde" aria-label="Legg ved bilde">
          <Icon name="camera" size={22} />
          <input type="file" accept="image/*" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
        </label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Skriv et svar" aria-label="Skriv et svar" />
        <button className="btn primary" disabled={busy || (!text.trim() && !drafts.length)} aria-label="Send">
          {busy ? '…' : <Icon name="send" size={18} />}
        </button>
      </form>
    </div>
  );
}

/* ---------- Ny samtale ---------- */
function NewThread({ choices, onCancel, onSent }: { choices: Recipient[]; onCancel: () => void; onSent: (id: string) => void }) {
  const toast = useToast();
  const [to, setTo] = useState<Recipient>(choices[0]);
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);

  function pick(files: FileList | null) {
    const { drafts: add, skipped } = toDrafts(files, drafts.length);
    setDrafts((d) => [...d, ...add]);
    if (skipped) toast(`Du kan sende opptil ${MAX_IMAGES} bilder om gangen.`);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!subject.trim() || (!text.trim() && !drafts.length)) return;
    setBusy(true);
    const { data, error } = await supabase.from('threads').insert({ recipient: to, subject: subject.trim() }).select('id').single();
    if (error || !data) { setBusy(false); toast('Meldingen ble ikke sendt. Prøv igjen.'); return; }
    const id = data.id as string;
    let images: string[] = [];
    try { if (drafts.length) images = await uploadImages('meldinger', id, drafts); }
    catch { toast('Bildene ble ikke lastet opp. Meldingen sendes uten bilder, du kan legge dem til i samtalen.'); }
    const { error: e2 } = await supabase.from('messages').insert({ thread_id: id, body: text.trim(), images });
    setBusy(false);
    if (e2) { toast('Meldingen ble ikke sendt. Prøv igjen.'); return; }
    toast(`Meldingen er sendt til ${TO_TEXT[to]}.`);
    onSent(id);
  }

  return (
    <div className="card convo">
      <div className="convo-h">
        <button className="btn ghost small back" onClick={onCancel} aria-label="Tilbake"><Icon name="back" size={18} /></button>
        <h3 className="serif">Ny melding</h3>
      </div>
      <form className="form" style={{ padding: 18, margin: 0 }} onSubmit={submit}>
        {choices.length > 1 ? (
          <div className="field full">Til
            <div className="tochoice">
              {choices.map((r) => (
                <label key={r} className={`tobtn ${to === r ? 'on' : ''}`}>
                  <input type="radio" name="to" value={r} checked={to === r} onChange={() => setTo(r)} />
                  <b>{RECIPIENT_LABEL[r]}</b><small>{RECIPIENT_HELP[r]}</small>
                </label>
              ))}
            </div>
          </div>
        ) : <p className="full" style={{ margin: 0 }}>Til: <b>{RECIPIENT_LABEL[to]}</b></p>}
        <label className="field full" htmlFor="nt-subject">Emne
          <input id="nt-subject" type="text" required maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="F.eks. Felling av to furuer" />
        </label>
        <label className="field full" htmlFor="nt-text">Melding
          <textarea id="nt-text" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="full photorow">
          <label className="cambtn" title="Legg ved bilde" aria-label="Legg ved bilde">
            <Icon name="camera" size={22} />
            <input type="file" accept="image/*" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
          </label>
          <span className="muted" style={{ fontSize: 14 }}>Legg ved bilder, for eksempel av trær, skader eller grenser</span>
        </div>
        {drafts.length > 0 && <div className="full"><DraftStrip drafts={drafts} className="mdrafts" onRemove={(k) => setDrafts((d) => d.filter((x) => x.key !== k))} /></div>}
        <div className="actions full">
          <button type="button" className="btn ghost" onClick={onCancel}>Avbryt</button>
          <button className="btn primary" disabled={busy || !subject.trim() || (!text.trim() && !drafts.length)}>
            <Icon name="send" size={16} />{busy ? 'Sender …' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
