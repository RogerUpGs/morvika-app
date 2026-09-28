import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useMe } from '../lib/session';
import { useToast } from '../lib/ui';
import { usePush } from '../lib/push';
import { REPEAT_LABEL, TASK_COLS, type Repeat, type Task } from '../lib/tasks';
import { Icon } from '../components/Icon';

const REMIND: [number, string][] = [[0, 'Ved tidspunktet'], [15, '15 minutter før'], [60, '1 time før'], [1440, '1 dag før'], [10080, '1 uke før']];
const NAG: [number | null, string][] = [[null, 'Nei'], [60, 'Hver time'], [1440, 'Hver dag']];

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

function when(iso: string): string {
  const d = new Date(iso); const now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const t = d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
  if (sameDay(d, now)) return `I dag kl. ${t}`;
  if (sameDay(d, tomorrow)) return `I morgen kl. ${t}`;
  if (sameDay(d, yesterday)) return `I går kl. ${t}`;
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return `${d.toLocaleDateString('nb-NO', opts)} kl. ${t}`;
}

/** Egen side: gjøremål med påminnelse på telefonen */
export function GjoremalPage() {
  const me = useMe();
  const toast = useToast();
  const push = usePush();
  const uid = me.session?.user.id ?? '';
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [form, setForm] = useState<Task | 'ny' | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const { data, error } = await supabase.from('tasks').select(TASK_COLS)
      .or(`done_at.is.null,done_at.gte.${since}`).order('due_at', { ascending: true }).limit(300);
    if (error) { setTasks([]); toast('Gjøremålene kunne ikke hentes. Er databasen oppdatert?'); return; }
    setTasks((data ?? []) as Task[]);
  }, [toast]);
  useEffect(() => { void load(); }, [load]);
  const changed = () => { window.dispatchEvent(new Event('tasks-changed')); void load(); };

  const cabinLabel = (id: string | null) => me.cabins.find((c) => c.id === id)?.label ?? 'hytta';
  const now = Date.now();
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
  const open = (tasks ?? []).filter((t) => !t.done_at);
  const groups: [string, Task[], string][] = [
    ['Forfalt', open.filter((t) => new Date(t.due_at).getTime() < now), 'late'],
    ['I dag', open.filter((t) => { const d = new Date(t.due_at).getTime(); return d >= now && d <= endToday.getTime(); }), 'today'],
    ['Kommende', open.filter((t) => new Date(t.due_at).getTime() > endToday.getTime()), ''],
  ];
  const done = (tasks ?? []).filter((t) => t.done_at).sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''));

  async function toggleDone(t: Task) {
    const { error } = await supabase.from('tasks').update({ done_at: t.done_at ? null : new Date().toISOString() }).eq('id', t.id);
    if (error) { toast('Endringen ble ikke lagret.'); return; }
    if (!t.done_at) toast(t.repeat !== 'ingen' ? `Utført. Neste gang er lagt inn (${REPEAT_LABEL[t.repeat].toLowerCase()}).` : 'Utført.');
    changed();
  }
  async function snooze(t: Task, until: Date, label: string) {
    setSnoozeFor(null);
    const { error } = await supabase.from('tasks').update({ next_remind_at: until.toISOString() }).eq('id', t.id);
    if (error) { toast('Utsettelsen ble ikke lagret.'); return; }
    toast(`Du blir minnet på igjen ${label}.`);
    changed();
  }
  async function remove(t: Task) {
    setConfirmDel(null);
    const { error } = await supabase.from('tasks').delete().eq('id', t.id);
    if (error) { toast('Gjøremålet ble ikke slettet.'); return; }
    changed();
  }

  function snoozeOptions(): [string, Date][] {
    const inHour = new Date(Date.now() + 3600_000);
    const tonight = new Date(); tonight.setHours(19, 0, 0, 0);
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
    const week = new Date(); week.setDate(week.getDate() + 7); week.setHours(9, 0, 0, 0);
    const list: [string, Date][] = [['om 1 time', inHour]];
    if (tonight.getTime() > Date.now() + 30 * 60_000) list.push(['i kveld kl. 19', tonight]);
    list.push(['i morgen kl. 09', tomorrow], ['om en uke', week]);
    return list;
  }

  function row(t: Task, kind: string) {
    const shared = Boolean(t.cabin_id);
    const mine = t.created_by === uid;
    return (
      <div key={t.id} className={`taskrow ${kind} ${t.done_at ? 'done' : ''}`}>
        <button className="taskcheck" onClick={() => void toggleDone(t)} aria-label={t.done_at ? `Angre utført: ${t.title}` : `Marker som utført: ${t.title}`} aria-pressed={Boolean(t.done_at)}>
          {t.done_at && <Icon name="check" size={18} />}
        </button>
        <div className="taskmain">
          <b>{t.title}</b>
          <div className="taskmeta">
            <span className={kind === 'late' ? 'lateTxt' : ''}><Icon name="clock" size={14} />{when(t.due_at)}</span>
            {t.repeat !== 'ingen' && <span><Icon name="repeat" size={14} />{REPEAT_LABEL[t.repeat]}</span>}
            {shared && <span title="Delt med eierne av hytta"><Icon name="users" size={14} />{cabinLabel(t.cabin_id)}</span>}
            {!t.done_at && t.next_remind_at && new Date(t.next_remind_at).getTime() > now && new Date(t.next_remind_at).getTime() !== new Date(t.due_at).getTime() - t.remind_before_min * 60_000 && (
              <span><Icon name="bell" size={14} />Påminnelse {when(t.next_remind_at).toLowerCase()}</span>
            )}
          </div>
          {t.note && <p className="tasknote">{t.note}</p>}
          {!t.done_at && (
            <div className="taskacts">
              {snoozeFor === t.id ? (
                <span className="snooze">Påminn meg
                  {snoozeOptions().map(([label, d]) => <button key={label} className="btn small" onClick={() => void snooze(t, d, label)}>{label}</button>)}
                  <button className="btn small ghost" onClick={() => setSnoozeFor(null)}>Avbryt</button>
                </span>
              ) : confirmDel === t.id ? (
                <span className="confirm">Slette gjøremålet?
                  <button className="btn small danger-btn" onClick={() => void remove(t)}>Slett</button>
                  <button className="btn small ghost" onClick={() => setConfirmDel(null)}>Avbryt</button></span>
              ) : (
                <>
                  <button className="btn small" onClick={() => setSnoozeFor(t.id)}><Icon name="clock" size={16} />Utsett</button>
                  <button className="btn small ghost" onClick={() => setForm(t)}>Rediger</button>
                  {(mine || shared) && <button className="linkbtn" onClick={() => setConfirmDel(t.id)}>Slett</button>}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="head-row">
        <p className="lede">Dine gjøremål med påminnelse på telefonen. Del dem med de andre eierne av hytta, så kan hvem som helst krysse av.</p>
        <button className="btn primary" onClick={() => setForm('ny')}><Icon name="plus" size={18} />Nytt gjøremål</button>
      </div>

      {push.state !== 'på' && push.state !== 'laster' && push.state !== 'ikke-satt-opp' && (
        <p className="tasknotice">
          <Icon name="bell" size={18} />
          {push.state === 'ios-hjemskjerm'
            ? 'For å få påminnelser på iPhone må appen ligge på hjemskjermen. Åpne den derfra og slå på varsler.'
            : push.state === 'av' ? <>Varsler er av på denne telefonen, så du får ikke påminnelser. <button className="linkbtn2" disabled={push.busy} onClick={async () => { const e = await push.enable(); toast(e ?? 'Varsler er slått på.'); }}>Slå på varsler</button></>
            : push.state === 'blokkert' ? 'Varsler er blokkert for appen i innstillingene på telefonen, så du får ikke påminnelser.'
            : 'Denne nettleseren kan ikke vise påminnelser. Bruk appen på telefonen.'}
        </p>
      )}

      {form && <TaskForm task={form === 'ny' ? null : form} onDone={() => { setForm(null); changed(); }} onCancel={() => setForm(null)} />}

      {tasks === null && <div className="empty">Henter …</div>}
      {tasks !== null && open.length === 0 && !form && (
        <div className="empty">Ingen gjøremål. Trykk «Nytt gjøremål», for eksempel «Tappe ned vannet» eller «Bytte batteri i røykvarsleren».</div>
      )}
      {groups.map(([title, list, kind]) => list.length > 0 && (
        <section key={title} className="taskgroup">
          <h3 className={kind === 'late' ? 'lateTxt' : ''}>{title} <span className="muted">({list.length})</span></h3>
          <div className="card tasklist">{list.map((t) => row(t, kind))}</div>
        </section>
      ))}
      {done.length > 0 && (
        <section className="taskgroup">
          <button className="linkbtn2" onClick={() => setShowDone((v) => !v)}>{showDone ? 'Skjul utførte' : `Vis utførte (${done.length})`}</button>
          {showDone && <div className="card tasklist" style={{ marginTop: 8 }}>{done.slice(0, 40).map((t) => row(t, ''))}</div>}
        </section>
      )}
    </>
  );
}

function TaskForm({ task, onDone, onCancel }: { task: Task | null; onDone: () => void; onCancel: () => void }) {
  const me = useMe();
  const toast = useToast();
  const start = useMemo(() => {
    if (task) return new Date(task.due_at);
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(12, 0, 0, 0); return d;
  }, [task]);
  const [title, setTitle] = useState(task?.title ?? '');
  const [note, setNote] = useState(task?.note ?? '');
  const [date, setDate] = useState(localDate(start));
  const [time, setTime] = useState(localTime(start));
  const [before, setBefore] = useState(task?.remind_before_min ?? 0);
  const [repeat, setRepeat] = useState<Repeat>(task?.repeat ?? 'ingen');
  const [nag, setNag] = useState<number | null>(task?.nag_min ?? null);
  const shareable = me.fullCabins;
  const [cabin, setCabin] = useState<string>(task?.cabin_id ?? '');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const due = new Date(`${date}T${time || '12:00'}`);
    if (Number.isNaN(due.getTime())) { toast('Sjekk dato og klokkeslett.'); return; }
    setBusy(true);
    const row = { title: title.trim(), note: note.trim(), due_at: due.toISOString(), remind_before_min: before, repeat, nag_min: nag };
    const { error } = task
      ? await supabase.from('tasks').update(row).eq('id', task.id)
      : await supabase.from('tasks').insert({ ...row, cabin_id: cabin || null });
    setBusy(false);
    if (error) { toast('Gjøremålet ble ikke lagret. Prøv igjen.'); return; }
    toast(task ? 'Gjøremålet er oppdatert.' : 'Gjøremålet er lagt inn.');
    onDone();
  }

  return (
    <form className="card form" onSubmit={submit} style={{ marginBottom: 18 }}>
      <label className="field full" htmlFor="t-title">Hva skal gjøres?
        <input id="t-title" type="text" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="F.eks. Tappe ned vannet før frosten" autoFocus />
      </label>
      <label className="field" htmlFor="t-date">Dato
        <input id="t-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="field" htmlFor="t-time">Klokkeslett
        <input id="t-time" type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
      </label>
      <label className="field" htmlFor="t-before">Påminnelse
        <select id="t-before" value={before} onChange={(e) => setBefore(Number(e.target.value))}>
          {REMIND.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="field" htmlFor="t-repeat">Gjenta
        <select id="t-repeat" value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
          {(Object.keys(REPEAT_LABEL) as Repeat[]).map((r) => <option key={r} value={r}>{REPEAT_LABEL[r]}</option>)}
        </select>
      </label>
      <label className="field" htmlFor="t-nag">Påminn igjen til det er gjort
        <select id="t-nag" value={nag ?? ''} onChange={(e) => setNag(e.target.value ? Number(e.target.value) : null)}>
          {NAG.map(([v, l]) => <option key={l} value={v ?? ''}>{l}</option>)}
        </select>
      </label>
      {!task && shareable.length > 0 && (
        <label className="field" htmlFor="t-share">Hvem ser gjøremålet
          <select id="t-share" value={cabin} onChange={(e) => setCabin(e.target.value)}>
            <option value="">Bare meg</option>
            {shareable.map((c) => <option key={c.id} value={c.id}>Alle eierne av {c.label}</option>)}
          </select>
        </label>
      )}
      <label className="field full" htmlFor="t-note">Notat (valgfritt)
        <textarea id="t-note" value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 60 }} placeholder="F.eks. hovedkranen står i boden" />
      </label>
      <div className="actions full">
        <button type="button" className="btn ghost" onClick={onCancel}>Avbryt</button>
        <button className="btn primary" disabled={busy || !title.trim()}>{busy ? 'Lagrer …' : task ? 'Lagre endringer' : 'Legg inn'}</button>
      </div>
    </form>
  );
}
