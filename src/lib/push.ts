import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

/** Tilstand for push-varsler på denne telefonen/PC-en */
export type PushState =
  | 'laster'
  | 'ikke-stottet'      // Nettleseren kan ikke ta imot push
  | 'ios-hjemskjerm'    // iPhone/iPad: må legges på Hjem-skjerm først
  | 'ikke-satt-opp'     // Administrator har ikke laget nøkler ennå
  | 'blokkert'          // Brukeren har sagt nei i nettleseren
  | 'av'
  | 'på';

const ua = () => navigator.userAgent;
export const isIos = () => /iPad|iPhone|iPod/.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }
}

async function vapidKey(): Promise<string | null> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'vapid_public').maybeSingle();
  return (data as { value: string } | null)?.value ?? null;
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export function bytesToB64url(b: ArrayBuffer | Uint8Array): string {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  bytes.forEach((x) => { s += String.fromCharCode(x); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function currentState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return 'ios-hjemskjerm';
  if (!supported()) return 'ikke-stottet';
  if (!(await vapidKey())) return 'ikke-satt-opp';
  if (Notification.permission === 'denied') return 'blokkert';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'på' : 'av';
}

export function usePush() {
  const [state, setState] = useState<PushState>('laster');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => { void currentState().then(setState).catch(() => setState('ikke-stottet')); }, []);
  useEffect(refresh, [refresh]);

  /** Slå på. Må kalles fra et trykk på en knapp (kravet til nettleserne). */
  const enable = useCallback(async (): Promise<string | null> => {
    setBusy(true);
    try {
      const key = await vapidKey();
      if (!key) return 'Push er ikke satt opp ennå.';
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'blokkert' : 'av'); return perm === 'denied' ? 'Varsler er blokkert i nettleseren.' : null; }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Byttet nøkkel? Da må abonnementet lages på nytt.
        const old = sub.options?.applicationServerKey ? bytesToB64url(sub.options.applicationServerKey) : key;
        if (old !== key) { await sub.unsubscribe(); sub = null; }
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) as BufferSource });
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_agent: ua() });
      if (error) return 'Varsler ble ikke slått på. Prøv igjen.';
      setState('på');
      return null;
    } catch {
      return 'Varsler ble ikke slått på. Prøv igjen.';
    } finally { setBusy(false); }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        await sub.unsubscribe();
      }
      setState('av');
    } finally { setBusy(false); }
  }, []);

  return { state, busy, enable, disable, refresh };
}
