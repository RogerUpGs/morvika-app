import { useMe } from './session';
import type { IconName } from '../components/Icon';

export interface NavItem { key: string; label: string; icon: IconName; group: 'Min hytte' | 'Fellesskap' | 'Administrasjon' | 'Deg' }

export function useNavItems(): NavItem[] {
  const { fullCabins, roles, veilagOnly, isResident, former } = useMe();
  const items: NavItem[] = [];
  if (fullCabins.length || former.length) items.push({ key: 'minhytte', label: 'Min hytte', icon: 'home', group: 'Min hytte' });
  // Tidligere eier uten annen hytte eller rolle: bare Min hytte (lesetilgang etter eierskifte)
  if (!isResident) { items.push({ key: 'profil', label: 'Min profil', icon: 'user', group: 'Deg' }); return items; }
  if (!veilagOnly) items.push({ key: 'chat', label: 'Hyttepraten', icon: 'chat', group: 'Fellesskap' });
  items.push(
    { key: 'nyheter', label: 'Nyheter', icon: 'news', group: 'Fellesskap' },
    { key: 'varsler', label: 'Varsler', icon: 'bell', group: 'Fellesskap' },
    { key: 'meldinger', label: 'Meldinger', icon: 'msg', group: 'Fellesskap' },
    { key: 'arr', label: 'Arrangementer', icon: 'cal', group: 'Fellesskap' },
    { key: 'info', label: 'Info og dokumenter', icon: 'info', group: 'Fellesskap' },
  );
  items.push({ key: 'gjoremal', label: 'Gjøremål', icon: 'todo', group: 'Min hytte' });
  if (roles.includes('admin')) items.push({ key: 'admin', label: 'Administrasjon', icon: 'admin', group: 'Administrasjon' });
  items.push({ key: 'profil', label: 'Min profil', icon: 'user', group: 'Deg' });
  return items;
}
