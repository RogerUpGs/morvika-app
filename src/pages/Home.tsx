import { useEffect, useState } from 'react';
import { useMe } from '../lib/session';
import { supabase } from '../lib/supabase';
import { dShort, firstName, greeting } from '../lib/format';
import { Icon } from '../components/Icon';
import { useNavItems } from '../lib/nav';
import { useBadges } from '../lib/badges';
import { useTaskCount } from '../lib/tasks';
import { PushPrompt } from '../components/PushCard';
import { InstallPrompt } from '../components/InstallPrompt';
import { sendersFor } from '../lib/types';
import { nextEvent } from './Events';

/** Telefonens startside: store knapper, to i bredden. */
export function Home({ go }: { go: (r: string) => void }) {
  const me = useMe();
  const items = useNavItems().filter((i) => i.key !== 'profil');
  const badges = useBadges();
  const tasksDue = useTaskCount();
  const akutt = badges.openAlerts.some((a) => a.level === 'akutt');
  const [nextArr, setNextArr] = useState<string | null>(null);
  useEffect(() => { void nextEvent().then((e) => setNextArr(e ? e.starts_at : null)).catch(() => {}); }, []);
  const [lastNews, setLastNews] = useState<string | null>(null);
  const [unreadNews, setUnreadNews] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [n, r] = await Promise.all([
        supabase.from('news').select('id,created_at').order('created_at', { ascending: false }).limit(50),
        supabase.from('news_reads').select('news_id').eq('user_id', me.session?.user.id ?? ''),
      ]);
      if (!alive || n.error) return;
      const read = new Set((r.data ?? []).map((x) => x.news_id as string));
      setLastNews(n.data?.[0]?.created_at ?? null);
      setUnreadNews((n.data ?? []).filter((x) => !read.has(x.id)).length);
    })();
    return () => { alive = false; };
  }, [me.session?.user.id]);

  const sub: Record<string, string> = {
    minhytte: me.cabins[0]?.label ?? '',
    chat: badges.newPosts ? `${badges.newPosts} ${badges.newPosts === 1 ? 'nytt innlegg' : 'nye innlegg'}` : 'Del bilder og nytt',
    nyheter: unreadNews ? `${unreadNews} ${unreadNews === 1 ? 'ny' : 'nye'}` : lastNews ? `Siste ${dShort(lastNews)}` : me.veilagOnly ? 'Fra Veilaget' : 'Fra styret og grunneier',
    varsler: badges.openAlerts.length ? `${badges.openAlerts.length} venter på deg` : 'Ingen nye',
    meldinger: badges.unreadThreads ? `${badges.unreadThreads} ${badges.unreadThreads === 1 ? 'ny' : 'nye'}` : me.veilagOnly ? 'Til Veilagets styre' : 'Til grunneier og styret',
    arr: nextArr ? `Neste ${dShort(nextArr)}` : 'Dugnad og treff',
    info: 'Dokumenter og kontakter',
    admin: 'Hytter og eiere',
    gjoremal: tasksDue ? `${tasksDue} i dag eller forfalt` : 'Påminnelser for deg og hytta',
  };
  const cnt = (k: string) => k === 'gjoremal' ? tasksDue : k === 'nyheter' ? unreadNews : k === 'varsler' ? badges.openAlerts.length : k === 'meldinger' ? badges.unreadThreads : k === 'chat' ? badges.newPosts : 0;
  const order = ['chat', 'nyheter', 'varsler', 'meldinger', 'minhytte', 'gjoremal', 'arr', 'info', 'admin'];
  const tiles = order.map((k) => items.find((i) => i.key === k)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const place = me.cabins[0]?.area === 'torpum' ? 'Torpum' : 'Mørvika hytteområde';

  return (
    <>
      <div className="hello">
        <h2>{greeting()}, {firstName(me.profile?.full_name ?? '')}</h2>
        <p>{me.cabins.length ? `${me.cabins.map((c) => c.label).join(', ')} · ` : ''}{place}</p>
      </div>
      {sendersFor(me.roles).some((s) => s !== 'admin') && (
        <button className="fieldbtn" onClick={() => go('del')}>
          <span className="ic"><Icon name="camera" size={28} /></span>
          <span><b>Del fra feltet</b><small>Ta et bilde, skriv noen ord og publiser i Nyheter</small></span>
        </button>
      )}
      <InstallPrompt />
      <PushPrompt />
      <div className="tiles">
        {tiles.map((it) => (
          <button key={it.key} className={`tile2 t-${it.key} ${it.key === 'varsler' && akutt ? 'akutt' : ''}`} onClick={() => go(it.key)}>
            <Icon name={it.icon} size={38} />
            <span><b>{it.key === 'info' ? 'Info' : it.label}</b>
              {it.key === 'varsler' && akutt ? <span className="flag">Akutt varsel</span> : <small>{sub[it.key]}</small>}</span>
            {cnt(it.key) > 0 && <span className="cnt">{cnt(it.key)}</span>}
          </button>
        ))}
      </div>
    </>
  );
}
