import { useEffect, type ReactNode } from 'react';
import { useMe } from '../lib/session';
import { useIsPhone, useRoute, useTheme } from '../lib/ui';
import { ROLE_LABEL } from '../lib/types';
import { Icon, Logo } from './Icon';
import { useNavItems } from '../lib/nav';
import { Home } from '../pages/Home';
import { NewsPage } from '../pages/News';
import { ComingSoon } from '../pages/ComingSoon';
import { ProfilePage } from '../pages/Profile';

const TITLES: Record<string, string> = {
  hjem: 'Hjem', minhytte: 'Min hytte', chat: 'Hyttepraten', nyheter: 'Nyheter', varsler: 'Varsler',
  meldinger: 'Meldinger', arr: 'Arrangementer og dugnad', info: 'Info og dokumenter', admin: 'Administrasjon', profil: 'Min profil',
};

export function Shell() {
  const me = useMe();
  const isPhone = useIsPhone();
  const [light, toggleTheme] = useTheme();
  const items = useNavItems();
  // Nyheter er den første modulen som er koblet til databasen, så PC-en starter der inntil videre.
  const [route, go] = useRoute(isPhone ? 'hjem' : 'nyheter');
  const known = route === 'hjem' || items.some((i) => i.key === route);
  const view = known ? route : isPhone ? 'hjem' : 'nyheter';

  useEffect(() => { document.title = `${TITLES[view] ?? 'Mørvika'} · Mørvika`; }, [view]);

  const groups = ['Min hytte', 'Fellesskap', 'Administrasjon'] as const;
  const eyebrow = view === 'hjem' ? 'Mørvika hytteområde' : items.find((i) => i.key === view)?.group ?? 'Fellesskap';

  let page: ReactNode;
  switch (view) {
    case 'hjem': page = <Home go={go} />; break;
    case 'nyheter': page = <NewsPage />; break;
    case 'profil': page = <ProfilePage />; break;
    default: page = <ComingSoon view={view} />;
  }

  return (
    <div className="app">
      <aside className="side">
        <div className="brand"><Logo /><div><b>Mørvika</b><small>Hytteområde · 150 hytter</small></div></div>
        <nav className="nav" aria-label="Hovedmeny">
          {groups.map((g) => {
            const list = items.filter((i) => i.group === g);
            if (!list.length) return null;
            return (
              <div key={g} style={{ display: 'contents' }}>
                <div className="navlab">{g}</div>
                {list.map((it) => (
                  <button key={it.key} className={view === it.key ? 'on' : ''} onClick={() => go(it.key)}
                    aria-current={view === it.key ? 'page' : undefined}>
                    <Icon name={it.icon} />{it.label}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="who">
          <b>{me.profile?.full_name || me.session?.user.email}</b>
          {me.cabins.map((c) => c.label).join(', ')}
          <div className="rolechips" style={{ marginTop: 6 }}>
            {me.cabins.length > 0 && <span className="pill">Hytteeier</span>}
            {me.roles.map((r) => <span key={r} className="pill">{ROLE_LABEL[r]}</span>)}
          </div>
          <div className="sideactions">
            <button className="btn small ghost" onClick={() => go('profil')}><Icon name="user" size={16} />Min profil</button>
            <button className="btn small ghost" onClick={() => void me.signOut()}><Icon name="out" size={16} />Logg ut</button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            {isPhone && view !== 'hjem' && (
              <button className="homebtn" onClick={() => go('hjem')}><Icon name="back" size={22} />Hjem</button>
            )}
            <div><span className="eyebrow2">{eyebrow}</span><h1>{TITLES[view]}</h1></div>
          </div>
          <div className="persona">
            <button className="themebtn" onClick={toggleTheme} aria-label={light ? 'Bytt til mørk visning' : 'Bytt til lys visning'}>
              <Icon name={light ? 'moon' : 'sun'} size={18} />{light ? 'Mørk' : 'Lys'}
            </button>
          </div>
        </header>
        <div className="wrap">{page}</div>
      </main>
    </div>
  );
}
