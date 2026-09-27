import { SessionProvider, useMe } from './lib/session';
import { ToastProvider, useTheme } from './lib/ui';
import { Login } from './pages/Login';
import { AskName, NotInvited, Splash } from './pages/Gates';
import { Shell } from './components/Shell';

function Gate() {
  useTheme();
  const me = useMe();
  if (me.loading) return <Splash />;
  if (!me.session) return <Login />;
  if (!me.isResident) return <NotInvited />;
  if (!me.profile?.full_name) return <AskName />;
  return <Shell />;
}

export default function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <Gate />
      </SessionProvider>
    </ToastProvider>
  );
}
