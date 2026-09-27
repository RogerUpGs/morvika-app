import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useMe } from '../lib/session';
import { useToast } from '../lib/ui';
import { dShort } from '../lib/format';
import { SENDER_LABEL, sendersFor, type Sender } from '../lib/types';
import { Icon } from '../components/Icon';

type Grp = 'grunneier' | 'vel' | 'vei' | 'nyttig';
const GRP_LABEL: Record<Grp, string> = { grunneier: 'Grunneier', vel: 'Mørvika Vel', vei: 'Mørvikveien Veilag', nyttig: 'Nyttige nummer' };
const CATEGORIES = ['Vedtekter', 'Referater', 'Vei og brøyting', 'Kart og tomter', 'Regler og avtaler', 'Annet'];

interface Contact { id: string; grp: Grp; title: string; name: string; phone: string | null; email: string | null; note: string; sort: number }
interface Doc { id: string; title: string; owner: Sender; storage_path: string; category: string; size_bytes: number | null; file_name: string | null; created_by: string | null; created_at: string }

const size = (b: number | null) => (b == null ? '' : b > 1_000_000 ? `${(b / 1_000_000).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1000))} kB`);
const tel = (p: string) => `tel:${p.replace(/[^\d+]/g, '')}`;
const safeName = (n: string) => n.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(-80);

