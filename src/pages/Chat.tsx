import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useMe } from '../lib/session';
import { useToast } from '../lib/ui';
import { rel, firstName } from '../lib/format';
import { initials, nameOf, placeOf, useDirectory, type Directory } from '../lib/people';
import { toDrafts, uploadImages, MAX_IMAGES, type Draft } from '../lib/images';
import { DraftStrip, PhotoGrid } from '../components/Media';
import { Icon } from '../components/Icon';

type Group = 'generelt' | 'kjop' | 'hjelp';
const GROUPS: Record<Group, string> = { generelt: 'Generelt', kjop: 'Kjøp og salg', hjelp: 'Dugnad og hjelp' };
const PAGE = 30;

interface Post { id: string; author_id: string; grp: Group; body: string; images: string[]; created_at: string }
interface Comment { id: string; post_id: string; author_id: string; body: string; created_at: string }

/** Når brukeren sist var i Hyttepraten, for «3 nye» på startsiden */
export const PRATEN_SEEN = 'praten-seen';
export function markPratenSeen() {
  try { localStorage.setItem(PRATEN_SEEN, new Date().toISOString()); } catch { /* privat modus */ }
  window.dispatchEvent(new Event('badges-refresh'));
}

export function ChatPage() {
  const me = useMe();
  const toast = useToast();
  const dir = useDirectory();
  const uid = me.session?.user.id ?? '';
  const isAdmin = me.roles.includes('admin');

  const [posts, setPosts] = useState<Post[] | null>(null);
  const [likes, setLikes] = useState<Record<string, string[]>>({});
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [group, setGroup] = useState<Group | 'alle'>('alle');
  const [limit, setLimit] = useState(PAGE);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    let q = supabase.from('posts').select('id,author_id,grp,body,images,created_at').order('created_at', { ascending: false }).limit(limit + 1);
    if (group !== 'alle') q = q.eq('grp', group);
    const { data, error } = await q;
    if (error) { setErr('Hyttepraten kunne ikke hentes. Sjekk nettet og prøv igjen.'); return; }
    setErr(null);
    const list = (data ?? []) as Post[];
    setMore(list.length > limit);
    const page = list.slice(0, limit);
    const ids = page.map((p) => p.id);
    if (ids.length) {
      const [l, c] = await Promise.all([
        supabase.from('post_likes').select('post_id,user_id').in('post_id', ids),
        supabase.from('post_comments').select('id,post_id,author_id,body,created_at').in('post_id', ids).order('created_at'),
      ]);
      const lk: Record<string, string[]> = {};
      for (const x of (l.data ?? []) as { post_id: string; user_id: string }[]) (lk[x.post_id] ??= []).push(x.user_id);
      const cm: Record<string, Comment[]> = {};
      for (const x of (c.data ?? []) as Comment[]) (cm[x.post_id] ??= []).push(x);
      setLikes(lk); setComments(cm);
    }
    setPosts(page);
    markPratenSeen();
  }, [group, limit]);

  useEffect(() => { void load(); }, [load]);
  // Hent nytt når appen kommer i forgrunnen igjen, og hvert minutt mens den er åpen
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVis);
    const t = window.setInterval(onVis, 60_000);
    return () => { document.removeEventListener('visibilitychange', onVis); window.clearInterval(t); };
  }, [load]);

  async function toggleLike(p: Post) {
    const liked = (likes[p.id] ?? []).includes(uid);
    setLikes((x) => ({ ...x, [p.id]: liked ? (x[p.id] ?? []).filter((u) => u !== uid) : [...(x[p.id] ?? []), uid] }));
    const { error } = liked
      ? await supabase.from('post_likes').delete().eq('post_id', p.id).eq('user_id', uid)
      : await supabase.from('post_likes').insert({ post_id: p.id });
    if (error && error.code !== '23505') { toast('Det gikk ikke. Prøv igjen.'); void load(); }
  }

  async function addComment(p: Post, body: string) {
    const { data, error } = await supabase.from('post_comments').insert({ post_id: p.id, body }).select('id,post_id,author_id,body,created_at').single();
    if (error || !data) { toast('Kommentaren ble ikke sendt. Prøv igjen.'); return false; }
    setComments((x) => ({ ...x, [p.id]: [...(x[p.id] ?? []), data as Comment] }));
    return true;
  }

  async function removeComment(c: Comment) {
    const { error } = await supabase.from('post_comments').delete().eq('id', c.id);
    if (error) { toast('Kommentaren ble ikke slettet.'); return; }
    setComments((x) => ({ ...x, [c.post_id]: (x[c.post_id] ?? []).filter((y) => y.id !== c.id) }));
  }

  async function removePost(p: Post) {
    const { error } = await supabase.from('posts').delete().eq('id', p.id);
    if (error) { toast('Innlegget ble ikke slettet. Prøv igjen.'); return; }
    if (p.images.length) await supabase.storage.from('praten').remove(p.images);
    setPosts((x) => (x ?? []).filter((y) => y.id !== p.id));
    toast('Innlegget er slettet.');
  }

  return (
    <div className="feed">
      <Composer onPosted={() => { setGroup('alle'); void load(); }} />

      <div className="chips" role="group" aria-label="Velg gruppe">
        {(['alle', ...Object.keys(GROUPS)] as (Group | 'alle')[]).map((g) => (
          <button key={g} className={`chip ${group === g ? 'on' : ''}`} aria-pressed={group === g} onClick={() => { setGroup(g); setLimit(PAGE); }}>
            {g === 'alle' ? 'Alle innlegg' : GROUPS[g]}
          </button>
        ))}
      </div>

      {err && <div className="empty">{err} <button className="linkbtn2" onClick={() => void load()}>Prøv igjen</button></div>}
      {!err && posts === null && <div className="empty">Henter innlegg …</div>}
      {posts?.map((p) => (
        <PostCard key={p.id} p={p} dir={dir} uid={uid} likes={likes[p.id] ?? []} comments={comments[p.id] ?? []}
          canDelete={p.author_id === uid || isAdmin} isAdmin={isAdmin}
          onLike={() => void toggleLike(p)} onComment={(b) => addComment(p, b)}
          onDelete={() => void removePost(p)} onDeleteComment={(c) => void removeComment(c)} />
      ))}
      {posts && !err && posts.length === 0 && (
        <div className="empty">{group === 'alle' ? 'Ingen innlegg ennå. Del det første, for eksempel et bilde fra hytta!' : `Ingen innlegg i «${GROUPS[group as Group]}» ennå.`}</div>
      )}
      {more && <button className="btn ghost" style={{ alignSelf: 'center' }} onClick={() => setLimit((l) => l + PAGE)}>Vis eldre innlegg</button>}
    </div>
  );
}

