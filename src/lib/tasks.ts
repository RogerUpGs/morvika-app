import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type Repeat = 'ingen' | 'daglig' | 'ukentlig' | 'maanedlig' | 'aarlig';
export interface Task {
  id: string; created_by: string; cabin_id: string | null; title: string; note: string; due_at: string;
  remind_before_min: number; repeat: Repeat; nag_min: number | null; next_remind_at: string | null;
  done_at: string | null; done_by: string | null; created_at: string;
}
export const TASK_COLS = 'id,created_by,cabin_id,title,note,due_at,remind_before_min,repeat,nag_min,next_remind_at,done_at,done_by,created_at';

export const REPEAT_LABEL: Record<Repeat, string> = { ingen: 'Ikke gjenta', daglig: 'Hver dag', ukentlig: 'Hver uke', maanedlig: 'Hver måned', aarlig: 'Hvert år' };

const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.toISOString(); };

/** Antall gjøremål som er forfalt eller skal gjøres i dag (til telleren på forsiden) */
export function useTaskCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => void supabase.from('tasks').select('id', { count: 'exact', head: true }).is('done_at', null).lte('due_at', endOfToday())
      .then(({ count }) => { if (alive) setN(count ?? 0); });
    load();
    window.addEventListener('tasks-changed', load);
    const t = window.setInterval(load, 5 * 60_000);
    return () => { alive = false; window.removeEventListener('tasks-changed', load); window.clearInterval(t); };
  }, []);
  return n;
}