export function InfoPage() {
  const me = useMe();
  const toast = useToast();
  const uid = me.session?.user.id ?? '';
  const isAdmin = me.roles.includes('admin');
  const publishAs: Sender[] = sendersFor(me.roles).filter((s) => s !== 'admin');
  const canEdit = (g: Grp) => g === 'grunneier' ? me.roles.includes('grunneier')
    : g === 'nyttig' ? me.roles.includes('grunneier') || isAdmin
    : publishAs.includes(g as Sender);

  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [adding, setAdding] = useState<Grp | null>(null);
  const [upload, setUpload] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, d] = await Promise.all([
      supabase.from('contacts').select('id,grp,title,name,phone,email,note,sort').order('sort').order('name'),
      supabase.from('shared_documents').select('id,title,owner,storage_path,category,size_bytes,file_name,created_by,created_at').order('created_at', { ascending: false }),
    ]);
    setContacts((c.data ?? []) as Contact[]);
    setDocs((d.data ?? []) as Doc[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function openDoc(d: Doc) {
    const w = window.open('', '_blank');
    const { data, error } = await supabase.storage.from('dokumenter').createSignedUrl(d.storage_path, 600);
    if (error || !data) { w?.close(); toast('Dokumentet kunne ikke åpnes.'); return; }
    if (w) w.location.href = data.signedUrl; else window.location.href = data.signedUrl;
  }
  async function removeDoc(d: Doc) {
    const { error } = await supabase.from('shared_documents').delete().eq('id', d.id);
    setConfirmDel(null);
    if (error) { toast('Dokumentet ble ikke slettet.'); return; }
    await supabase.storage.from('dokumenter').remove([d.storage_path]);
    toast('Dokumentet er slettet.'); void load();
  }
  async function removeContact(c: Contact) {
    const { error } = await supabase.from('contacts').delete().eq('id', c.id);
    setConfirmDel(null);
    if (error) toast('Kontakten ble ikke slettet.'); else void load();
  }

  const groups: Grp[] = me.veilagOnly ? ['vei', 'nyttig'] : ['grunneier', 'vel', 'vei', 'nyttig'];
  const docOwners: Sender[] = me.veilagOnly ? ['vei'] : ['grunneier', 'vel', 'vei'];

  return (
    <>
      <section>
        <div className="head-row" style={{ marginBottom: 10 }}>
          <h2 className="serif h2" style={{ margin: 0 }}>Dokumenter</h2>
          {publishAs.length > 0 && <button className="btn primary" onClick={() => setUpload((v) => !v)}><Icon name="plus" size={18} />Legg ut dokument</button>}
        </div>
        {upload && <DocForm owners={publishAs} uid={uid} onDone={() => { setUpload(false); void load(); }} onCancel={() => setUpload(false)} />}
        {docs === null && <div className="empty">Henter …</div>}
        {docs && (
          <div className="docgroups">
            {docOwners.map((o) => {
              const list = docs.filter((d) => d.owner === o);
              if (!list.length && !publishAs.includes(o)) return null;
              return (
                <div key={o} className="card docgroup">
                  <h3><span className={`badge ${o === 'grunneier' ? '' : o}`}>{SENDER_LABEL[o]}</span></h3>
                  {list.length === 0 && <p className="muted" style={{ margin: 0 }}>Ingen dokumenter ennå.</p>}
                  {list.map((d) => (
                    <div key={d.id} className="docrow2">
                      <button className="doclink" onClick={() => void openDoc(d)}>
                        <Icon name="doc" size={20} />
                        <span><b>{d.title}</b><small>{d.category} · {dShort(d.created_at)}{d.size_bytes ? ` · ${size(d.size_bytes)}` : ''}</small></span>
                      </button>
                      {(d.created_by === uid || isAdmin || publishAs.includes(d.owner)) && (confirmDel === d.id ? (
                        <span className="confirm"><button className="btn small danger-btn" onClick={() => void removeDoc(d)}>Slett</button>
                          <button className="btn small ghost" onClick={() => setConfirmDel(null)}>Avbryt</button></span>
                      ) : <button className="linkbtn" onClick={() => setConfirmDel(d.id)}>Slett</button>)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 className="serif h2" style={{ margin: '0 0 10px' }}>Kontakter</h2>
        <div className="contacts">
          {groups.map((g) => {
            const list = (contacts ?? []).filter((c) => c.grp === g);
            if (!list.length && !canEdit(g)) return null;
            return (
              <div key={g} className="card cgroup">
                <h3>{GRP_LABEL[g]}</h3>
                {list.length === 0 && <p className="muted" style={{ margin: 0, fontSize: 14 }}>Ingen kontakter lagt inn.</p>}
                {list.map((c) => (
                  <div key={c.id} className="crow">
                    <div style={{ minWidth: 0 }}>
                      {c.title && <small>{c.title}</small>}
                      <b>{c.name}</b>
                      {c.note && <small>{c.note}</small>}
                    </div>
                    <div className="cacts">
                      {c.phone && <a className="btn small" href={tel(c.phone)}><Icon name="phone" size={16} />{c.phone}</a>}
                      {c.email && <a className="btn small ghost" href={`mailto:${c.email}`}><Icon name="mail" size={16} />E-post</a>}
                      {canEdit(g) && (confirmDel === c.id
                        ? <button className="btn small danger-btn" onClick={() => void removeContact(c)}>Slett</button>
                        : <button className="linkbtn" onClick={() => setConfirmDel(c.id)} aria-label={`Slett ${c.name}`}>Slett</button>)}
                    </div>
                  </div>
                ))}
                {canEdit(g) && (adding === g
                  ? <ContactForm grp={g} onDone={() => { setAdding(null); void load(); }} onCancel={() => setAdding(null)} />
                  : <button className="linkbtn2" style={{ marginTop: 8 }} onClick={() => setAdding(g)}>+ Legg til kontakt</button>)}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function ContactForm({ grp, onDone, onCancel }: { grp: Grp; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from('contacts').insert({ grp, title: title.trim(), name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, sort: 10 });
    setBusy(false);
    if (error) { toast('Kontakten ble ikke lagret.'); return; }
    onDone();
  }
  return (
    <form className="cform2" onSubmit={submit}>
      <input type="text" placeholder={grp === 'nyttig' ? 'Hva (f.eks. Brøyting)' : 'Rolle (f.eks. Leder)'} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Rolle" />
      <input type="text" required placeholder="Navn" value={name} onChange={(e) => setName(e.target.value)} aria-label="Navn" />
      <input type="text" inputMode="tel" placeholder="Telefon" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Telefon" />
      <input type="email" placeholder="E-post (valgfritt)" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="E-post" />
      <div className="actions"><button type="button" className="btn small ghost" onClick={onCancel}>Avbryt</button><button className="btn small primary" disabled={busy || !name.trim()}>Lagre</button></div>
    </form>
  );
}

function DocForm({ owners, uid, onDone, onCancel }: { owners: Sender[]; uid: string; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [owner, setOwner] = useState<Sender>(owners[0]);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (file.size > 25_000_000) { toast('Filen er for stor (over 25 MB).'); return; }
    setBusy(true);
    const path = `${owner}/${crypto.randomUUID()}-${safeName(file.name)}`;
    const up = await supabase.storage.from('dokumenter').upload(path, file, { contentType: file.type || 'application/octet-stream' });
    if (up.error) { setBusy(false); toast('Filen ble ikke lastet opp. Prøv igjen.'); return; }
    const { error } = await supabase.from('shared_documents').insert({
      title: title.trim() || file.name.replace(/\.[^.]+$/, ''), owner, storage_path: path, category, size_bytes: file.size, file_name: file.name, created_by: uid,
    });
    setBusy(false);
    if (error) { await supabase.storage.from('dokumenter').remove([path]); toast('Dokumentet ble ikke lagret. Prøv igjen.'); return; }
    toast('Dokumentet er lagt ut.');
    onDone();
  }

  return (
    <form className="card form" onSubmit={submit} style={{ marginBottom: 14 }}>
      <label className="field full" htmlFor="doc-file">Fil (PDF, Word, bilde)
        <input id="doc-file" type="file" required accept=".pdf,.doc,.docx,.xls,.xlsx,.odt,.txt,image/*" onChange={(e) => {
          const f = e.target.files?.[0] ?? null; setFile(f);
          if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
        }} />
      </label>
      <label className="field full" htmlFor="doc-title">Tittel
        <input id="doc-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="F.eks. Vedtekter for Mørvika Vel" />
      </label>
      <label className="field" htmlFor="doc-cat">Kategori
        <select id="doc-cat" value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
      </label>
      <label className="field" htmlFor="doc-owner">Fra
        <select id="doc-owner" value={owner} onChange={(e) => setOwner(e.target.value as Sender)}>{owners.map((o) => <option key={o} value={o}>{SENDER_LABEL[o]}</option>)}</select>
      </label>
      <div className="actions full">
        <button type="button" className="btn ghost" onClick={onCancel}>Avbryt</button>
        <button className="btn primary" disabled={busy || !file}>{busy ? 'Laster opp …' : 'Legg ut'}</button>
      </div>
    </form>
  );
}
