import { useState } from 'react';
import { useToast } from '../lib/ui';
import { chromeIntent, useInstall } from '../lib/install';
import { Icon } from './Icon';

const HIDE_KEY = 'install-hide-until';
const hiddenNow = () => { try { return Number(localStorage.getItem(HIDE_KEY) || 0) > Date.now(); } catch { return false; } };

/** Del-ikonet slik det ser ut i Safari: firkant med pil opp */
const ShareIcon = () => (
  <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true" style={{ verticalAlign: '-3px' }}>
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7H2v10h12V7h-2" /><path d="M8 1v11M4.5 4.5 8 1l3.5 3.5" /></g>
  </svg>
);

/**
 * «Legg Mørvika på hjemskjermen»: vises på mobil når appen er åpnet i nettleseren.
 * Android/Chrome: én knapp. iPhone: stegene i Safari. Innebygde nettlesere (Facebook, Gmail …): åpne i Safari/Chrome først.
 */
export function InstallPrompt({ compact = false }: { compact?: boolean }) {
  const toast = useToast();
  const { platform, install } = useInstall();
  const [hidden, setHidden] = useState(hiddenNow);
  if (platform === 'installert' || platform === 'pc' || hidden) return null;

  const later = () => { setHidden(true); try { localStorage.setItem(HIDE_KEY, String(Date.now() + 7 * 86_400_000)); } catch { /* */ } };
  async function copyLink() {
    try { await navigator.clipboard.writeText('https://app.morvika.no'); toast('Lenken er kopiert. Lim den inn i Safari.'); }
    catch { toast('Skriv app.morvika.no i Safari.'); }
  }

  return (
    <section className={`card installcard ${compact ? 'compact' : ''}`} aria-label="Legg appen på hjemskjermen">
      <img src="/apple-touch-icon.png" alt="" width="48" height="48" />
      <div className="ic-body">
        <b className="ic-title">Legg Mørvika på hjemskjermen</b>

        {platform === 'android-knapp' && (
          <>
            <p>Da får du et eget app-ikon og varsler på telefonen.</p>
            <div className="ic-actions">
              <button className="btn primary" onClick={async () => { if (await install()) toast('Mørvika er lagt på startskjermen.'); }}>
                <Icon name="plus" size={18} />Installer appen
              </button>
              <button className="btn ghost small" onClick={later}>Senere</button>
            </div>
          </>
        )}

        {platform === 'android-meny' && (
          <>
            <ol>
              <li>Trykk på menyen <span className="kbd">⋮</span> øverst til høyre.</li>
              <li>Velg <b>«Legg til på startskjermen»</b> eller <b>«Installer app»</b>.</li>
              <li>Trykk <b>Installer</b> / <b>Legg til</b>.</li>
            </ol>
            <div className="ic-actions"><a className="btn small" href="/installer">Veiledning med bilder</a><button className="btn ghost small" onClick={later}>Senere</button></div>
          </>
        )}

        {platform === 'android-innebygd' && (
          <>
            <p>Du har åpnet lenken inne i en annen app. Åpne den i Chrome først, så kan du legge Mørvika på startskjermen.</p>
            <div className="ic-actions"><a className="btn primary" href={chromeIntent('/')}>Åpne i Chrome</a><button className="btn ghost small" onClick={later}>Senere</button></div>
          </>
        )}

        {platform === 'ios-safari' && (
          <>
            <ol>
              <li>Trykk på <b>Del</b> <ShareIcon /> nederst. På nyere iPhone ligger den under <span className="kbd">•••</span> ved adressefeltet.</li>
              <li>Rull ned og velg <b>«Legg til på Hjem-skjerm»</b>.</li>
              <li>Trykk <b>Legg til</b> øverst til høyre.</li>
              {compact && <li>Åpne Mørvika fra hjemskjermen og logg inn der.</li>}
            </ol>
            <div className="ic-actions"><a className="btn small" href="/installer">Veiledning med bilder</a><button className="btn ghost small" onClick={later}>Senere</button></div>
          </>
        )}

        {platform === 'ios-innebygd' && (
          <>
            <p>Du har åpnet lenken inne i en annen app. Mørvika må åpnes i <b>Safari</b> (kompasset) for å kunne legges på hjemskjermen.</p>
            <ol>
              <li>Trykk på <span className="kbd">•••</span> eller <ShareIcon /> og velg <b>«Åpne i Safari»</b>.</li>
              <li>Eller: kopier lenken, åpne Safari og lim den inn.</li>
            </ol>
            <div className="ic-actions"><button className="btn primary small" onClick={() => void copyLink()}>Kopier lenken</button><button className="btn ghost small" onClick={later}>Senere</button></div>
          </>
        )}
      </div>
    </section>
  );
}
