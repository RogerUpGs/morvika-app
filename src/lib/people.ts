import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { AppRole } from './types';

/** Navn, hytte og roller for personene innlogget bruker kan se. Hentes én gang og deles av sidene. */
export interface Person { id: string; name: string; cabins: string[]; roles: AppRole[] }
export type Directory = Map<string, Person>;

let cache: Promise<Directory> | null = null;
let stamp = 0;

async function fetchDirectory(): Promise<Directory> {
  const [p, o, r] = await Promise.all([
    supabase.from('profiles').select('id,full_name'),
    supabase.from('cabin_owners').select('user_id,cabin:cabins(label,number)'),
    supabase.from('user_roles').select('user_id,role'),
  ]);
  const dir: Directory = new Map();
  for (const x of (p.data ?? []) as { id: string; full_name: string }[]) {
    dir.set(x.id, { id: x.id, name: x.full_name || 'Uten navn', cabins: [], roles: [] });
  }
  const owned = ((o.data ?? []) as unknown as { user_id: string; cabin: { label: string; number: number } | null }[])
    .filter((x) => x.cabin)
    .sort((a, b) => a.cabin!.number - b.cabin!.number);
  for (const x of owned) dir.get(x.user_id)?.cabins.push(x.cabin!.label);
  for (const x of (r.data ?? []) as { user_id: string; role: AppRole }[]) dir.get(x.user_id)?.roles.push(x.role);
  return dir;
}

export function loadDirectory(force = false): Promise<Directory> {
  // Frisk opp etter fem minutter, så nye hytteeiere dukker opp
  if (!cache || force || Date.now() - stamp > 5 * 60_000) {
    stamp = Date.now();
    cache = fetchDirectory().catch((e) => { cache = null; throw e; });
  }
  return cache;
}

export function useDirectory(): Directory {
  const [dir, setDir] = useState<Directory>(new Map());
  useEffect(() => {
    let alive = true;
    loadDirectory().then((d) => { if (alive) setDir(d); }).catch(() => { /* navn vises som «Ukjent» */ });
    return () => { alive = false; };
  }, []);
  return dir;
}

/** «Hytte 12 · Mørvikveien», «Grunneier» eller «Styret Vel» */
export function placeOf(p: Person | undefined): string {
  if (!p) return '';
  if (p.cabins.length) return p.cabins[0];
  if (p.roles.includes('grunneier')) return 'Grunneier';
  if (p.roles.includes('styre_vel')) return 'Styret Vel';
  if (p.roles.includes('styre_va')) return 'Styret VA';
  if (p.roles.includes('styre_vei')) return 'Styret Veilag';
  return '';
}

export const nameOf = (dir: Directory, id: string | null | undefined) => (id && dir.get(id)?.name) || 'Ukjent';

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
