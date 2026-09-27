import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useMe } from '../lib/session';
import { useToast } from '../lib/ui';
import { rel, dLong } from '../lib/format';
import { AUDIENCE_LABEL, SENDER_LABEL, sendersFor, type AppRole, type Audience, type Sender } from '../lib/types';
import { Icon } from '../components/Icon';

export type Level = 'akutt' | 'viktig' | 'info';
export const LEVEL_LABEL: Record<Level, string> = { akutt: 'Akutt', viktig: 'Viktig', info: 'Til orientering' };
const LEVEL_HELP: Record<Level, string> = {
  akutt: 'Krever handling nå, for eksempel vannlekkasje, stengt vei eller brann',
  viktig: 'Mottakerne bør få det med seg, og blir bedt om å bekrefte',
  info: 'Til orientering, ingen bekreftelse',
};

export interface Alert { id: string; level: Level; sender: Sender; audience: Audience; title: string; body: string; created_by: string | null; created_at: string }

/** Kan brukeren sende som denne avsenderen? Da ser hen oversikten i stedet for å bekrefte. */
export const isSenderOf = (roles: AppRole[], s: Sender) => sendersFor(roles).includes(s);

/** Varsler som venter på at brukeren skal bekrefte (brukes av stripen øverst og startsiden). */
export async function fetchOpenAlerts(uid: string, roles: AppRole[]): Promise<Alert[]> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const [a, k] = await Promise.all([
    supabase.from('alerts').select('id,level,sender,audience,title,body,created_by,created_at').neq('level', 'info').gte('created_at', since).order('created_at', { ascending: false }),
    supabase.from('alert_acks').select('alert_id').eq('user_id', uid),
  ]);
  const acked = new Set((k.data ?? []).map((x) => x.alert_id as string));
  return ((a.data ?? []) as Alert[]).filter((x) => !acked.has(x.id) && x.created_by !== uid && !isSenderOf(roles, x.sender));
}

interface Recipient { person_id: string; full_name: string; cabins: string; status: 'bekreftet' | 'venter' | 'ikke_i_appen'; acked_at: string | null }

