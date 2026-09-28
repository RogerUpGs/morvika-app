import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Tegn i vanlig SMS-tegnsett (GSM 03.38). Æ, ø og å er med.
const GSM = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
const GSM_EXT = new Set('^{}\\[~]|€');

export const SMS_MAX = 459; // tre deler

/** Antall tegn og SMS-deler en tekst blir til */
export function smsParts(text: string): { chars: number; parts: number; unicode: boolean } {
  let gsm = 0; let unicode = false;
  for (const ch of text) {
    if (GSM.has(ch)) gsm += 1;
    else if (GSM_EXT.has(ch)) gsm += 2;
    else { unicode = true; break; }
  }
  const chars = unicode ? [...text].length : gsm;
  if (chars === 0) return { chars: 0, parts: 0, unicode };
  const [one, many] = unicode ? [70, 67] : [160, 153];
  return { chars, parts: chars <= one ? 1 : Math.ceil(chars / many), unicode };
}

/** Standardtekst for et varsel (samme som databasen lager hvis teksten ikke endres) */
export function defaultSmsText(level: string, senderName: string, title: string, body: string): string {
  const head = title.trim();
  const sep = /[.!?:]$/.test(head) ? ' ' : '. ';
  const t = `${level === 'akutt' ? 'AKUTT fra ' : ''}${senderName}: ${head}${body.trim() ? `${sep}${body.trim()}` : ''}`;
  return t.slice(0, SMS_MAX);
}

export interface SmsSettings { enabled: boolean; from: string; price: number }

export async function fetchSmsSettings(): Promise<SmsSettings> {
  const { data } = await supabase.from('app_settings').select('key,value').in('key', ['sms_enabled', 'sms_from', 'sms_price']);
  const m = new Map(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  return {
    enabled: m.get('sms_enabled') === 'true',
    from: m.get('sms_from') || 'Morvika',
    price: Number.parseFloat((m.get('sms_price') ?? '0.60').replace(',', '.')) || 0,
  };
}

export function useSmsSettings(): SmsSettings | null {
  const [s, setS] = useState<SmsSettings | null>(null);
  useEffect(() => { void fetchSmsSettings().then(setS); }, []);
  return s;
}

export const kr = (n: number) => `${new Intl.NumberFormat('nb-NO', { minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 }).format(n)} kr`;
