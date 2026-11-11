import React, { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DriverDayProvider } from './contexts/DriverDayContext';
import { SignInScreen } from './components/SignInScreen';
import { AppShell, type Tab } from './components/AppShell';
import { TodayScreen } from './components/TodayScreen';
import { StopDetailScreen } from './components/StopDetailScreen';
import { EodScreen } from './components/EodScreen';
import { ScoreScreen } from './components/ScoreScreen';
import { JoinRoutePanel } from './components/JoinRoutePanel';
import type { Stop } from './types';

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
  if (!currentUser || !profile) return <SignInScreen />;

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
