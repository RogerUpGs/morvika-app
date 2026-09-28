export type Area = 'morvika' | 'torpum';
export type CabinAccess = 'full' | 'veilag';
export type AppRole = 'grunneier' | 'styre_vel' | 'styre_va' | 'styre_vei' | 'admin';
export type Audience = 'alle' | 'morvika' | 'torpum' | 'vel' | 'va' | 'vei';
export type Sender = 'grunneier' | 'vel' | 'va' | 'vei' | 'admin';

export interface Cabin {
  id: string;
  area: Area;
  number: number;
  label: string;
  gnr: number | null;
  bnr: number | null;
  vel_member: boolean;
  va_member: boolean;
  vei_member: boolean;
  /** full = vanlig hytteeier, veilag = ser bare det som kommer fra Mørvikveien Veilag (Torpum) */
  access: CabinAccess;
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
  images: string[];
  created_at: string;
  created_by: string | null;
}

export const ROLE_LABEL: Record<AppRole, string> = {
  grunneier: 'Grunneier',
  styre_vel: 'Styret Vel',
  styre_va: 'Styret VA',
  styre_vei: 'Styret Veilag',
  admin: 'Administrator',
};

export const SENDER_LABEL: Record<Sender, string> = {
  grunneier: 'Grunneier',
  vel: 'Mørvika Vel',
  va: 'Mørvika Vann og Avløp',
  vei: 'Mørvikveien Veilag',
  admin: 'Administrator',
};

export const AUDIENCE_LABEL: Record<Audience, string> = {
  alle: 'Alle',
  morvika: 'Mørvika hytteområde',
  torpum: 'Torpum (ekstern eiendom)',
  vel: 'Medlemmer i Mørvika Vel',
  va: 'Tilknyttet Mørvika Vann og Avløp',
  vei: 'Medlemmer i Mørvikveien Veilag',
};

/** Avsendere en bruker kan publisere som, ut fra rollene. */
export function sendersFor(roles: AppRole[]): Sender[] {
  const s: Sender[] = [];
  const grunneier = roles.includes('grunneier');
  // Grunneier har full tilgang til Velet, Vann og avløp og Veilaget
  if (grunneier) s.push('grunneier');
  if (grunneier || roles.includes('styre_vel')) s.push('vel');
  if (grunneier || roles.includes('styre_va')) s.push('va');
  if (grunneier || roles.includes('styre_vei')) s.push('vei');
  if (roles.includes('admin')) s.push('admin');
  return s;
}
