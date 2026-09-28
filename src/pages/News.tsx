import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useMe } from '../lib/session';
import { useToast } from '../lib/ui';
import { dLong } from '../lib/format';
import { AUDIENCE_LABEL, SENDER_LABEL, sendersFor, type Audience, type News, type Sender } from '../lib/types';
import { Icon } from '../components/Icon';
import { DraftStrip, PhotoGrid } from '../components/Media';
import { toDrafts, uploadImages, MAX_IMAGES, type Draft } from '../lib/images';

const FILTERS: [Sender | 'alle', string][] = [['alle', 'Alle'], ['grunneier', 'Grunneier'], ['vel', 'Mørvika Vel'], ['va', 'Vann og avløp'], ['vei', 'Veilaget']];
const AUDIENCES = Object.keys(AUDIENCE_LABEL) as Audience[];

function Badge({ s }: { s: Sender }) {
  return <span className={`badge ${s === 'grunneier' ? '' : s}`}>{SENDER_LABEL[s]}</span>;
}

export function NewsPage() {
  const me = useMe();
  const toast = useToast();
  const senders = sendersFor(me.roles);
  const canPost = senders.length > 0;

  const [news, setNews] = useState<News[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [readCounts, setReadCounts] = useState<Record<string, number>>({});
  const [sizes, setSizes] = useState<Partial<Record<Audience, number>>>({});
  const [filter, setFilter] = useState<Sender | 'alle'>('alle');
  const [showForm, setShowForm] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('news')
      .select('id,sender,audience,title,body,notify,images,created_at,created_by')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) { setLoadErr('Nyhetene kunne ikke hentes. Sjekk nettet og prøv igjen.'); return; }
    setLoadErr(null);
    const list = (data ?? []) as News[];
    setNews(list);

    // Merk som lest
    if (list.length) {
      await supabase.from('news_reads').upsert(list.map((n) => ({ news_id: n.id })), { onConflict: 'news_id,user_id', ignoreDuplicates: true });
    }
    // Avsendere ser hvor mange som har lest
    if (canPost) {
      const r = await supabase.from('news_reads').select('news_id');
      const c: Record<string, number> = {};
      (r.data ?? []).forEach((x) => { c[x.news_id as string] = (c[x.news_id as string] ?? 0) + 1; });
      setReadCounts(c);
      const used = [...new Set(list.map((n) => n.audience))];
      const entries = await Promise.all(used.map(async (a) => [a, (await supabase.rpc('audience_size', { a })).data as number | null] as const));
      setSizes(Object.fromEntries(entries.filter(([, v]) => v !== null)));
    }
  }, [canPost]);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => (news ?? []).filter((n) => filter === 'alle' || n.sender === filter), [news, filter]);

  async function remove(id: string) {
    const n = (news ?? []).find((x) => x.id === id);
    const { error } = await supabase.from('news').delete().eq('id', id);
    setConfirmDel(null);
    if (error) { toast('Oppslaget ble ikke slettet. Prøv igjen.'); return; }
    if (n?.images?.length) await supabase.storage.from('nyheter').remove(n.images);
    toast('Oppslaget er slettet.'); void load();
  }

  return (
    <>
      <div className="head-row">
        <p className="lede">
          {canPost
            ? `Oppslag fra grunneier og foreningene. Du kan publisere som ${senders.map((s) => SENDER_LABEL[s]).join(' og ')}.`
            : me.veilagOnly
              ? 'Oppslag fra Mørvikveien Veilag.'
              : 'Oppslag fra grunneier, Velet, Vann og avløp og Veilaget som gjelder deg.'}
        </p>
        {canPost && (
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={() => { window.location.hash = 'del'; }}><Icon name="camera" size={18} />Del fra feltet</button>
            <button className="btn" onClick={() => setShowForm((v) => !v)}><Icon name="plus" size={18} />Nytt oppslag</button>
          </span>
        )}
      </div>

      {canPost && showForm && <NewsForm senders={senders} onDone={() => { setShowForm(false); void load(); }} onCancel={() => setShowForm(false)} />}

      {!me.veilagOnly && <div className="chips" role="group" aria-label="Filtrer etter avsender">
        {FILTERS.map(([k, t]) => (
          <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)} aria-pressed={filter === k}>{t}</button>
        ))}
      </div>}

      {loadErr && <div className="empty">{loadErr} <button className="linkbtn2" onClick={() => void load()}>Prøv igjen</button></div>}
      {!loadErr && news === null && <div className="empty">Henter nyheter …</div>}

      <div className="stack">
        {shown.map((n) => {
          const mine = n.created_by === me.session?.user.id;
          return (
            <article key={n.id} className={`card news ${n.images?.length ? 'has-img' : ''}`}>
              <div className="meta"><Badge s={n.sender} /><span>{dLong(n.created_at)}</span>{n.notify && <span className="pill">Varsel</span>}</div>
              <h3 className="serif">{n.title}</h3>
              {n.body && <p style={{ whiteSpace: 'pre-line' }}>{n.body}</p>}
              {n.images?.length > 0 && <div className="news-img"><PhotoGrid bucket="nyheter" paths={n.images} /></div>}
              <div className="foot">
                <span>Til: {AUDIENCE_LABEL[n.audience]}</span>
                {canPost && <span className="num">Lest av {readCounts[n.id] ?? 0}{sizes[n.audience] ? ` av ${sizes[n.audience]} hytteeiere` : ''}</span>}
                {(mine || me.roles.includes('admin')) && (confirmDel === n.id ? (
                  <span className="confirm">Slette oppslaget?
                    <button className="btn small danger-btn" onClick={() => void remove(n.id)}>Slett</button>
                    <button className="btn small ghost" onClick={() => setConfirmDel(null)}>Avbryt</button>
                  </span>
                ) : (
                  <button className="linkbtn" onClick={() => setConfirmDel(n.id)}>Slett</button>
                ))}
              </div>
            </article>
          );
        })}
        {news !== null && !loadErr && shown.length === 0 && (
          <div className="empty">{news.length ? 'Ingen oppslag fra denne avsenderen.' : canPost ? 'Ingen oppslag ennå. Trykk «Nytt oppslag» for å publisere det første.' : 'Ingen oppslag ennå.'}</div>
        )}
      </div>
    </>
  );
}

