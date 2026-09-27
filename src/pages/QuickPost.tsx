import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useMe } from '../lib/session';
import { useToast } from '../lib/ui';
import { AUDIENCE_LABEL, SENDER_LABEL, sendersFor, type Audience, type Sender } from '../lib/types';
import { toDrafts, uploadImages, MAX_IMAGES, type Draft } from '../lib/images';
import { Icon } from '../components/Icon';

/**
 * «Del fra feltet»: rask nyhet fra telefonen med bilder og noen få ord.
 * Første linje blir overskrift, resten blir tekst. Push er av som standard.
 */
export function splitText(text: string): { title: string; body: string } {
  const t = text.trim();
  const [first, ...rest] = t.split(/\n+/);
  if (first.length <= 120) return { title: first.trim(), body: rest.join('\n').trim() };
  // Lang første linje: kutt etter siste hele setning innen 120 tegn, ellers ved et ord
  const head = first.slice(0, 120);
  const ends = [...head.matchAll(/[.!?](?=\s|$)/g)];
  const end = ends.length ? ends[ends.length - 1].index! + 1 : -1;
  if (end > 30) return { title: head.slice(0, end).trim(), body: t.slice(end).trim() };
  const cut = first.lastIndexOf(' ', 100);
  return { title: `${first.slice(0, cut > 30 ? cut : 100).trim()} …`, body: t };
}

export function QuickPostPage({ go }: { go: (r: string) => void }) {
  const me = useMe();
  const toast = useToast();
  const senders = sendersFor(me.roles).filter((s) => s !== 'admin');
  const [sender, setSender] = useState<Sender>(senders[0] ?? 'grunneier');
  const [audience, setAudience] = useState<Audience>('alle');
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');

  useEffect(() => () => drafts.forEach((d) => URL.revokeObjectURL(d.url)), [drafts]);

  function pick(files: FileList | null) {
    const { drafts: add, skipped } = toDrafts(files, drafts.length);
    setDrafts((d) => [...d, ...add]);
    if (skipped) toast(`Du kan legge ved opptil ${MAX_IMAGES} bilder.`);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) { toast('Skriv noen ord om bildene.'); return; }
    setBusy(true);
    let images: string[] = [];
    try {
      if (drafts.length) { setStep(`Laster opp ${drafts.length} ${drafts.length === 1 ? 'bilde' : 'bilder'} …`); images = await uploadImages('nyheter', sender, drafts); }
    } catch { setBusy(false); setStep(''); toast('Bildene ble ikke lastet opp. Sjekk dekningen og prøv igjen.'); return; }
    setStep('Publiserer …');
    const { title, body } = splitText(text);
    const { error } = await supabase.from('news').insert({ sender, audience, title, body, notify, images });
    setBusy(false); setStep('');
    if (error) {
      if (images.length) await supabase.storage.from('nyheter').remove(images);
      toast('Det ble ikke publisert. Prøv igjen.'); return;
    }
    toast(notify ? 'Publisert, og mottakerne har fått varsel.' : 'Publisert i Nyheter.');
    go('nyheter');
  }

  if (!senders.length) return <div className="empty">Bare grunneier og styrene kan publisere.</div>;
  const preview = text.trim() ? splitText(text) : null;

  return (
    <form className="quickpost" onSubmit={submit}>
      {drafts.length === 0 ? (
        <div className="qp-pick">
          <label><Icon name="camera" size={34} />Ta bilde
            <input type="file" accept="image/*" capture="environment" onChange={(e) => { pick(e.target.files); e.target.value = ''; }} /></label>
          <label><Icon name="news" size={34} />Velg bilder
            <input type="file" accept="image/*" multiple onChange={(e) => { pick(e.target.files); e.target.value = ''; }} /></label>
        </div>
      ) : (
        <div className="qp-thumbs">
          {drafts.map((d) => (
            <div key={d.key} className="t" style={{ backgroundImage: `url("${d.url}")` }}>
              <button type="button" aria-label="Fjern bildet" onClick={() => setDrafts((x) => x.filter((y) => y.key !== d.key))}><Icon name="x" size={16} /></button>
            </div>
          ))}
          {drafts.length < MAX_IMAGES && (
            <label className="add" aria-label="Legg til flere bilder"><Icon name="plus" size={28} />
              <input type="file" accept="image/*" multiple onChange={(e) => { pick(e.target.files); e.target.value = ''; }} /></label>
          )}
        </div>
      )}

      <label className="field" htmlFor="qp-text">Hva skjer?
        <textarea id="qp-text" value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="enter"
          placeholder={'F.eks. Grøftene langs nye Mørvikåsen er ferdige.\nAsfalt kommer neste uke.'} />
        <span className="hint">Første linje blir overskrift.{preview?.title ? <> Overskrift: <b>{preview.title}</b></> : ''}</span>
      </label>

      <div className="qp-opts">
        <div className="row">
          {senders.length > 1 && (
            <label className="field" htmlFor="qp-from">Fra
              <select id="qp-from" value={sender} onChange={(e) => { const s = e.target.value as Sender; setSender(s); if (s !== 'vei' && audience === 'torpum') setAudience('alle'); }}>
                {senders.map((s) => <option key={s} value={s}>{SENDER_LABEL[s]}</option>)}
              </select>
            </label>
          )}
          <label className="field" htmlFor="qp-aud">Til
            <select id="qp-aud" value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
              {(Object.keys(AUDIENCE_LABEL) as Audience[]).filter((a) => a !== 'torpum' || sender === 'vei').map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
            </select>
          </label>
        </div>
        <label className="pref" style={{ padding: 0, border: 0 }}>
          <span>Send push-varsel<small>Bruk for viktige ting. Vanlige oppdateringer vises i Nyheter uten pling.</small></span>
          <input type="checkbox" className="tg" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        </label>
      </div>

      <button className="btn primary qp-send" disabled={busy || !text.trim()}>
        {busy ? step || 'Publiserer …' : <><Icon name="send" size={20} />Publiser</>}
      </button>
    </form>
  );
}
