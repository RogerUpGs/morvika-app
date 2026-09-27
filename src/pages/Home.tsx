import { useEffect, useState } from 'react';
import { useMe } from '../lib/session';
import { supabase } from '../lib/supabase';
import { dShort, firstName, greeting } from '../lib/format';
import { Icon } from '../components/Icon';
import { useNavItems } from '../lib/nav';

/** Telefonens startside: store knapper, to i bredden. */
export function Home({ go }: { go: (r: string) => void }) {
  const me = useMe();
  const items = useNavItems().filter((i) => i.key !== 'profil');
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
    chat: 'Del bilder og nytt',
    nyheter: unreadNews ? `${unreadNews} nye` : lastNews ? `Siste ${dShort(lastNews)}` : 'Fra styret og grunneier',
    varsler: 'Viktige beskjeder',
    meldinger: 'Til grunneier og styret',
    arr: 'Dugnad og treff',
    info: 'Dokumenter og kontakter',
    admin: 'Brukere og roller',
  };
  const order = ['chat', 'nyheter', 'varsler', 'meldinger', 'minhytte', 'arr', 'info', 'admin'];
  const tiles = order.map((k) => items.find((i) => i.key === k)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const place = me.cabins[0]?.area === 'sandbukta' ? 'Sandbukta' : 'Mørvika hytteområde';

  return (
    <>
      <div className="hello">
        <h2>{greeting()}, {firstName(me.profile?.full_name ?? '')}</h2>
        <p>{me.cabins.length ? `${me.cabins.map((c) => c.label).join(', ')} · ` : ''}{place}</p>
      </div>
      <div className="tiles">
        {tiles.map((it) => (
          <button key={it.key} className={`tile2 t-${it.key}`} onClick={() => go(it.key)}>
            <Icon name={it.icon} size={38} />
            <span><b>{it.key === 'info' ? 'Info' : it.label}</b><small>{sub[it.key]}</small></span>
            {it.key === 'nyheter' && unreadNews > 0 && <span className="cnt">{unreadNews}</span>}
          </button>
        ))}
      </div>
    </>
  );
}
