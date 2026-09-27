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

interface Target { user_id: string; title: string; body: string; url: string; tag: string; urgent: boolean }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: true });
  const { table, id } = await req.json().catch(() => ({} as Record<string, string>));
  // Databasen (push_targets) avgjør hva som skal sendes; ukjente tabeller gir ingen mottakere
  if (!/^[a-z_]{1,40}$/.test(table ?? '') || !/^[0-9a-f-]{36}$/i.test(id ?? '')) return json({ error: 'ugyldig' }, 400);

  // Rydding: slett filer som databasen har lagt i storage_trash (Min hytte etter fristen ved eierskifte)
  if (table === 'storage_trash') return json(await emptyTrash());

  const { data: targets, error } = await supa.rpc('push_targets', { p_table: table, p_id: id });
  if (error) return json({ error: error.message }, 500);
  const list = (targets ?? []) as Target[];
  if (!list.length) return json({ sent: 0 });

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
  return json({ sent, removed: gone.length, users: byUser.size });
});
