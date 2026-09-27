import { useMe } from '../lib/session';

const PROTOTYPE = 'https://claude.ai/artifact/8TNfg7E5mpENvt7xEm34RR';

const INFO: Record<string, { phase: string; title: string; points: string[] }> = {
  minhytte: { phase: 'Fase 4', title: 'Min hytte', points: ['Dokumentregister med mapper', 'Fotoalbum', 'Hytteregnskap', 'Bare du og de andre eierne av hytta har tilgang'] },
  chat: { phase: 'Fase 3', title: 'Hyttepraten', points: ['Innlegg med bilder fra telefonen', 'Likes og kommentarer', 'Grupper: Generelt, Kjøp og salg, Dugnad og hjelp'] },
  varsler: { phase: 'Fase 3', title: 'Varsler', points: ['Akutt, Viktig og Til orientering', 'Push til telefonen, e-post som reserve', '«Jeg har sett varselet» med oversikt for avsender'] },
  meldinger: { phase: 'Fase 3', title: 'Meldinger', points: ['Private samtaler med grunneier eller styrene', 'Bilder fra telefonen i samtalen'] },
  arr: { phase: 'Fase 3', title: 'Arrangementer og dugnad', points: ['Kalender med påmelding', 'Arrangøren ser hvor mange som kommer'] },
  info: { phase: 'Fase 3', title: 'Info og dokumenter', points: ['Vedtekter, brøyteplan og kart', 'Kontakter til styrene og grunneier'] },
  admin: { phase: 'Fase 2', title: 'Administrasjon', points: ['Hytter, eiere og medlemskap i Vel og Veilag', 'Brukerregister med knapp for ny QR-kode', 'Siste innlogging, innloggede enheter og utlogging fra alle enheter'] },
};

/** Det Torpum-brukere får se, som bare har tilgang til Veilaget. */
const VEILAG: Record<string, string[]> = {
  varsler: ['Varsler fra Mørvikveien Veilag', 'Push til telefonen, e-post som reserve', '«Jeg har sett varselet»'],
  meldinger: ['Private samtaler med Veilagets styre', 'Bilder fra telefonen i samtalen, for eksempel av hull i veien'],
  arr: ['Årsmøter og dugnader i Veilaget, med påmelding'],
  info: ['Vedtekter og brøyteplan fra Veilaget', 'Kontakt til Veilagets styre'],
};

export function ComingSoon({ view }: { view: string }) {
  const { veilagOnly } = useMe();
  const base = INFO[view];
  const i = base && veilagOnly && VEILAG[view] ? { ...base, points: VEILAG[view] } : base;
  if (!i) return null;
  return (
    <section className="card soon">
      <span className="badge">{i.phase}</span>
      <h2>{i.title} kommer snart</h2>
      <p className="muted">Denne delen bygges i {i.phase.toLowerCase()}. Den vil inneholde:</p>
      <ul>{i.points.map((p) => <li key={p}>{p}</li>)}</ul>
      <p className="muted">Du kan se hvordan den blir i <a href={PROTOTYPE} target="_blank" rel="noreferrer">prototypen</a>.</p>
    </section>
  );
}
