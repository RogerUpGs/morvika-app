// Mørvika Hytteområde · Edge Function «push»
//
// Databasen kaller denne funksjonen når det lagres et nytt varsel, en nyhet,
// en melding eller en kommentar. Funksjonen spør databasen hvem som skal ha
// varsel (push_targets) og sender push til telefonene deres. Den rydder også
// bort filer fra Min hytte når fristen etter et eierskifte har gått ut.
//
// Oppsett i Supabase (Edge Functions):
//   * Navn: push. «Verify JWT with legacy secret» / «Enforce JWT» skal være AV.
//   * Secrets: VAPID_PUBLIC_KEY og VAPID_PRIVATE_KEY (lages i appen under Administrasjon).
//   * SMS (valgfritt): ELKS_API_USERNAME og ELKS_API_PASSWORD fra 46elks.se (Account → API).
//     Uten dem sendes ingen SMS, og forsøket vises som feilet i appen.
// SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY legges inn av Supabase automatisk.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
webpush.setVapidDetails('mailto:noreply@morvika.no', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

async function emptyTrash() {
  const { data } = await supa.from('storage_trash').select('bucket,path').limit(1000);
  const rows = (data ?? []) as { bucket: string; path: string }[];
  let removed = 0;
  for (const bucket of new Set(rows.map((r) => r.bucket))) {
    const paths = rows.filter((r) => r.bucket === bucket).map((r) => r.path);
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error } = await supa.storage.from(bucket).remove(chunk);
      if (error) { console.error('sletting feilet', bucket, error.message); continue; }
      await supa.from('storage_trash').delete().eq('bucket', bucket).in('path', chunk);
      removed += chunk.length;
    }
  }
  return { removed };
}

// ---------------------------------------------------------------------
// SMS via 46elks
// ---------------------------------------------------------------------
interface SmsResult { status: 'sendt' | 'feilet'; parts: number; cost: number | null; provider_id: string | null; error: string | null }

