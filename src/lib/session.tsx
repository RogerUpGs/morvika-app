import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { AppRole, Cabin, Profile } from './types';

/** Hytte man har solgt eller overdratt, med lesetilgang til Min hytte i 90 dager */
export interface FormerCabin {
  ownership_id: string; cabin_id: string; label: string; ends_on: string; access_until: string;
  transfer_id: string | null; kind: 'salg' | 'familie' | null; full_transfer_at: string | null;
}

interface Me {
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  cabins: Cabin[];
  /** Eier hytte eller har en rolle. Uinviterte ser ingenting. */
  isResident: boolean;
  /** Bare Veilaget: eier bare hytter i Torpum (tilgang «veilag») og har ingen rolle. */
  veilagOnly: boolean;
  /** Hytter med full tilgang (Min hytte). */
  fullCabins: Cabin[];
  /** Tidligere hytter med lesetilgang (etter eierskifte) */
  former: FormerCabin[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Me | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [cabins, setCabins] = useState<Cabin[]>([]);
  const [former, setFormer] = useState<FormerCabin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMe = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null); setRoles([]); setCabins([]); setFormer([]); setLoading(false);
      return;
    }
    setError(null);
    const uid = s.user.id;
    const [p, r, c, f] = await Promise.all([
      supabase.rpc('my_profile').maybeSingle<Profile>(),
      supabase.from('user_roles').select('role').eq('user_id', uid),
      supabase.from('cabin_owners').select('cabin:cabins(id,area,number,label,gnr,bnr,vel_member,va_member,vei_member,access)').eq('user_id', uid),
      supabase.rpc('my_former_cabins'),
    ]);
    const firstError = p.error ?? r.error ?? c.error;
    if (firstError) setError(firstError.message);
    setProfile(p.data ?? null);
    setRoles((r.data ?? []).map((x: { role: AppRole }) => x.role));
    const owned = (c.data ?? [])
      .map((x) => (x as unknown as { cabin: Cabin | null }).cabin)
      .filter((x): x is Cabin => Boolean(x))
      .sort((a, b) => a.number - b.number);
    setCabins(owned);
    setFormer(((f.data ?? []) as FormerCabin[]));
    setLoading(false);
    // Siste innlogging, til bruk i brukerregisteret
    void supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', uid);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      void loadMe(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        setLoading(true);
        void loadMe(s);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadMe]);

  const value: Me = {
    session, profile, roles, cabins, former, loading, error,
    isResident: roles.length > 0 || cabins.length > 0,
    veilagOnly: roles.length === 0 && cabins.length > 0 && cabins.every((c) => c.access === 'veilag'),
    fullCabins: cabins.filter((c) => c.access === 'full'),
    reload: () => loadMe(session),
    signOut: async () => { await supabase.auth.signOut(); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMe(): Me {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMe brukt utenfor SessionProvider');
  return v;
}
