import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useMe } from '../lib/session';
import { useToast } from '../lib/ui';
import { AUDIENCE_LABEL, SENDER_LABEL, sendersFor, type Audience, type Sender } from '../lib/types';
import { nameOf, placeOf, useDirectory } from '../lib/people';
import { Icon } from '../components/Icon';

interface Ev {
  id: string; title: string; starts_at: string; ends_at: string | null; place: string; description: string;
  organizer: Sender; audience: Audience; created_by: string | null; notify: boolean;
}
interface Att { event_id: string; user_id: string; persons: number }

const nb = 'nb-NO';
const tm = (d: string) => new Date(d).toLocaleTimeString(nb, { hour: '2-digit', minute: '2-digit' });
const day = (d: string) => { const s = new Date(d).toLocaleDateString(nb, { weekday: 'long', day: 'numeric', month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1); };
const mon = (d: string) => new Date(d).toLocaleDateString(nb, { month: 'short' }).replace('.', '');
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

/** Neste arrangement (til startsiden) */
export async function nextEvent(): Promise<Ev | null> {
  const { data } = await supabase.from('events').select('id,title,starts_at,ends_at,place,description,organizer,audience,created_by,notify')
    .gte('starts_at', new Date().toISOString()).order('starts_at').limit(1);
  return ((data ?? []) as Ev[])[0] ?? null;
}

export function EventsPage() {
  const me = useMe();
  const toast = useToast();
  const dir = useDirectory();
  const uid = me.session?.user.id ?? '';
  const senders = sendersFor(me.roles).filter((s) => s !== 'admin');
  const canCreate = senders.length > 0;

  const [events, setEvents] = useState<Ev[] | null>(null);
  const [past, setPast] = useState<Ev[]>([]);
  const [att, setAtt] = useState<Att[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [openList, setOpenList] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const cols = 'id,title,starts_at,ends_at,place,description,organizer,audience,created_by,notify';
    const [u, p] = await Promise.all([
      supabase.from('events').select(cols).gte('starts_at', startOfToday()).order('starts_at').limit(100),
      supabase.from('events').select(cols).lt('starts_at', startOfToday()).order('starts_at', { ascending: false }).limit(12),
    ]);
    if (u.error) { setErr('Arrangementene kunne ikke hentes. Sjekk nettet og prøv igjen.'); return; }
    setErr(null);
    const list = (u.data ?? []) as Ev[];
    setEvents(list); setPast((p.data ?? []) as Ev[]);
    const ids = [...list, ...((p.data ?? []) as Ev[])].map((e) => e.id);
    if (ids.length) {
      const a = await supabase.from('event_attendees').select('event_id,user_id,persons').in('event_id', ids);
      setAtt((a.data ?? []) as Att[]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const byEvent = useMemo(() => {
    const m: Record<string, Att[]> = {};
    for (const a of att) (m[a.event_id] ??= []).push(a);
    return m;
  }, [att]);

  async function signUp(e: Ev, persons: number) {
    const mine = (byEvent[e.id] ?? []).find((a) => a.user_id === uid);
    const { error } = mine
      ? await supabase.from('event_attendees').update({ persons }).eq('event_id', e.id).eq('user_id', uid)
      : await supabase.from('event_attendees').insert({ event_id: e.id, persons });
    if (error) { toast('Påmeldingen ble ikke lagret. Prøv igjen.'); return; }
    toast(mine ? 'Antallet er endret.' : `Du er påmeldt ${e.title}. Du får en påminnelse dagen før.`);
    void load();
  }
  async function signOff(e: Ev) {
    const { error } = await supabase.from('event_attendees').delete().eq('event_id', e.id).eq('user_id', uid);
    if (error) { toast('Det gikk ikke. Prøv igjen.'); return; }
    toast('Du er meldt av.'); void load();
  }
  async function remove(id: string) {
    const { error } = await supabase.from('events').delete().eq('id', id);
    setConfirmDel(null);
    if (error) toast('Arrangementet ble ikke slettet.'); else { toast('Arrangementet er slettet.'); void load(); }
  }

  const card = (e: Ev, isPast = false) => {
    const list = byEvent[e.id] ?? [];
    const mine = list.find((a) => a.user_id === uid);
    const people = list.reduce((s, a) => s + a.persons, 0);
    const organizerView = e.created_by === uid || sendersFor(me.roles).includes(e.organizer);
    return (
      <article key={e.id} className={`card ev ${isPast ? 'past' : ''}`}>
        <div className="date"><b>{new Date(e.starts_at).getDate()}</b><span>{mon(e.starts_at)}</span></div>
        <div style={{ minWidth: 0 }}>
          <span className={`badge ${e.organizer === 'grunneier' ? '' : e.organizer}`}>{SENDER_LABEL[e.organizer]}</span>
          <h3 className="serif">{e.title}</h3>
          <p className="when">{day(e.starts_at)} kl. {tm(e.starts_at)}{e.ends_at ? `–${tm(e.ends_at)}` : ''}{e.place ? ` · ${e.place}` : ''}</p>
          {e.description && <p className="desc">{e.description}</p>}
          <div className="row">
            <span className="muted num">{list.length ? `${list.length} påmeldt${people > list.length ? ` · ${people} personer` : ''}` : 'Ingen påmeldt ennå'}</span>
            {!isPast && (mine ? (
              <span className="evme">
                <span className="okmark"><Icon name="check" size={16} />Du kommer{mine.persons > 1 ? ` (${mine.persons})` : ''}</span>
                <select aria-label="Antall personer" value={mine.persons} onChange={(x) => void signUp(e, Number(x.target.value))}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} {n === 1 ? 'person' : 'personer'}</option>)}
                </select>
                <button className="linkbtn" onClick={() => void signOff(e)}>Meld av</button>
              </span>
            ) : <SignUp onSign={(n) => void signUp(e, n)} />)}
          </div>
          {organizerView && (
            <div className="evadmin">
              {list.length > 0 && <button className="linkbtn2" onClick={() => setOpenList(openList === e.id ? null : e.id)}>{openList === e.id ? 'Skjul påmeldte' : 'Vis påmeldte'}</button>}
              {confirmDel === e.id ? (
                <span className="confirm">Slette arrangementet?
                  <button className="btn small danger-btn" onClick={() => void remove(e.id)}>Slett</button>
                  <button className="btn small ghost" onClick={() => setConfirmDel(null)}>Avbryt</button>
                </span>
              ) : (e.created_by === uid || me.roles.includes('admin')) && <button className="linkbtn" onClick={() => setConfirmDel(e.id)}>Slett</button>}
            </div>
          )}
          {organizerView && openList === e.id && (
            <ul className="attlist">
              {list.map((a) => (
                <li key={a.user_id}><b>{nameOf(dir, a.user_id)}</b> <span className="muted">{placeOf(dir.get(a.user_id))}</span>{a.persons > 1 && <span className="pill">{a.persons} pers.</span>}</li>
              ))}
            </ul>
          )}
        </div>
      </article>
    );
  };

  return (
    <>
      <div className="head-row">
        <p className="lede">
          {me.veilagOnly ? 'Årsmøter og dugnader i Mørvikveien Veilag.' : 'Dugnader, møter og sosiale treff. Meld deg på, så vet arrangøren hvor mange som kommer. Du får en påminnelse dagen før.'}
        </p>
        {canCreate && <button className="btn primary" onClick={() => setShowForm((v) => !v)}><Icon name="plus" size={18} />Nytt arrangement</button>}
      </div>
      {canCreate && showForm && <EventForm senders={senders} onDone={() => { setShowForm(false); void load(); }} onCancel={() => setShowForm(false)} />}

      {err && <div className="empty">{err} <button className="linkbtn2" onClick={() => void load()}>Prøv igjen</button></div>}
      {!err && events === null && <div className="empty">Henter arrangementer …</div>}
      <div className="events">{events?.map((e) => card(e))}</div>
      {events && !err && events.length === 0 && (
        <div className="empty">{canCreate ? 'Ingen kommende arrangementer. Trykk «Nytt arrangement» for å legge ut dugnad, årsmøte eller et treff.' : 'Ingen kommende arrangementer.'}</div>
      )}
      {past.length > 0 && (
        <>
          <button className="linkbtn2" style={{ margin: '22px 0 10px' }} onClick={() => setShowPast((v) => !v)}>
            {showPast ? 'Skjul tidligere arrangementer' : `Vis tidligere arrangementer (${past.length})`}
          </button>
          {showPast && <div className="events">{past.map((e) => card(e, true))}</div>}
        </>
      )}
    </>
  );
}

function SignUp({ onSign }: { onSign: (n: number) => void }) {
  const [n, setN] = useState(1);
  return (
    <span className="evme">
      <select aria-label="Antall personer" value={n} onChange={(e) => setN(Number(e.target.value))}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((x) => <option key={x} value={x}>{x} {x === 1 ? 'person' : 'personer'}</option>)}
      </select>
      <button className="btn small primary" onClick={() => onSign(n)}>Jeg kommer</button>
    </span>
  );
}

