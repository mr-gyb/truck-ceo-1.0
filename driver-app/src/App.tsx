import React, { Suspense, lazy, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DriverDayProvider } from './contexts/DriverDayContext';
import { SignInScreen } from './components/SignInScreen';
import { AppShell, type Tab } from './components/AppShell';
import { TodayScreen } from './components/TodayScreen';
import { InstallPrompt } from './components/InstallPrompt';
import type { Stop } from './types';

// Heavy, not-first-paint screens are split out of the initial bundle:
// the driver opens on Today; Score/EOD/Stop/Join download on first use.
const StopDetailScreen = lazy(() =>
  import('./components/StopDetailScreen').then((m) => ({ default: m.StopDetailScreen })),
);
const EodScreen = lazy(() =>
  import('./components/EodScreen').then((m) => ({ default: m.EodScreen })),
);
const ScoreScreen = lazy(() =>
  import('./components/ScoreScreen').then((m) => ({ default: m.ScoreScreen })),
);
const JoinRoutePanel = lazy(() =>
  import('./components/JoinRoutePanel').then((m) => ({ default: m.JoinRoutePanel })),
);

const ScreenFallback: React.FC = () => (
  <div className="flex items-center justify-center py-16">
    <p className="text-sm font-bold uppercase tracking-widest text-slate-500">
      <i className="fa-solid fa-spinner fa-spin mr-2" />
      Loading…
    </p>
  </div>
);

const Root: React.FC = () => {
  const { currentUser, profile, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('today');
  const [openStop, setOpenStop] = useState<Stop | null>(null);
  const [joining, setJoining] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <p className="text-sm font-bold uppercase tracking-widest text-[#FFD700]">TruckCEO Driver</p>
      </div>
    );
  }

  // Signed out, or signed in without a driver profile: the sign-in screen
  // carries both the login form and the invite-code join.
  if (!currentUser || !profile)
    return (
      <>
        <SignInScreen />
        <InstallPrompt />
      </>
    );

  return (
    <DriverDayProvider>
      <AppShell
        tab={tab}
        onTab={(t) => {
          setTab(t);
          setOpenStop(null);
          setJoining(false);
        }}
        onJoinRoute={() => {
          setJoining(true);
          setOpenStop(null);
        }}
      >
        <Suspense fallback={<ScreenFallback />}>
          {joining ? (
            <JoinRoutePanel
              onDone={() => {
                setJoining(false);
                setTab('today');
              }}
            />
          ) : openStop ? (
            <StopDetailScreen stop={openStop} onBack={() => setOpenStop(null)} />
          ) : tab === 'today' ? (
            <TodayScreen onOpenStop={setOpenStop} onGoEod={() => setTab('eod')} />
          ) : tab === 'eod' ? (
            <EodScreen />
          ) : (
            <ScoreScreen />
          )}
        </Suspense>
        <InstallPrompt />
      </AppShell>
    </DriverDayProvider>
  );
};

const App: React.FC = () => (
  <AuthProvider>
    <Root />
  </AuthProvider>
);

export default App;
