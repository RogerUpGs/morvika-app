import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/* ---------- Toast ---------- */
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<number>();
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setMsg(null), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  );
}

/* ---------- Enkel ruting med #nyheter, #hjem … ---------- */
export function useRoute(fallback: string): [string, (r: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?/, '') || fallback;
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const go = useCallback((r: string) => {
    if (window.location.hash !== `#${r}`) window.location.hash = r;
    else setRoute(r);
    window.scrollTo(0, 0);
  }, []);
  return [route, go];
}

/* ---------- Lys/mørk visning ---------- */
export function useTheme(): [boolean, () => void] {
  const [light, setLight] = useState(() => {
    try { return localStorage.getItem('morvika-theme') === 'light'; } catch { return false; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    try { localStorage.setItem('morvika-theme', light ? 'light' : 'dark'); } catch { /* privat modus */ }
  }, [light]);
  return [light, () => setLight((v) => !v)];
}

/* ---------- Telefonvisning ---------- */
export function useIsPhone(): boolean {
  const q = '(max-width: 900px)';
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}