export function AlertsPage() {
  const me = useMe();
  const toast = useToast();
  const uid = me.session?.user.id ?? '';
  const senders = sendersFor(me.roles);
  const canSend = senders.length > 0;

  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const [ackCount, setAckCount] = useState<Record<string, number>>({});
  const [sizes, setSizes] = useState<Partial<Record<Audience, number>>>({});
  const [showForm, setShowForm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [openList, setOpenList] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, k] = await Promise.all([
      supabase.from('alerts').select('id,level,sender,audience,title,body,created_by,created_at').order('created_at', { ascending: false }).limit(60),
      supabase.from('alert_acks').select('alert_id,user_id'),
    ]);
    if (a.error) { setErr('Varslene kunne ikke hentes. Sjekk nettet og prøv igjen.'); return; }
    setErr(null);
    const list = (a.data ?? []) as Alert[];
    setAlerts(list);
    const mine = new Set<string>(); const count: Record<string, number> = {};
    for (const x of (k.data ?? []) as { alert_id: string; user_id: string }[]) {
      if (x.user_id === uid) mine.add(x.alert_id);
      count[x.alert_id] = (count[x.alert_id] ?? 0) + 1;
    }
    setAcked(mine); setAckCount(count);
    if (canSend) {
      const used = [...new Set(list.map((x) => x.audience))];
      const entries = await Promise.all(used.map(async (au) => [au, (await supabase.rpc('audience_size', { a: au })).data as number | null] as const));
      setSizes(Object.fromEntries(entries.filter(([, v]) => v !== null)));
    }
  }, [uid, canSend]);
  useEffect(() => { void load(); }, [load]);

  async function ack(a: Alert) {
    setAcked((s) => new Set(s).add(a.id));
    const { error } = await supabase.from('alert_acks').insert({ alert_id: a.id });
    if (error && error.code !== '23505') { toast('Bekreftelsen ble ikke lagret. Prøv igjen.'); void load(); return; }
    window.dispatchEvent(new Event('alerts-changed'));
  }

  async function remove(id: string) {
    const { error } = await supabase.from('alerts').delete().eq('id', id);
    setConfirmDel(null);
    if (error) toast('Varselet ble ikke slettet. Prøv igjen.');
    else { toast('Varselet er slettet.'); void load(); window.dispatchEvent(new Event('alerts-changed')); }
  }

  const open = (alerts ?? []).filter((a) => a.level !== 'info' && !acked.has(a.id) && a.created_by !== uid && !isSenderOf(me.roles, a.sender));

  return (
    <>
      <div className="head-row">
        <p className="lede">
          {canSend
            ? 'Varsler vises øverst i appen hos mottakerne til de har bekreftet at de har sett dem. Du ser hvem som har bekreftet.'
            : 'Viktige beskjeder fra grunneier og foreningene. Trykk «Jeg har sett varselet» når du har lest det.'}
        </p>
        {canSend && <button className="btn primary" onClick={() => setShowForm((v) => !v)}><Icon name="bell" size={18} />Send varsel</button>}
      </div>

      {canSend && showForm && <AlertForm senders={senders} onDone={() => { setShowForm(false); void load(); window.dispatchEvent(new Event('alerts-changed')); }} onCancel={() => setShowForm(false)} />}

      {open.length > 0 && <p className="muted" style={{ marginTop: 0 }}><b style={{ color: 'var(--ink)' }}>{open.length} {open.length === 1 ? 'varsel venter' : 'varsler venter'}</b> på at du bekrefter.</p>}
      {err && <div className="empty">{err} <button className="linkbtn2" onClick={() => void load()}>Prøv igjen</button></div>}
      {!err && alerts === null && <div className="empty">Henter varsler …</div>}

      <div className="stack">
        {(alerts ?? []).map((a) => {
          const stats = a.created_by === uid || isSenderOf(me.roles, a.sender);
          const done = acked.has(a.id);
          const n = ackCount[a.id] ?? 0;
          const size = sizes[a.audience];
          return (
            <article key={a.id} className={`card alert lv-${a.level}`}>
              <div className="meta">
                <span className="lvl">{LEVEL_LABEL[a.level]}</span>
                <span className={`badge ${a.sender === 'grunneier' ? '' : a.sender}`}>{SENDER_LABEL[a.sender]}</span>
                <span title={dLong(a.created_at)}>{rel(a.created_at)}</span>
              </div>
              <h3>{a.title}</h3>
              {a.body && <p style={{ whiteSpace: 'pre-line' }}>{a.body}</p>}
              <div className="foot">
                <span>Til: {AUDIENCE_LABEL[a.audience]}</span>
                {stats ? (
                  <span style={{ display: 'inline-flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    {a.level !== 'info' && <button className="linkbtn2 num" onClick={() => setOpenList(openList === a.id ? null : a.id)}>
                      Bekreftet av {n}{size ? ` av ${size}` : ''} · {openList === a.id ? 'Skjul liste' : 'Vis hvem'}
                    </button>}
                    {confirmDel === a.id ? (
                      <span className="confirm">Slette varselet?
                        <button className="btn small danger-btn" onClick={() => void remove(a.id)}>Slett</button>
                        <button className="btn small ghost" onClick={() => setConfirmDel(null)}>Avbryt</button>
                      </span>
                    ) : (a.created_by === uid || me.roles.includes('admin')) && <button className="linkbtn" onClick={() => setConfirmDel(a.id)}>Slett</button>}
                  </span>
                ) : a.level === 'info' ? null : done ? (
                  <span className="okmark"><Icon name="check" size={16} />Du har bekreftet</span>
                ) : (
                  <button className="btn small primary" onClick={() => void ack(a)}>Jeg har sett varselet</button>
                )}
              </div>
              {stats && openList === a.id && <RecipientList alertId={a.id} />}
            </article>
          );
        })}
        {alerts !== null && !err && alerts.length === 0 && (
          <div className="empty">{canSend ? 'Ingen varsler ennå. Bruk «Send varsel» når noe er viktig.' : 'Ingen varsler. Her dukker det opp beskjeder når noe er viktig.'}</div>
        )}
      </div>
    </>
  );
}

