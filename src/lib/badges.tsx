import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { useMe } from './session';
import { fetchOpenAlerts, type Alert } from '../pages/Alerts';
import { countUnreadThreads } from '../pages/Messages';
import { PRATEN_SEEN } from '../pages/Chat';

/** Tall og varsler som vises på startsiden og i menyen */
export interface Badges { openAlerts: Alert[]; unreadThreads: number; newPosts: number; refresh: () => void }
const Ctx = createContext<Badges>({ openAlerts: [], unreadThreads: 0, newPosts: 0, refresh: () => {} });
export const useBadges = () => useContext(Ctx);

export function BadgesProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const uid = me.session?.user.id ?? '';
  const [openAlerts, setOpen] = useState<Alert[]>([]);
  const [unreadThreads, setUnread] = useState(0);
  const [newPosts, setNewPosts] = useState(0);

  const refresh = useCallback(() => {
    if (!uid) return;
    void fetchOpenAlerts(uid, me.roles).then(setOpen).catch(() => {});
    void countUnreadThreads(uid).then(setUnread).catch(() => {});
    if (!me.veilagOnly) {
      let seen = '';
      try { seen = localStorage.getItem(PRATEN_SEEN) ?? ''; } catch { /* privat modus */ }
      let q = supabase.from('posts').select('id', { count: 'exact', head: true }).neq('author_id', uid);
      if (seen) q = q.gt('created_at', seen);
      void q.then(({ count }) => setNewPosts(count ?? 0));
    }
  }, [uid, me.roles, me.veilagOnly]);

  useEffect(() => {
    refresh();
    const on = () => refresh();
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('alerts-changed', on);
    window.addEventListener('messages-changed', on);
    window.addEventListener('hashchange', on);
    window.addEventListener('badges-refresh', on);
    document.addEventListener('visibilitychange', onVis);
    const t = window.setInterval(onVis, 60_000);
    return () => {
      window.removeEventListener('alerts-changed', on);
      window.removeEventListener('messages-changed', on);
      window.removeEventListener('hashchange', on);
      window.removeEventListener('badges-refresh', on);
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(t);
    };
  }, [refresh]);

  return <Ctx.Provider value={{ openAlerts, unreadThreads, newPosts, refresh }}>{children}</Ctx.Provider>;
}