function NewsForm({ senders, onDone, onCancel }: { senders: Sender[]; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [sender, setSender] = useState<Sender>(senders[0]);
  const [audience, setAudience] = useState<Audience>('alle');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    let images: string[] = [];
    try { if (drafts.length) images = await uploadImages('nyheter', sender, drafts); }
    catch { setBusy(false); toast('Bildene ble ikke lastet opp. Sjekk nettet og prøv igjen.'); return; }
    const { error } = await supabase.from('news').insert({ sender, audience, title: title.trim(), body: body.trim(), notify, images });
    setBusy(false);
    if (error) {
      if (images.length) await supabase.storage.from('nyheter').remove(images);
      toast('Oppslaget ble ikke publisert. Prøv igjen.'); return;
    }
    toast('Oppslaget er publisert.');
    onDone();
  }

  return (
    <form className="card form" onSubmit={submit}>
      <label className="field" htmlFor="news-sender">Fra
        <select id="news-sender" value={sender} onChange={(e) => {
          const s = e.target.value as Sender;
          setSender(s);
          if (s !== 'vei' && audience === 'torpum') setAudience('alle');
        }}>
          {senders.map((s) => <option key={s} value={s}>{SENDER_LABEL[s]}</option>)}
        </select>
      </label>
      <label className="field" htmlFor="news-aud">Til
        <select id="news-aud" value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
          {AUDIENCES.filter((a) => a !== 'torpum' || sender === 'vei').map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
        </select>
      </label>
      <label className="field full" htmlFor="news-title">Overskrift
        <input id="news-title" type="text" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="F.eks. Brøyting starter 1. desember" />
      </label>
      <label className="field full" htmlFor="news-body">Tekst
        <textarea id="news-body" value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <div className="full photorow">
        <label className="cambtn" title="Legg ved bilder" aria-label="Legg ved bilder">
          <Icon name="camera" size={22} />
          <input type="file" accept="image/*" multiple hidden onChange={(e) => {
            const { drafts: add, skipped } = toDrafts(e.target.files, drafts.length);
            setDrafts((d) => [...d, ...add]); e.target.value = '';
            if (skipped) toast(`Du kan legge ved opptil ${MAX_IMAGES} bilder.`);
          }} />
        </label>
        <span className="muted" style={{ fontSize: 14 }}>Legg ved bilder</span>
      </div>
      {drafts.length > 0 && <div className="full"><DraftStrip drafts={drafts} className="mdrafts" onRemove={(k) => setDrafts((d) => d.filter((x) => x.key !== k))} /></div>}
      <label className="check full"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        Send push-varsel til mottakerne</label>
      <div className="actions full">
        <button type="button" className="btn ghost" onClick={onCancel}>Avbryt</button>
        <button className="btn primary" disabled={busy || !title.trim()}>{busy ? 'Publiserer …' : 'Publiser'}</button>
      </div>
    </form>
  );
}
