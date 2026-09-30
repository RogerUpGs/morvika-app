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
import { AdminPage } from '../pages/Admin';
import { ChatPage } from '../pages/Chat';
import { AlertsPage, LEVEL_LABEL } from '../pages/Alerts';
import { MessagesPage } from '../pages/Messages';
import { QuickPostPage } from '../pages/QuickPost';
import { EventsPage } from '../pages/Events';
import { InfoPage } from '../pages/Info';
import { MinHyttePage } from '../pages/MinHytte';
import { sendersFor } from '../lib/types';
import { useBadges } from '../lib/badges';
import { useTaskCount } from '../lib/tasks';
import { GjoremalPage } from '../pages/Gjoremal';

const TITLES: Record<string, string> = {
  hjem: 'Hjem', minhytte: 'Min hytte', chat: 'Hyttepraten', nyheter: 'Nyheter', varsler: 'Varsler',
  meldinger: 'Meldinger', del: 'Del fra feltet', arr: 'Arrangementer', info: 'Info', admin: 'Administrasjon', profil: 'Min profil', gjoremal: 'Gjøremål',
};

export function Shell() {
  const me = useMe();
  const isPhone = useIsPhone();
  const [light, toggleTheme] = useTheme();
  const items = useNavItems();
  const badges = useBadges();
  const pcStart = !me.isResident ? 'minhytte' : me.veilagOnly ? 'nyheter' : 'chat';
  const [route, go] = useRoute(isPhone ? 'hjem' : pcStart);
  const canPost = sendersFor(me.roles).some((s) => s !== 'admin');
  const known = route === 'hjem' || (route === 'del' && canPost) || items.some((i) => i.key === route);
  const view = known ? route : isPhone ? 'hjem' : pcStart;

  useEffect(() => { document.title = `${TITLES[view] ?? 'Mørvika'} · Mørvika`; }, [view]);

  const groups = ['Min hytte', 'Fellesskap', 'Administrasjon'] as const;
  const eyebrow = !me.isResident && me.workerCabins.length ? 'Byggeprosjekt'
    : me.veilagOnly ? 'Mørvikveien Veilag'
    : view === 'hjem' ? 'Mørvika hytteområde' : view === 'del' ? 'Nyheter' : items.find((i) => i.key === view)?.group ?? 'Fellesskap';

  const tasksDue = useTaskCount();
  const count = (k: string) => k === 'gjoremal' ? tasksDue : k === 'varsler' ? badges.openAlerts.length : k === 'meldinger' ? badges.unreadThreads : k === 'chat' ? badges.newPosts : 0;
  const top = badges.openAlerts.find((a) => a.level === 'akutt') ?? badges.openAlerts[0];

  let page: ReactNode;
  switch (view) {
    case 'hjem': page = <Home go={go} />; break;
    case 'nyheter': page = <NewsPage />; break;
    case 'profil': page = <ProfilePage />; break;
    case 'admin': page = <AdminPage />; break;
    case 'chat': page = <ChatPage />; break;
    case 'varsler': page = <AlertsPage />; break;
    case 'meldinger': page = <MessagesPage />; break;
    case 'del': page = <QuickPostPage go={go} />; break;
    case 'arr': page = <EventsPage />; break;
    case 'info': page = <InfoPage />; break;
    case 'minhytte': page = <MinHyttePage />; break;
    case 'gjoremal': page = <GjoremalPage />; break;
    default: page = <ComingSoon view={view} />;
  }

  return (
    <div className="app">
      <aside className="side">
        <div className="brand"><Logo /><div><b>Mørvika</b><small>Hytteområde</small></div></div>
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
                    {count(it.key) > 0 && <span className="navcnt">{count(it.key)}</span>}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="who">
          <b>{me.profile?.full_name || me.session?.user.email}</b>
          {[...me.cabins.map((c) => c.label), ...me.workerCabins.map((w) => w.label)].join(', ')}
          <div className="rolechips" style={{ marginTop: 6 }}>
            {me.cabins.length > 0 && <span className="pill">Hytteeier</span>}
            {me.workerCabins.length > 0 && <span className="pill">Prosjektmedarbeider</span>}
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
            {isPhone && view === 'hjem' && (
              <button className="themebtn" onClick={() => go('profil')} aria-label="Min profil og varsler">
                <Icon name="user" size={18} />Profil
              </button>
            )}
            <button className="themebtn" onClick={toggleTheme} aria-label={light ? 'Bytt til mørk visning' : 'Bytt til lys visning'}>
              <Icon name={light ? 'moon' : 'sun'} size={18} />{light ? 'Mørk' : 'Lys'}
            </button>
          </div>
        </header>
        <div className="wrap">
          {top && view !== 'varsler' && (
            <button className={`alertbar lv-${top.level}`} onClick={() => go('varsler')}>
              <b>{LEVEL_LABEL[top.level]}</b><span className="tl">{top.title}</span>
              <span className="go">{badges.openAlerts.length > 1 ? `${badges.openAlerts.length} varsler` : 'Les'}<Icon name="chev" size={16} /></span>
            </button>
          )}
          {page}
        </div>
      </main>
    </div>
  );
}
