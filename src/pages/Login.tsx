import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { Icon, Logo } from '../components/Icon';

function explain(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('signups not allowed') || m.includes('user not found'))
    return 'Denne e-postadressen er ikke invitert. Kontakt styret eller grunneier for å få en invitasjon.';
  if (m.includes('rate limit') || m.includes('security purposes'))
    return 'Det er sendt for mange koder på kort tid. Vent litt og prøv igjen.';
  if (m.includes('expired') || m.includes('invalid'))
    return 'Koden stemmer ikke, eller den er for gammel. Sjekk sifrene, eller be om en ny kode.';
  return 'Noe gikk galt. Prøv igjen om litt.';
}

export function Login() {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setErr(explain(error.message));
    else { setStep('code'); setCode(''); }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setErr(explain(error.message));
  }

  return (
    <main className="gate">
      <div className="gate-card">
        <div className="gate-brand"><Logo /><div><b>Mørvika</b><small>Hytteområde</small></div></div>

        {step === 'email' ? (
          <>
            <div><h1>Logg inn</h1><p>Skriv inn e-postadressen du er invitert med. Du får en e-post som logger deg inn.</p></div>
            <form onSubmit={sendCode}>
              <label className="field" htmlFor="login-email">E-post
                <input id="login-email" type="email" autoComplete="email" inputMode="email" required
                  value={email} onChange={(e) => setEmail(e.target.value)} placeholder="navn@eksempel.no" />
              </label>
              {err && <p className="err" role="alert">{err}</p>}
              <button className="btn primary" disabled={busy}><Icon name="mail" size={18} />{busy ? 'Sender …' : 'Send meg innlogging på e-post'}</button>
            </form>
          </>
        ) : (
          <>
            <div><h1>Sjekk e-posten din</h1><p>Vi har sendt en e-post til <b>{email}</b>. Trykk på lenken i e-posten, eller skriv inn koden under hvis e-posten har en. Det kan ta et minutt før den kommer fram. Sjekk også søppelpost.</p></div>
            <form onSubmit={verify}>
              <label className="field" htmlFor="login-code">Kode
                <input id="login-code" className="codeinput" inputMode="numeric" autoComplete="one-time-code"
                  pattern="[0-9]*" maxLength={10} required autoFocus
                  value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </label>
              {err && <p className="err" role="alert">{err}</p>}
              <button className="btn primary" disabled={busy || code.length < 6}>{busy ? 'Logger inn …' : 'Logg inn'}</button>
            </form>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <button className="linkbtn2" type="button" onClick={() => void sendCode()} disabled={busy}>Send e-posten på nytt</button>
              <button className="linkbtn2" type="button" onClick={() => { setStep('email'); setErr(null); }}>Bruk en annen e-post</button>
            </div>
          </>
        )}

        <p className="note">Har du fått et brev med QR-kode? Skann den med kameraet på telefonen, så logges du inn uten å taste noe. QR-koder kommer sammen med invitasjonene.</p>
      </div>
    </main>
  );
}
