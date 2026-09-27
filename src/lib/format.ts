const nb = 'nb-NO';

export const dLong = (d: string) =>
  new Date(d).toLocaleDateString(nb, { weekday: 'long', day: 'numeric', month: 'long' });

export const dShort = (d: string) => new Date(d).toLocaleDateString(nb, { day: 'numeric', month: 'short' });

export function rel(d: string): string {
  const m = (Date.now() - new Date(d).getTime()) / 60000;
  if (m < 1) return 'Akkurat nå';
  if (m < 60) return `${Math.floor(m)} min`;
  if (m < 1440) return `${Math.floor(m / 60)} t`;
  if (m < 2880) return 'I går';
  return dShort(d);
}

export const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? '';

export function greeting(): string {
  const h = new Date().getHours();
  return h < 10 ? 'God morgen' : h < 17 ? 'Hei' : 'God kveld';
}