async function sendSms(to: string, message: string, from: string): Promise<SmsResult> {
  // trim(): mellomrom eller linjeskift som følger med ved innliming gir «401» hos 46elks
  const user = Deno.env.get('ELKS_API_USERNAME')?.trim(); const pass = Deno.env.get('ELKS_API_PASSWORD')?.trim();
  if (!user || !pass) return { status: 'feilet', parts: 0, cost: null, provider_id: null, error: 'SMS er ikke satt opp: ELKS_API_USERNAME/ELKS_API_PASSWORD mangler i Supabase' };
  try {
    const res = await fetch('https://api.46elks.com/a1/sms', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${user}:${pass}`), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ from, to, message }),
    });
    const text = await res.text();
    if (res.status === 401) return { status: 'feilet', parts: 0, cost: null, provider_id: null, error: `46elks godtar ikke API-nøkkelen (401). Sjekk at ELKS_API_USERNAME (begynner på «u») og ELKS_API_PASSWORD er API-nøklene fra Account hos 46elks, ikke innloggingen din. Brukernavnet som ble brukt begynner på «${user.slice(0, 2)}» og har ${user.length} tegn.` };
    if (!res.ok) return { status: 'feilet', parts: 0, cost: null, provider_id: null, error: `46elks ${res.status}: ${text.slice(0, 200)}` };
    const r = JSON.parse(text) as { id?: string; status?: string; parts?: number; cost?: number };
    if (r.status === 'failed') return { status: 'feilet', parts: r.parts ?? 0, cost: null, provider_id: r.id ?? null, error: 'Avvist av 46elks' };
    return { status: 'sendt', parts: r.parts ?? 1, cost: typeof r.cost === 'number' ? r.cost / 10000 : null, provider_id: r.id ?? null, error: null };
  } catch (e) {
    return { status: 'feilet', parts: 0, cost: null, provider_id: null, error: (e as Error).message.slice(0, 200) };
  }
}

/** Kjører oppgavene med høyst n samtidig */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

interface SmsTarget { phone: string; full_name: string; cabins: string; message: string; sender: string; sms_from: string }

async function smsForAlert(id: string) {
  const { data, error } = await supa.rpc('sms_targets', { p_alert: id });
  if (error) { console.error('sms_targets', error.message); return { sms: 0 }; }
  const list = (data ?? []) as SmsTarget[];
  if (!list.length) return { sms: 0 };
  const results = await pool(list, 5, (t) => sendSms(t.phone, t.message, t.sms_from));
  const rows = list.map((t, k) => ({ alert_id: id, sender: t.sender, phone: t.phone, person_name: t.full_name, cabin_label: t.cabins, ...results[k] }));
  const { error: e2 } = await supa.rpc('sms_record', { p_rows: rows });
  if (e2) console.error('sms_record', e2.message);
  return { sms: results.filter((r) => r.status === 'sendt').length, sms_failed: results.filter((r) => r.status === 'feilet').length };
}

async function smsForBatch(id: string) {
  const { data, error } = await supa.rpc('sms_batch_targets', { p_batch: id });
  if (error) console.error('sms_batch_targets', error.message);
  const list = (data ?? []) as SmsTarget[];
  const results = await pool(list, 5, (t) => sendSms(t.phone, t.message, t.sms_from));
  if (list.length) {
    const rows = list.map((t, k) => ({ batch_id: id, sender: t.sender, phone: t.phone, person_name: t.full_name, cabin_label: t.cabins, ...results[k] }));
    const { error: e2 } = await supa.rpc('sms_record', { p_rows: rows });
    if (e2) console.error('sms_record', e2.message);
  }
  const sent = results.filter((r) => r.status === 'sendt').length;
  const failed = results.length - sent;
  // Tom liste (SMS av, eller allerede sendt): bare merk som ferdig hvis den fortsatt venter
  const upd = supa.from('sms_batches').update({ status: 'ferdig', sent, failed }).eq('id', id);
  await (list.length ? upd : upd.eq('status', 'venter'));
  return { sms: sent, sms_failed: failed };
}

async function smsTest(id: string) {
  const { data } = await supa.rpc('sms_test_target', { p_test: id });
  const t = ((data ?? []) as { phone: string | null; message: string; sms_from: string }[])[0];
  if (!t) return { sms: 0 };
  const r = t.phone ? await sendSms(t.phone, t.message, t.sms_from)
    : { status: 'feilet' as const, parts: 0, cost: null, provider_id: null, error: 'Ugyldig mobilnummer' };
  await supa.from('sms_tests').update({ status: r.status, error: r.error }).eq('id', id);
  if (t.phone) await supa.rpc('sms_record', { p_rows: [{ test_id: id, sender: 'admin', phone: t.phone, person_name: 'Test', ...r }] });
  return { sms: r.status === 'sendt' ? 1 : 0, error: r.error };
}

interface Target { user_id: string; title: string; body: string; url: string; tag: string; urgent: boolean }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: true });
  const { table, id } = await req.json().catch(() => ({} as Record<string, string>));
  // Databasen (push_targets) avgjør hva som skal sendes; ukjente tabeller gir ingen mottakere
  if (!/^[a-z_]{1,40}$/.test(table ?? '') || !/^[0-9a-f-]{36}$/i.test(id ?? '')) return json({ error: 'ugyldig' }, 400);

  // Rydding: slett filer som databasen har lagt i storage_trash (Min hytte etter fristen ved eierskifte)
  if (table === 'storage_trash') return json(await emptyTrash());
  if (table === 'sms_tests') return json(await smsTest(id));
  if (table === 'sms_batches') return json(await smsForBatch(id));

  // Varsler kan også gå som SMS (databasen avgjør om, og til hvem)
  const smsJob = table === 'alerts' ? smsForAlert(id) : Promise.resolve({});

  const { data: targets, error } = await supa.rpc('push_targets', { p_table: table, p_id: id });
  if (error) return json({ error: error.message, ...(await smsJob) }, 500);
  const list = (targets ?? []) as Target[];
  if (!list.length) return json({ sent: 0, ...(await smsJob) });

  const byUser = new Map(list.map((t) => [t.user_id, t]));
  const { data: subs } = await supa.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth').in('user_id', [...byUser.keys()]);

  let sent = 0;
  const gone: string[] = [];
  await Promise.all((subs ?? []).map(async (s) => {
    const t = byUser.get(s.user_id)!;
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: t.title, body: t.body, url: t.url, tag: t.tag, urgent: t.urgent }),
        { TTL: 60 * 60 * 24, urgency: t.urgent ? 'high' : 'normal' },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.push(s.id);   // Telefonen har slått av varsler eller appen er fjernet
      else console.error('push feilet', code, (e as Error).message);
    }
  }));
  if (gone.length) await supa.from('push_subscriptions').delete().in('id', gone);
  return json({ sent, removed: gone.length, users: byUser.size, ...(await smsJob) });
});
