import { useEffect, useState } from 'react';
import { useSignedUrls, type Draft } from '../lib/images';
import { Icon } from './Icon';

/** Bilde i full størrelse. Trykk for neste, Esc eller X for å lukke. */
export function Lightbox({ urls, start, onClose }: { urls: string[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((x) => (x + 1) % urls.length);
      if (e.key === 'ArrowLeft') setI((x) => (x - 1 + urls.length) % urls.length);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [urls.length, onClose]);
  return (
    <div className="lb" role="dialog" aria-modal="true" aria-label="Bilde" onClick={() => (urls.length > 1 ? setI((x) => (x + 1) % urls.length) : onClose())}>
      <button className="lb-x" aria-label="Lukk" onClick={(e) => { e.stopPropagation(); onClose(); }}><Icon name="x" size={22} /></button>
      <div>
        <img className="lb-img" src={urls[i]} alt="" />
        {urls.length > 1 && <p>{i + 1} av {urls.length} · trykk for neste</p>}
      </div>
    </div>
  );
}

/** Bildene i et innlegg: 1–4 ruter, «+3» på den siste hvis det er flere. */
export function PhotoGrid({ bucket, paths }: { bucket: string; paths: string[] }) {
  const urls = useSignedUrls(bucket, paths);
  const [open, setOpen] = useState<number | null>(null);
  const shown = paths.slice(0, 4);
  const all = paths.map((p) => urls[p]).filter(Boolean);
  return (
    <>
      <div className={`pimgs n${Math.min(paths.length, 4)}`}>
        {shown.map((p, i) => (
          <button key={p} className="tile" style={urls[p] ? { backgroundImage: `url("${urls[p]}")` } : undefined}
            onClick={() => all.length && setOpen(i)} aria-label={`Vis bilde ${i + 1} av ${paths.length}`}>
            {i === 3 && paths.length > 4 && <span className="more">+{paths.length - 4}</span>}
          </button>
        ))}
      </div>
      {open !== null && <Lightbox urls={all} start={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Små bilder i en melding */
export function MessagePhotos({ bucket, paths }: { bucket: string; paths: string[] }) {
  const urls = useSignedUrls(bucket, paths);
  const [open, setOpen] = useState<number | null>(null);
  const all = paths.map((p) => urls[p]).filter(Boolean);
  return (
    <>
      <div className={`bimgs ${paths.length === 1 ? 'one' : ''}`}>
        {paths.map((p, i) => (
          <button key={p} style={urls[p] ? { backgroundImage: `url("${urls[p]}")` } : undefined}
            onClick={() => all.length && setOpen(i)} aria-label={`Vis bilde ${i + 1}`} />
        ))}
      </div>
      {open !== null && <Lightbox urls={all} start={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Valgte bilder før de sendes, med knapp for å fjerne */
export function DraftStrip({ drafts, onRemove, className = 'drafts' }: { drafts: Draft[]; onRemove: (key: string) => void; className?: string }) {
  if (!drafts.length) return null;
  return (
    <div className={className}>
      {drafts.map((d) => (
        <div key={d.key} className="t" style={{ backgroundImage: `url("${d.url}")` }}>
          <button type="button" onClick={() => onRemove(d.key)} aria-label="Fjern bildet"><Icon name="x" size={14} /></button>
        </div>
      ))}
    </div>
  );
}
