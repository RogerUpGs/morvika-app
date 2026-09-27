export type Area = 'morvika' | 'sandbukta';
export type AppRole = 'grunneier' | 'styre_vel' | 'styre_vei' | 'admin';
export type Audience = 'alle' | 'morvika' | 'sandbukta' | 'vel' | 'vei';
export type Sender = 'grunneier' | 'vel' | 'vei' | 'admin';

export interface Cabin {
  id: string;
  area: Area;
  number: number;
  label: string;
  gnr: number | null;
  bnr: number | null;
  vel_member: boolean;
  vei_member: boolean;
}

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
}

export interface News {
  id: string;
  sender: Sender;
  audience: Audience;
  title: string;
  body: string;
  notify: boolean;
  created_at: string;
  created_by: string | null;
}

export const ROLE_LABEL: Record<AppRole, string> = {
  grunneier: 'Grunneier',
  styre_vel: 'Styret Vel',
  styre_vei: 'Styret Vei',
  admin: 'Administrator',
};

export const SENDER_LABEL: Record<Sender, string> = {
  grunneier: 'Grunneier',
  vel: 'Mørvika Vel',
  vei: 'Mørvika Veiforening',
  admin: 'Administrator',
};

export const AUDIENCE_LABEL: Record<Audience, string> = {
  alle: 'Alle',
  morvika: 'Mørvika hytteområde',
  sandbukta: 'Sandbukta (ekstern eiendom)',
  vel: 'Medlemmer i Mørvika Vel',
  vei: 'Medlemmer i Mørvika Veiforening',
};

/** Avsendere en bruker kan publisere som, ut fra rollene. */
export function sendersFor(roles: AppRole[]): Sender[] {
  const s: Sender[] = [];
  if (roles.includes('grunneier')) s.push('grunneier');
  if (roles.includes('styre_vel')) s.push('vel');
  if (roles.includes('styre_vei')) s.push('vei');
  if (roles.includes('admin')) s.push('admin');
  return s;
}