function RecipientList({ alertId }: { alertId: string }) {
  const [rows, setRows] = useState<Recipient[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    supabase.rpc('alert_recipients', { p_alert: alertId }).then(({ data, error }) => {
      if (error) setErr(true); else setRows((data ?? []) as Recipient[]);
    });
  }, [alertId]);
  if (err) return <p className="muted" style={{ marginTop: 10 }}>Listen kunne ikke hentes. Sjekk at databasen er oppdatert.</p>;
  if (!rows) return <p className="muted" style={{ marginTop: 10 }}>Henter …</p>;
  const groups: [Recipient['status'], string][] = [['venter', 'Har ikke bekreftet'], ['ikke_i_appen', 'Har ikke logget inn i appen ennå'], ['bekreftet', 'Har bekreftet']];
  return (
    <div className="rcpts">
      {groups.map(([st, title]) => {
        const list = rows.filter((r) => r.status === st).sort((x, y) => x.cabins.localeCompare(y.cabins, 'nb', { numeric: true }));
        if (!list.length) return null;
        return (
          <div key={st}>
            <h4>{title} <span className="muted">({list.length})</span></h4>
            <ul>{list.map((r) => <li key={r.person_id}><b>{r.full_name}</b><small>{r.cabins}</small></li>)}</ul>
          </div>
        );
      })}
      {rows.some((r) => r.status !== 'bekreftet') && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Ring eller send SMS fra forvaltningssystemet til dem som ikke har bekreftet, hvis det haster.</p>}
    </div>
  );
}

function AlertForm({ senders, onDone, onCancel }: { senders: Sender[]; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [level, setLevel] = useState<Level>('viktig');
  const [sender, setSender] = useState<Sender>(senders[0]);
  const [audience, setAudience] = useState<Audience>('alle');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from('alerts').insert({ level, sender, audience, title: title.trim(), body: body.trim() });
    setBusy(false);
    if (error) { toast('Varselet ble ikke sendt. Prøv igjen.'); return; }
    toast('Varselet er sendt.');
    onDone();
  }

  return (
    <form className="card form" onSubmit={submit}>
      <div className="field full">Viktighet
        <div className="seg three" role="radiogroup" aria-label="Viktighet">
          {(Object.keys(LEVEL_LABEL) as Level[]).map((l) => (
            <button type="button" key={l} role="radio" aria-checked={level === l} className={`${level === l ? 'on' : ''} lv-${l}`} onClick={() => setLevel(l)}>
              {LEVEL_LABEL[l]}
            </button>
          ))}
        </div>
        <span className="hint">{LEVEL_HELP[level]}</span>
      </div>
      <label className="field" htmlFor="al-sender">Fra
        <select id="al-sender" value={sender} onChange={(e) => {
          const s = e.target.value as Sender;
          setSender(s);
          if (s !== 'vei' && audience === 'torpum') setAudience('alle');
        }}>
          {senders.map((s) => <option key={s} value={s}>{SENDER_LABEL[s]}</option>)}
        </select>
      </label>
      <label className="field" htmlFor="al-aud">Til
        <select id="al-aud" value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
          {(Object.keys(AUDIENCE_LABEL) as Audience[]).filter((a) => a !== 'torpum' || sender === 'vei').map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
        </select>
      </label>
      <label className="field full" htmlFor="al-title">Overskrift
        <input id="al-title" type="text" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="F.eks. Vannet stenges i kveld kl. 20" />
      </label>
      <label className="field full" htmlFor="al-body">Tekst
        <textarea id="al-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Hva har skjedd, og hva må hytteeierne gjøre?" />
      </label>
      <p className="muted full" style={{ margin: 0, fontSize: 14 }}>
        Varselet vises øverst i appen hos alle mottakerne til de har bekreftet. Push-varsel til telefonen kommer i en senere versjon.
      </p>
      <div className="actions full">
        <button type="button" className="btn ghost" onClick={onCancel}>Avbryt</button>
        <button className={`btn primary ${level === 'akutt' ? 'danger-fill' : ''}`} disabled={busy || !title.trim()}>{busy ? 'Sender …' : 'Send varsel nå'}</button>
      </div>
    </form>
  );
}