/* ---------- Skriv innlegg ---------- */
function Composer({ onPosted }: { onPosted: () => void }) {
  const me = useMe();
  const toast = useToast();
  const uid = me.session?.user.id ?? '';
  const name = me.profile?.full_name ?? '';
  const [text, setText] = useState('');
  const [grp, setGrp] = useState<Group>('generelt');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => drafts.forEach((d) => URL.revokeObjectURL(d.url)), [drafts]);

  function pick(files: FileList | null) {
    const { drafts: add, skipped } = toDrafts(files, drafts.length);
    setDrafts((d) => [...d, ...add]);
    if (skipped) toast(`Du kan legge ved opptil ${MAX_IMAGES} bilder i ett innlegg.`);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body && !drafts.length) { ta.current?.focus(); return; }
    setBusy(true);
    let images: string[] = [];
    try {
      if (drafts.length) images = await uploadImages('praten', uid, drafts);
    } catch {
      setBusy(false); toast('Bildene ble ikke lastet opp. Sjekk nettet og prøv igjen.'); return;
    }
    const { error } = await supabase.from('posts').insert({ grp, body, images });
    setBusy(false);
    if (error) {
      if (images.length) await supabase.storage.from('praten').remove(images);
      toast('Innlegget ble ikke delt. Prøv igjen.'); return;
    }
    setText(''); setDrafts([]); setGrp('generelt');
    toast('Innlegget er delt.');
    onPosted();
  }

  return (
    <form className="card compose" onSubmit={submit}>
      <div className="row1">
        <div className="av" aria-hidden="true">{initials(name)}</div>
        <textarea ref={ta} rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-label="Skriv et innlegg"
          placeholder={`Hva skjer på hytta${name ? `, ${firstName(name)}` : ''}?`} />
      </div>
      <DraftStrip drafts={drafts} onRemove={(k) => setDrafts((d) => d.filter((x) => x.key !== k))} />
      <div className="ctools">
        <div className="left">
          <label className="photo-btn"><Icon name="camera" size={20} />Bilde
            <input type="file" accept="image/*" multiple onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
          </label>
          <select value={grp} onChange={(e) => setGrp(e.target.value as Group)} aria-label="Gruppe">
            {(Object.keys(GROUPS) as Group[]).map((g) => <option key={g} value={g}>{GROUPS[g]}</option>)}
          </select>
        </div>
        <button className="btn primary" disabled={busy || (!text.trim() && !drafts.length)}>
          {busy ? (drafts.length ? 'Laster opp …' : 'Deler …') : 'Del'}
        </button>
      </div>
    </form>
  );
}

