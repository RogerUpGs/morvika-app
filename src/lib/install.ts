import { useEffect, useState } from 'react';
import { isIos, isStandalone } from './push';

// Chrome på Android sender «beforeinstallprompt» når appen kan installeres med én knapp.
// Vi tar vare på den tidlig (main.tsx), så knappen kan vises når siden er klar.
interface BipEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: BipEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BipEvent; notify(); });
  window.addEventListener('appinstalled', () => { deferred = null; try { localStorage.setItem('installed', '1'); } catch { /* */ } notify(); });
}

export type Platform =
  | 'installert'          // åpnet fra hjemskjermen
  | 'pc'                  // ikke mobil: ingen hjelp trengs
  | 'android-knapp'       // Chrome kan installere med én knapp
  | 'android-meny'        // Android-nettleser uten knappen: vis menyvalget
  | 'android-innebygd'    // Facebook, Messenger, Gmail o.l.: må åpnes i Chrome
  | 'ios-safari'          // iPhone i Safari: vis Del → Legg til på Hjem-skjerm
  | 'ios-innebygd';       // iPhone i Facebook, Messenger, Gmail o.l.: må åpnes i Safari

const ua = () => navigator.userAgent || '';
// Nettlesere inne i andre apper kan ikke legge appen på hjemskjermen
const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|Snapchat|LinkedInApp|GSA\/|Twitter|MicroMessenger|; wv\)/i;

export function detectPlatform(): Platform {
  if (isStandalone()) return 'installert';
  const u = ua();
  if (isIos()) {
    // Safari har «Safari/» og ikke andre nettlesernavn; Chrome/Firefox/Edge på iPhone kan også legge til via Del
    if (IN_APP.test(u) || !/Safari\//.test(u)) return 'ios-innebygd';
    return 'ios-safari';
  }
  if (/Android/i.test(u)) {
    if (IN_APP.test(u)) return 'android-innebygd';
    return deferred ? 'android-knapp' : 'android-meny';
  }
  return 'pc';
}

export function useInstall() {
  const [platform, setPlatform] = useState<Platform>(detectPlatform);
  useEffect(() => {
    const f = () => setPlatform(detectPlatform());
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  async function install(): Promise<boolean> {
    if (!deferred) return false;
    await deferred.prompt();
    const r = await deferred.userChoice;
    deferred = null; notify();
    return r.outcome === 'accepted';
  }
  return { platform, install };
}

/** Lenke som åpner siden i Chrome fra en innebygd nettleser på Android */
export const chromeIntent = (path = '/installer') =>
  `intent://${location.host}${path}#Intent;scheme=https;package=com.android.chrome;end`;
