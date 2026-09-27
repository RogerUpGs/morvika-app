import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export const MAX_IMAGES = 10;

/**
 * Gjør bilder fra telefonen mindre før opplasting: lengste side maks 1600 px, JPEG.
 * Et bilde på 4–8 MB blir typisk 250–500 kB. Går det ikke (gammel nettleser), lastes originalen opp.
 */
export async function shrinkImage(file: File, max = 1600, quality = 0.82): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (blob && blob.size < file.size) return blob;
  } catch { /* bruk originalen */ }
  return file;
}

/** Et bilde som er valgt, men ikke lastet opp ennå */
export interface Draft { key: string; file: File; url: string }

export function toDrafts(files: FileList | null, have: number): { drafts: Draft[]; skipped: number } {
  const list = [...(files ?? [])].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
  const room = Math.max(0, MAX_IMAGES - have);
  const drafts = list.slice(0, room).map((file) => ({ key: Math.random().toString(36).slice(2), file, url: URL.createObjectURL(file) }));
  return { drafts, skipped: list.length - drafts.length };
}

/** Laster opp bildene til bøtta, i mappen `folder`, og gir tilbake stiene. */
export async function uploadImages(bucket: string, folder: string, drafts: Draft[]): Promise<string[]> {
  const paths: string[] = [];
  for (const d of drafts) {
    const blob = await shrinkImage(d.file);
    const ext = blob.type === 'image/jpeg' ? 'jpg' : (d.file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${folder}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType: blob.type || 'image/jpeg', cacheControl: '31536000' });
    if (error) {
      if (paths.length) await supabase.storage.from(bucket).remove(paths);
      throw error;
    }
    paths.push(path);
  }
  return paths;
}

/* ---------- Visning: bildene ligger i lukkede bøtter og vises med tidsbegrensede lenker ---------- */
const urlCache = new Map<string, { url: string; until: number }>();

export function useSignedUrls(bucket: string, paths: string[]): Record<string, string> {
  const key = paths.join('|');
  const [urls, setUrls] = useState<Record<string, string>>(() => fromCache(bucket, paths));
  useEffect(() => {
    let alive = true;
    const missing = paths.filter((p) => !fresh(bucket, p));
    if (!missing.length) { setUrls(fromCache(bucket, paths)); return; }
    supabase.storage.from(bucket).createSignedUrls(missing, 3600).then(({ data }) => {
      const until = Date.now() + 50 * 60_000;
      for (const x of data ?? []) if (x.path && x.signedUrl) urlCache.set(`${bucket}/${x.path}`, { url: x.signedUrl, until });
      if (alive) setUrls(fromCache(bucket, paths));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, key]);
  return urls;
}
function fresh(bucket: string, p: string) { const c = urlCache.get(`${bucket}/${p}`); return c && c.until > Date.now(); }
function fromCache(bucket: string, paths: string[]) {
  const out: Record<string, string> = {};
  for (const p of paths) { const c = urlCache.get(`${bucket}/${p}`); if (c) out[p] = c.url; }
  return out;
}
