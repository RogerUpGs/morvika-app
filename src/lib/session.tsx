import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { AppRole, Cabin, Profile } from './types';

interface Me {
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  cabins: Cabin[];
  /** Eier hytte eller har en rolle. Uinviterte ser ingenting. */
  isResident: boolean;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMe = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null); setRoles([]); setCabins([]); setLoading(false);
      return;
    }
    setError(null);
    const uid = s.user.id;
    const [p, r, c] = await Promise.all([
      supabase.rpc('my_profile').maybeSingle<Profile>(),
      supabase.from('user_roles').select('role').eq('user_id', uid),
      supabase.from('cabin_owners').select('cabin:cabins(id,area,number,label,gnr,bnr,vel_member,vei_member)').eq('user_id', uid),
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
    session, profile, roles, cabins, loading, error,
    isResident: roles.length > 0 || cabins.length > 0,
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