/* ---------- Ett innlegg ---------- */
function PostCard({ p, dir, uid, likes, comments, canDelete, isAdmin, onLike, onComment, onDelete, onDeleteComment }: {
  p: Post; dir: Directory; uid: string; likes: string[]; comments: Comment[]; canDelete: boolean; isAdmin: boolean;
  onLike: () => void; onComment: (body: string) => Promise<boolean>; onDelete: () => void; onDeleteComment: (c: Comment) => void;
}) {
  const author = dir.get(p.author_id);
  const liked = likes.includes(uid);
  const [confirm, setConfirm] = useState(false);
  const [c, setC] = useState('');
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const big = !p.images.length && p.body.length < 90;
  const likeText = useMemo(() => {
    const n = likes.length;
    if (!n) return '';
    if (liked) return n === 1 ? 'Du liker dette' : `Du og ${n - 1} ${n - 1 === 1 ? 'annen' : 'andre'}`;
    return n === 1 ? nameOf(dir, likes[0]) : String(n);
  }, [likes, liked, dir]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = c.trim();
    if (!body) return;
    setSending(true);
    if (await onComment(body)) setC('');
    setSending(false);
  }

  return (
    <article className="card post">
      <div className="post-h">
        <div className="av" aria-hidden="true">{initials(author?.name ?? '?')}</div>
        <div className="who2">
          <b>{author?.name ?? 'Ukjent'}</b>
          <span>{[placeOf(author), rel(p.created_at), GROUPS[p.grp]].filter(Boolean).join(' · ')}</span>
        </div>
        {canDelete && (confirm ? (
          <span className="confirm">Slette?
            <button className="btn small danger-btn" onClick={onDelete}>Slett</button>
            <button className="btn small ghost" onClick={() => setConfirm(false)}>Avbryt</button>
          </span>
        ) : <button className="linkbtn" onClick={() => setConfirm(true)}>Slett</button>)}
      </div>
      {p.body && <p className={`post-t ${big ? 'big' : ''}`} style={{ whiteSpace: 'pre-line' }}>{p.body}</p>}
      {p.images.length > 0 && <PhotoGrid bucket="praten" paths={p.images} />}
      <div className="pstats">
        <span className="lk">{likeText && <><i><Icon name="thumb" size={12} /></i><span className="num">{likeText}</span></>}</span>
        <span>{comments.length ? `${comments.length} kommentar${comments.length > 1 ? 'er' : ''}` : ''}</span>
      </div>
      <div className="pacts">
        <button className={liked ? 'on' : ''} aria-pressed={liked} onClick={onLike}><Icon name="thumb" size={18} />Liker</button>
        <button onClick={() => input.current?.focus()}><Icon name="chat" size={18} />Kommenter</button>
      </div>
      <div className="comments">
        {comments.map((x) => {
          const a = dir.get(x.author_id);
          return (
            <div key={x.id} className="cmt">
              <div className="av sm" aria-hidden="true">{initials(a?.name ?? '?')}</div>
              <div style={{ minWidth: 0 }}>
                <div className="bubble"><b>{a?.name ?? 'Ukjent'}</b><span style={{ whiteSpace: 'pre-line' }}>{x.body}</span></div>
                <small>{rel(x.created_at)}
                  {(x.author_id === uid || isAdmin) && <button className="linkbtn" style={{ fontSize: 12 }} onClick={() => onDeleteComment(x)}>Slett</button>}
                </small>
              </div>
            </div>
          );
        })}
        <form className="cform" onSubmit={send}>
          <input ref={input} type="text" value={c} onChange={(e) => setC(e.target.value)} placeholder="Skriv en kommentar"
            aria-label="Skriv en kommentar" autoComplete="off" maxLength={2000} enterKeyHint="send" />
          {c.trim() && <button className="btn small primary" disabled={sending} aria-label="Send kommentar"><Icon name="send" size={16} /></button>}
        </form>
      </div>
    </article>
  );
}