function EventForm({ senders, onDone, onCancel }: { senders: Sender[]; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [organizer, setOrganizer] = useState<Sender>(senders[0]);
  const [audience, setAudience] = useState<Audience>('alle');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [from, setFrom] = useState('10:00');
  const [to, setTo] = useState('');
  const [place, setPlace] = useState('');
  const [description, setDescription] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!date) { toast('Velg dato.'); return; }
    const starts = new Date(`${date}T${from || '00:00'}`);
    const ends = to ? new Date(`${date}T${to}`) : null;
    if (ends && ends <= starts) { toast('Sluttidspunktet må være etter start.'); return; }
    setBusy(true);
    const { error } = await supabase.from('events').insert({
      organizer, audience, title: title.trim(), place: place.trim(), description: description.trim(), notify,
      starts_at: starts.toISOString(), ends_at: ends?.toISOString() ?? null,
    });
    setBusy(false);
    if (error) { toast('Arrangementet ble ikke lagret. Prøv igjen.'); return; }
    toast(notify ? 'Arrangementet er lagt ut, og mottakerne har fått varsel.' : 'Arrangementet er lagt ut.');
    onDone();
  }

  return (
    <form className="card form" onSubmit={submit}>
      <label className="field full" htmlFor="ev-title">Hva
        <input id="ev-title" type="text" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="F.eks. Dugnad på badeplassen" />
      </label>
      <label className="field" htmlFor="ev-date">Dato
        <input id="ev-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="field">Tid
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="time" aria-label="Fra klokken" required value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="muted">til</span>
          <input type="time" aria-label="Til klokken (valgfritt)" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <label className="field full" htmlFor="ev-place">Sted
        <input id="ev-place" type="text" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="F.eks. Badeplassen, eller Mørvikveien 12" />
      </label>
      <label className="field full" htmlFor="ev-desc">Beskrivelse
        <textarea id="ev-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Hva skal gjøres, hva bør man ta med, blir det servering?" />
      </label>
      <label className="field" htmlFor="ev-org">Arrangør
        <select id="ev-org" value={organizer} onChange={(e) => { const s = e.target.value as Sender; setOrganizer(s); if (s !== 'vei' && audience === 'torpum') setAudience('alle'); }}>
          {senders.map((s) => <option key={s} value={s}>{SENDER_LABEL[s]}</option>)}
        </select>
      </label>
      <label className="field" htmlFor="ev-aud">For
        <select id="ev-aud" value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
          {(Object.keys(AUDIENCE_LABEL) as Audience[]).filter((a) => a !== 'torpum' || organizer === 'vei').map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
        </select>
      </label>
      <label className="check full"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />Send push-varsel om arrangementet nå</label>
      <p className="muted full" style={{ margin: 0, fontSize: 14 }}>De påmeldte får en påminnelse på telefonen kvelden før.</p>
      <div className="actions full">
        <button type="button" className="btn ghost" onClick={onCancel}>Avbryt</button>
        <button className="btn primary" disabled={busy || !title.trim() || !date}>{busy ? 'Lagrer …' : 'Legg ut'}</button>
      </div>
    </form>
  );
}
