
import React, { useEffect, useState } from 'react';
import { View, SaleAlert, RouteTerritory, Store, DriverEod } from './types';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './services/firebaseConfig';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DataProvider, useData } from './contexts/DataContext';
import { AuthScreen } from './components/AuthScreen';
import { RolePicker } from './components/RolePicker';
import { DriverHome } from './components/DriverHome';
import { Layout } from './components/Layout';
import { SmartOrdering } from './components/SmartOrdering';
import { EmployeeEngagement } from './components/EmployeeEngagement';
import { TruckMaintenance } from './components/TruckMaintenance';
import { DataHub } from './components/DataHub';
import { FleetManager } from './components/FleetManager';
import { WeatherForecast } from './components/WeatherForecast';
import { RouteSwitcher } from './components/RouteSwitcher';
import { TruckCeoAgent } from './components/TruckCeoAgent';
import { TruckNavigation } from './components/TruckNavigation';
import { UserSettings } from './components/UserSettings';
import { RoutesManagement } from './components/RoutesManagement';
import { OnboardingWizard } from './components/OnboardingWizard';
import { SetupCompleteModal } from './components/SetupCompleteModal';
import { SaleAlertFormModal } from './components/forms/SaleAlertFormModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ToastContainer } from './components/ToastContainer';
import { useToast } from './hooks/useToast';
import { BUSINESS_NAME } from './constants';
import { useRouteWeather, weatherCodeToCondition } from './services/useRouteWeather';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const AppContent: React.FC = () => {
  const { currentUser, userProfile, loading: authLoading, needsRoleSelection } = useAuth();
  const { products, employees, trucks, saleAlerts, routes, loading: dataLoading } = useData();
  const [activeView, setActiveView] = useState<View>('dashboard');
  const [currentRoute, setCurrentRoute] = useState<RouteTerritory | null>(null);
  const [currentStore, setCurrentStore] = useState<Store | null>(null);
  const [navTruckId, setNavTruckId] = useState<string | null>(null);
  const [previewRoute, setPreviewRoute] = useState<RouteTerritory | null>(null);
  const [previewPickerOpen, setPreviewPickerOpen] = useState(false);

  // Welcome onboarding state (owner only).
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardSkippedThisSession, setWizardSkippedThisSession] = useState(false);
  const [setupCompleted, setSetupCompleted] = useState(false);
  // Confirmation modal shown when the AI setup interview finishes, so the
  // owner sees an explicit "your data was saved" moment (2026-09-30).
  const [setupCompleteModalOpen, setSetupCompleteModalOpen] = useState(false);

  // Conversational setup (owner only): when an owner signs in with incomplete
  // setup (missing routes, trucks, or team), the Mateo AI assistant opens in
  // setup mode and runs the interview — business → routes → trucks → team →
  // data feeds — doing every backend write itself. Closing the panel dismisses
  // setup for the session. The 7-step wizard stays as the manual fallback
  // (Complete Setup banner + MENU → Setup guide) and no longer auto-opens.
  const [setupMode, setSetupMode] = useState(false);
  const [setupAutoOpenKey, setSetupAutoOpenKey] = useState(0);
  const [setupDismissedThisSession, setSetupDismissedThisSession] = useState(false);

  useEffect(() => {
    if (authLoading || dataLoading || !currentUser || !userProfile) return;
    if (userProfile.role !== 'business_owner') return;
    if (userProfile.onboardingCompleted === true || setupCompleted) return;
    if (setupDismissedThisSession || setupMode) return;
    const missingData = routes.length === 0 || trucks.length === 0 || employees.length === 0;
    if (missingData) {
      setSetupMode(true);
      setSetupAutoOpenKey(k => k + 1);
    }
  }, [
    authLoading, dataLoading, currentUser, userProfile,
    routes.length, trucks.length, employees.length,
    setupCompleted, setupDismissedThisSession, setupMode,
  ]);

  const showSetupBanner =
    !!userProfile &&
    userProfile.role === 'business_owner' &&
    userProfile.onboardingCompleted !== true &&
    !setupCompleted &&
    !wizardOpen;

  const startNavigation = (truckId: string) => {
    setNavTruckId(truckId);
    setActiveView('navigation');
  };

  // Show loading screen while auth is loading
  if (authLoading) {
    return <LoadingScreen message="Loading TruckCEO..." />;
  }

  // Show auth screen if not logged in
  if (!currentUser) {
    return <AuthScreen />;
  }

  // New signup: ask owner vs driver before creating any profile.
  // An invite link (truck-ceo.web.app/join/{code}) drops the code straight
  // into the join step so the recipient just signs in and taps join.
  if (needsRoleSelection) {
    const joinMatch = window.location.pathname.match(/^\/join\/([A-Za-z0-9]+)/i);
    const initialInviteCode = joinMatch ? joinMatch[1].toUpperCase() : null;
    return <RolePicker initialInviteCode={initialInviteCode} />;
  }

  // Safety net: authed but no profile (shouldn't normally happen)
  if (!userProfile) {
    return <AuthScreen />;
  }

  // Drivers get the dedicated driver interface
  if (userProfile.role === 'team_member') {
    return <DriverHome />;
  }

  // Show loading screen while data is loading
  if (dataLoading) {
    return <LoadingScreen message="Loading your data..." />;
  }

  // Owner "preview as driver": fullscreen driver view for the chosen route.
  // Writes are disabled inside DriverHome via the preview prop.
  if (previewRoute) {
    const previewDriver =
      employees.find((e) => ((e as unknown as { assignedRoutes?: string[] }).assignedRoutes || []).includes(previewRoute.id))?.name || 'Driver';
    return (
      <DriverHome
        preview={{
          businessId: userProfile.businessId,
          routeId: previewRoute.id,
          driverName: previewDriver,
          onExit: () => setPreviewRoute(null)
        }}
      />
    );
  }

  const renderContent = () => {
    switch (activeView) {
      case 'dashboard':
        return (
          <MainDashboard
            onWeatherClick={() => setActiveView('weather')}
            currentRoute={currentRoute}
            currentStore={currentStore}
            onRouteChange={setCurrentRoute}
            onStoreChange={setCurrentStore}
            fleetCount={trucks.length}
            onPreviewAsDriver={() => setPreviewPickerOpen(true)}
            onFleetAssign={() => setActiveView('fleet_assign')}
          />
        );
      case 'ordering':
        return (
          <SmartOrdering
            products={products}
            currentStore={currentStore}
            currentRoute={currentRoute}
            onRouteChange={setCurrentRoute}
            onStoreChange={setCurrentStore}
          />
        );
      case 'team':
        return <EmployeeEngagement employees={employees} />;
      case 'fleet':
        return <TruckMaintenance fleet={trucks} onNavigate={startNavigation} />;
      case 'fleet_assign':
        return <FleetManager />;
      case 'navigation':
        return <TruckNavigation fleet={trucks} initialTruckId={navTruckId} />;
      case 'promos':
        return (
          <PromoRequestManager
            alerts={saleAlerts}
            currentRoute={currentRoute}
            currentStore={currentStore}
            onRouteChange={setCurrentRoute}
            onStoreChange={setCurrentStore}
          />
        );
      case 'data_hub':
        return <DataHub onNavigate={setActiveView} />;
      case 'weather':
        return (
          <WeatherForecast
            currentRoute={currentRoute}
            currentStore={currentStore}
            onRouteChange={setCurrentRoute}
            onStoreChange={setCurrentStore}
          />
        );
      case 'settings':
        return <UserSettings />;
      case 'routes_management':
        return <RoutesManagement />;
      default:
        return <MainDashboard onWeatherClick={() => setActiveView('weather')} currentRoute={currentRoute} currentStore={currentStore} onRouteChange={setCurrentRoute} onStoreChange={setCurrentStore} fleetCount={trucks.length} onPreviewAsDriver={() => setPreviewPickerOpen(true)} onFleetAssign={() => setActiveView('fleet_assign')} />;
    }
  };

  return (
    <Layout
      activeView={activeView}
      onViewChange={setActiveView}
      floating={activeView === 'dashboard' ? (
        <TruckCeoAgent
          setupMode={setupMode}
          autoOpenKey={setupAutoOpenKey}
          onSetupDismiss={() => {
            setSetupDismissedThisSession(true);
            setSetupMode(false);
          }}
          onSetupComplete={() => {
            // Show the explicit "your data was saved" confirmation first;
            // the modal's dismiss finishes setup.
            setSetupCompleteModalOpen(true);
          }}
        />
      ) : null}
      onSetupGuide={() => setWizardOpen(true)}
    >
      {showSetupBanner && (
        <button
          onClick={() => setWizardOpen(true)}
          className="w-full mb-4 bg-black text-left rounded-[1.8rem] p-5 flex items-center gap-4 active:scale-[0.98] transition-all shadow-xl"
        >
          <span className="w-11 h-11 bg-[#FFD700] rounded-2xl flex items-center justify-center shrink-0">
            <i className="fas fa-clipboard-check text-black text-lg"></i>
          </span>
          <span className="flex-1">
            <span className="block text-white font-black uppercase tracking-widest text-xs">
              Complete setup
            </span>
            <span className="block text-gray-400 text-[10px] font-bold uppercase tracking-widest mt-1">
              {routes.length === 0 || trucks.length === 0 || employees.length === 0
                ? 'Add your routes, trucks, and team to unlock live ops'
                : 'Finish the guided setup'}
            </span>
          </span>
          <i className="fas fa-arrow-right text-[#FFD700]"></i>
        </button>
      )}
      {renderContent()}
      {previewPickerOpen && (
        <DriverPreviewPicker
          routes={routes}
          onClose={() => setPreviewPickerOpen(false)}
          onSelect={(r) => {
            setPreviewPickerOpen(false);
            setPreviewRoute(r);
          }}
        />
      )}
      {wizardOpen && (
        <OnboardingWizard
          onDone={(completed) => {
            setWizardOpen(false);
            if (completed) setSetupCompleted(true);
            else setWizardSkippedThisSession(true);
          }}
        />
      )}
      <SetupCompleteModal
        isOpen={setupCompleteModalOpen}
        routeCount={routes.length}
        truckCount={trucks.length}
        teamCount={employees.length}
        onClose={() => {
          setSetupCompleteModalOpen(false);
          setSetupMode(false);
          setSetupCompleted(true);
        }}
      />
    </Layout>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <DataProvider>
        <AppContent />
      </DataProvider>
    </AuthProvider>
  );
};

// "2026-10-01" -> "Thu 10/1" (parsed as local date to avoid UTC day-shift)
function shortDayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  return `${date.toLocaleDateString('en-US', { weekday: 'short' })} ${date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}`;
}

interface DashboardProps {
  onWeatherClick: () => void;
  currentRoute: RouteTerritory | null;
  currentStore: Store | null;
  onRouteChange: (r: RouteTerritory | null) => void;
  onStoreChange: (s: Store | null) => void;
  fleetCount: number;
  onPreviewAsDriver: () => void;
  onFleetAssign: () => void;
}

/* ---------- Owner dashboard: real driver-reported numbers ---------- */

const toDayId = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const mondayOfWeek = (): Date => {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
};

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Drivers enter stops as free text ("14 / 16"). Take the leading number; null when unreadable. */
const parseStops = (s: string): number | null => {
  const m = /^\s*(\d+)/.exec(s || '');
  return m ? parseInt(m[1], 10) : null;
};

interface ParsedEod {
  date: string;
  stops: number | null;
  stales: number | null;
}

const MainDashboard: React.FC<DashboardProps> = ({ onWeatherClick, currentRoute, currentStore, onRouteChange, onStoreChange, fleetCount, onPreviewAsDriver, onFleetAssign }) => {
  // Real live weather for the selected route territory (Open-Meteo, no key needed)
  const { days, loading: weatherLoading } = useRouteWeather(currentRoute?.name ?? null);
  const today = days.length > 0 ? days[0] : null;
  const todayCondition = today ? weatherCodeToCondition(today.weatherCode) : null;
  const todayIcon =
    todayCondition === 'Rainy' ? 'fa-cloud-rain text-blue-400' :
    todayCondition === 'Cloudy' ? 'fa-cloud text-gray-300' :
    todayCondition === 'Snow' ? 'fa-snowflake text-blue-200' :
    'fa-sun text-[#FFD700]';
  const todayTemp = weatherLoading ? '—' : today ? `${today.tempMax}°F` : '—';

  // Market Watch card derived from the REAL 7-day forecast — no invented numbers.
  const next7 = days.slice(0, 7);
  const hotDays = next7.filter((d) => d.tempMax >= 88);
  const peakHeat = hotDays.length > 0 ? hotDays.reduce((a, b) => (b.tempMax > a.tempMax ? b : a)) : null;
  const wettest = next7.length > 0 ? next7.reduce((a, b) => (b.precipProb > a.precipProb ? b : a)) : null;
  const rainRisk = !peakHeat && wettest && wettest.precipProb >= 70 ? wettest : null;

  // ---- This week's driver EOD reports (real Firestore data, never placeholders) ----
  // Paths: businesses/{businessId}/routes to enumerate routes, then each
  // route's eod subcollection: businesses/{businessId}/routes/{routeId}/eod,
  // bounded to docs with date >= Monday (yyyy-mm-dd). Scoped to the selected
  // route, or every route in the business when none is selected.
  const { userProfile } = useAuth();
  const businessId = userProfile?.businessId;
  const routeId = currentRoute?.id ?? null;
  const [weekLoading, setWeekLoading] = useState(true);
  const [eods, setEods] = useState<ParsedEod[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setWeekLoading(true);
      setEods([]);
      if (!businessId) {
        if (!cancelled) setWeekLoading(false);
        return;
      }
      try {
        let routeIds: string[];
        if (routeId) {
          routeIds = [routeId];
        } else {
          const rSnap = await getDocs(collection(db, `businesses/${businessId}/routes`));
          routeIds = rSnap.docs.map((docSnap) => docSnap.id);
        }
        const mondayId = toDayId(mondayOfWeek());
        const snaps = await Promise.all(
          routeIds.map((rid) =>
            getDocs(query(collection(db, `businesses/${businessId}/routes/${rid}/eod`), where('date', '>=', mondayId)))
          )
        );
        const parsed: ParsedEod[] = snaps.flatMap((s) =>
          s.docs.map((docSnap) => {
            const eod = docSnap.data() as DriverEod;
            const stales = Number(eod.stalesPulled);
            return {
              date: eod.date,
              stops: parseStops(eod.stopsCompleted),
              stales: Number.isFinite(stales) ? stales : null,
            };
          })
        );
        if (!cancelled) {
          setEods(parsed);
          setWeekLoading(false);
        }
      } catch (err) {
        console.error('Dashboard week stats failed:', err);
        if (!cancelled) setWeekLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [businessId, routeId]);

  const hasDocs = eods.length > 0;
  const stopsOk = hasDocs && eods.every((p) => p.stops !== null);
  const stalesOk = hasDocs && eods.every((p) => p.stales !== null);
  const stopsSum = stopsOk ? eods.reduce((s, p) => s + (p.stops as number), 0) : null;
  const stalesSum = stalesOk ? eods.reduce((s, p) => s + (p.stales as number), 0) : null;
  const stopsUnparsed = eods.filter((p) => p.stops === null).length;
  const daysReported = new Set(eods.map((p) => p.date)).size;

  // Chart metric: prefer stops (headline ops number); fall back to stales when a
  // driver typed something unparseable into the stops field. Labelled honestly.
  const metric: 'stops' | 'stales' | null = !hasDocs ? null : stopsOk ? 'stops' : 'stales';
  const metricLabel = metric === 'stops' ? 'Stops completed' : metric === 'stales' ? 'Stales pulled' : 'This week';

  const monday = mondayOfWeek();
  const todayIdx = (new Date().getDay() + 6) % 7; // slots run Monday .. today
  const chartData: { name: string; value: number | null }[] = [];
  for (let i = 0; i <= todayIdx; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    const dayDocs = eods.filter((p) => p.date === toDayId(d));
    let value: number | null = null;
    if (dayDocs.length > 0 && metric) {
      const vals = dayDocs.map((p) => (metric === 'stops' ? p.stops : p.stales));
      if (vals.every((v) => v !== null)) value = (vals as number[]).reduce((a, b) => a + b, 0);
    }
    chartData.push({ name: DAY_LABELS[i], value });
  }
  const chartVals = chartData.map((c) => c.value).filter((v): v is number => v !== null);
  const hasChartValues = chartVals.length > 0;
  const maxVal = hasChartValues ? Math.max(...chartVals) : 0;

  // "…" while loading, "—" when there is no data, real number otherwise —
  // never confuse "0 reported" with "no data".
  const statVal = (v: number | null): string => (weekLoading ? '…' : v === null ? '—' : String(v));

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Route Switcher Integrated at Top */}
      <RouteSwitcher 
        currentRoute={currentRoute} 
        currentStore={currentStore} 
        onRouteChange={onRouteChange} 
        onStoreChange={onStoreChange} 
      />

      {/* Welcome & Stats */}
      <section className="bg-black rounded-[2.5rem] p-8 text-white shadow-2xl relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#FFD700]/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
        <div className="flex justify-between items-start mb-10 relative z-10">
          <div>
            <h2 className="text-2xl font-black mb-1 uppercase tracking-tighter leading-tight">{BUSINESS_NAME}</h2>
            <p className="text-gray-500 text-[10px] font-black uppercase tracking-[0.25em]">
              {currentRoute ? `${currentRoute.name} Territory` : 'Fleet Hub: Global'}
            </p>
          </div>
          <button 
            onClick={onWeatherClick}
            className="text-right hover:scale-105 active:scale-95 transition-transform bg-white/5 p-3 rounded-2xl border border-white/10"
          >
            <div className="text-[#FFD700] text-3xl font-black leading-none tracking-tighter flex items-center gap-2 justify-end">
              <i className={`fas ${todayIcon} text-xl`}></i>
              <span>{todayTemp}</span>
            </div>
            <span className="text-[8px] text-gray-500 font-black uppercase tracking-widest mt-1 block">Click for 14-Day Forecast</span>
          </button>
        </div>
        
        <div className="grid grid-cols-2 gap-4 relative z-10">
          <div className="bg-white/5 border border-white/10 rounded-[1.5rem] p-5">
            <div className="text-2xl font-black text-[#FFD700]">{statVal(stopsSum)}</div>
            <div className="text-[9px] font-black uppercase tracking-widest text-gray-500 mt-1">Stops completed</div>
            {!weekLoading && stopsUnparsed > 0 && stopsSum !== null && (
              <div className="text-[8px] font-bold uppercase tracking-widest text-gray-600 mt-1">
                Partial — {stopsUnparsed} unreadable {stopsUnparsed === 1 ? 'entry' : 'entries'}
              </div>
            )}
          </div>
          <div className="bg-white/5 border border-white/10 rounded-[1.5rem] p-5">
            <div className="text-2xl font-black text-[#FFD700]">{statVal(stalesSum)}</div>
            <div className="text-[9px] font-black uppercase tracking-widest text-gray-500 mt-1">Stales pulled</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-[1.5rem] p-5">
            <div className="text-2xl font-black text-white">{weekLoading ? '…' : hasDocs ? String(daysReported) : '—'}</div>
            <div className="text-[9px] font-black uppercase tracking-widest text-gray-500 mt-1">EODs submitted</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-[1.5rem] p-5">
            <div className="text-2xl font-black text-white">{fleetCount}</div>
            <div className="text-[9px] font-black uppercase tracking-widest text-gray-500 mt-1">Fleet Active</div>
          </div>
        </div>
        <p className="text-[8px] font-black uppercase tracking-[0.25em] text-gray-600 mt-4 relative z-10">
          This week · Mon–Sun · driver-reported
        </p>
      </section>

      {/* Driver preview entry point */}
      <section>
        <button
          onClick={onPreviewAsDriver}
          className="w-full py-5 bg-[#FFD700] text-black rounded-[2rem] font-black uppercase tracking-widest text-[11px] shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3"
        >
          <i className="fas fa-eye text-lg"></i>
          Preview as driver
        </button>
      </section>

      {/* Fleet assignment entry point */}
      <section>
        <button
          onClick={onFleetAssign}
          className="w-full py-5 bg-black text-[#FFD700] rounded-[2rem] font-black uppercase tracking-widest text-[11px] shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3"
        >
          <i className="fas fa-truck-fast text-lg"></i>
          Manage fleet
        </button>
      </section>

      {/* Analytics Brief — real driver-reported numbers, never placeholders */}
      <section className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100">
        <div className="flex justify-between items-center mb-6 px-1">
          <h3 className="font-black text-black text-[10px] uppercase tracking-[0.25em]">
            {metric ? `${metricLabel} · this week` : 'This week'}
          </h3>
          <i className="fas fa-chart-line text-[#FFD700]"></i>
        </div>
        {weekLoading ? (
          <div className="h-44 w-full flex items-center justify-center">
            <p className="text-gray-300 text-[10px] font-black uppercase tracking-[0.25em]">Loading…</p>
          </div>
        ) : !hasChartValues ? (
          <div className="h-44 w-full flex flex-col items-center justify-center text-center px-6 border-2 border-dashed border-gray-100 rounded-3xl">
            <i className="fas fa-clipboard-list text-3xl text-gray-200 mb-3"></i>
            <p className="text-gray-400 text-xs font-black uppercase tracking-widest leading-relaxed">
              No driver data yet — numbers appear as drivers submit end-of-day reports.
            </p>
          </div>
        ) : (
          <>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f8fafc" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold', fill: '#cbd5e1' }} />
                  <Tooltip
                    cursor={{ fill: '#f8fafc' }}
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 40px rgba(0,0,0,0.1)', fontWeight: 'bold', fontSize: '12px' }}
                    formatter={(v) => [v, metricLabel]}
                  />
                  <Bar dataKey="value" radius={[12, 12, 12, 12]} barSize={18}>
                    {chartData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.value !== null && entry.value === maxVal && maxVal > 0 ? '#000000' : '#f1f5f9'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mt-4 text-center">
              {daysReported} of {todayIdx + 1} {todayIdx === 0 ? 'day' : 'days'} reported · blank days had no submission
            </p>
          </>
        )}
      </section>

      {/* Market Watch — driven by the REAL territory forecast; hidden when nothing notable */}
      {(peakHeat || rainRisk) && (
        <section className="space-y-3 pb-4">
          <h3 className="font-black text-black text-[10px] uppercase tracking-[0.25em] px-2">Market Watch</h3>

          {peakHeat && (
            <div onClick={onWeatherClick} className="bg-black p-5 rounded-3xl flex items-center justify-between border-l-4 border-l-[#FFD700] shadow-2xl group active:scale-95 transition-transform cursor-pointer overflow-hidden relative">
              <div className="absolute top-0 right-0 w-16 h-16 bg-[#FFD700]/5 rounded-full blur-xl"></div>
              <div className="flex items-center gap-4 relative z-10">
                <div className="w-12 h-12 bg-[#FFD700] rounded-2xl flex items-center justify-center text-black font-black text-lg">
                  <i className="fas fa-temperature-arrow-up"></i>
                </div>
                <div>
                  <h4 className="font-black text-xs text-white uppercase tracking-widest">Heatwave Incoming</h4>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight mt-1">
                    {peakHeat.tempMax}°F {shortDayLabel(peakHeat.date)} — buns demand surging.
                  </p>
                </div>
              </div>
              <button className="text-[#FFD700] p-2">
                <i className="fas fa-chevron-right"></i>
              </button>
            </div>
          )}

          {rainRisk && (
            <div onClick={onWeatherClick} className="bg-black p-5 rounded-3xl flex items-center justify-between border-l-4 border-l-blue-400 shadow-2xl group active:scale-95 transition-transform cursor-pointer overflow-hidden relative">
              <div className="absolute top-0 right-0 w-16 h-16 bg-blue-400/5 rounded-full blur-xl"></div>
              <div className="flex items-center gap-4 relative z-10">
                <div className="w-12 h-12 bg-blue-400 rounded-2xl flex items-center justify-center text-black font-black text-lg">
                  <i className="fas fa-cloud-rain"></i>
                </div>
                <div>
                  <h4 className="font-black text-xs text-white uppercase tracking-widest">Rain Risk</h4>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight mt-1">
                    {rainRisk.precipProb}% rain {shortDayLabel(rainRisk.date)} — stales risk, watch returns.
                  </p>
                </div>
              </div>
              <button className="text-[#FFD700] p-2">
                <i className="fas fa-chevron-right"></i>
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

const PromoRequestManager: React.FC<{
  alerts: SaleAlert[];
  currentRoute: RouteTerritory | null;
  currentStore: Store | null;
  onRouteChange: (r: RouteTerritory | null) => void;
  onStoreChange: (s: Store | null) => void;
}> = ({ alerts, currentRoute, currentStore, onRouteChange, onStoreChange }) => {
  const { addSaleAlert, updateSaleAlert, deleteSaleAlert, routes } = useData();
  const { userProfile } = useAuth();
  const [sentAlerts, setSentAlerts] = useState<string[]>([]);

  // Import toast and modal utilities
  const { toasts, showToast, removeToast } = useToast();
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [editingAlert, setEditingAlert] = useState<SaleAlert | undefined>(undefined);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingAlert, setDeletingAlert] = useState<SaleAlert | null>(null);

  const handleSendPromo = (alertId: string) => {
    setSentAlerts([...sentAlerts, alertId]);
  };

  // Handle add alert
  const handleAddAlert = () => {
    setEditingAlert(undefined);
    setShowAlertModal(true);
  };

  // Handle edit alert
  const handleEditAlert = (alert: SaleAlert) => {
    setEditingAlert(alert);
    setShowAlertModal(true);
  };

  // Handle delete alert
  const handleDeleteClick = (alert: SaleAlert) => {
    setDeletingAlert(alert);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingAlert) return;

    try {
      await deleteSaleAlert(deletingAlert.id);
      showToast(`Promo alert for "${deletingAlert.storeName}" deleted`, 'success');
      setDeletingAlert(null);
      // Remove from sent alerts if it was marked as sent
      setSentAlerts(prev => prev.filter(id => id !== deletingAlert.id));
    } catch (error) {
      console.error('Error deleting alert:', error);
      showToast('Failed to delete promo alert', 'error');
    }
  };

  // Handle alert form submit
  const handleAlertSubmit = async (data: Omit<SaleAlert, 'id'>) => {
    try {
      if (editingAlert) {
        await updateSaleAlert(editingAlert.id, data);
        showToast('Promo alert updated successfully', 'success');
      } else {
        await addSaleAlert(data);
        showToast('Promo alert added successfully', 'success');
      }
    } catch (error) {
      console.error('Error saving alert:', error);
      showToast('Failed to save promo alert', 'error');
      throw error;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Route Switcher Integrated at Top */}
      <RouteSwitcher
        currentRoute={currentRoute}
        currentStore={currentStore}
        onRouteChange={onRouteChange}
        onStoreChange={onStoreChange}
      />

      {/* Header */}
      <div className="bg-black text-white p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
        <div className="absolute bottom-0 right-0 w-32 h-32 bg-[#FFD700]/10 rounded-full -mr-16 -mb-16 blur-3xl"></div>
        <div className="relative z-10">
          <h2 className="text-2xl font-black uppercase tracking-tighter mb-1">Promo Requests</h2>
          <p className="text-gray-500 text-[10px] font-black uppercase tracking-[0.3em]">Secure End Caps & Displays</p>
        </div>
      </div>

      {/* Add Alert Button (Business Owner Only) */}
      {userProfile?.role === 'business_owner' && (
        <button
          onClick={handleAddAlert}
          className="w-full py-6 bg-black text-[#FFD700] rounded-[2.5rem] font-black uppercase tracking-widest text-[11px] shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3"
        >
          <i className="fas fa-bullhorn text-lg"></i>
          Add New Promo Alert
        </button>
      )}

      {/* Alerts List */}
      {alerts.length === 0 ? (
        <div className="bg-white rounded-[2.5rem] p-12 text-center border-2 border-dashed border-gray-200">
          <i className="fas fa-bullhorn text-4xl text-gray-300 mb-4"></i>
          <p className="text-gray-400 font-black uppercase tracking-widest text-sm">
            No promo alerts yet. Add your first alert to get started!
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {alerts.map((alert) => (
            <div key={alert.id} className="bg-white p-7 rounded-[2.5rem] shadow-sm border border-gray-100 flex flex-col gap-5 relative overflow-hidden group transition-all hover:border-black">
              {/* Edit/Delete buttons (business owner only) */}
              {userProfile?.role === 'business_owner' && (
                <div className="absolute top-6 right-6 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <button
                    onClick={() => handleEditAlert(alert)}
                    className="w-9 h-9 bg-black text-[#FFD700] rounded-xl flex items-center justify-center hover:bg-gray-900 transition-all active:scale-95 shadow-xl"
                  >
                    <i className="fas fa-edit text-sm"></i>
                  </button>
                  <button
                    onClick={() => handleDeleteClick(alert)}
                    className="w-9 h-9 bg-red-600 text-white rounded-xl flex items-center justify-center hover:bg-red-700 transition-all active:scale-95 shadow-xl"
                  >
                    <i className="fas fa-trash text-sm"></i>
                  </button>
                </div>
              )}

              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="text-[9px] font-black text-[#FFD700] uppercase tracking-widest mb-1.5 bg-black w-fit px-3 py-1 rounded-full">{alert.promoType}</div>
                  <h4 className="font-black text-xl text-black leading-tight uppercase tracking-tight">{alert.storeName}</h4>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Starts {alert.date}</span>
                    <span className="text-[10px] text-gray-300">•</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Mgr: {alert.contactName}</span>
                  </div>
                </div>
              </div>

              <button
                disabled={sentAlerts.includes(alert.id)}
                onClick={() => handleSendPromo(alert.id)}
                className={`w-full py-4 rounded-[1.5rem] font-black uppercase tracking-[0.2em] text-[10px] transition-all flex items-center justify-center gap-2 shadow-2xl ${
                  sentAlerts.includes(alert.id)
                  ? 'bg-gray-50 text-green-600 cursor-default border border-gray-100 shadow-none'
                  : 'bg-black text-[#FFD700] hover:bg-gray-900 shadow-[#FFD700]/10 active:scale-95'
                }`}
              >
                {sentAlerts.includes(alert.id) ? (
                  <><i className="fas fa-check"></i> Request Sent</>
                ) : (
                  <><i className="fas fa-paper-plane"></i> Request End Cap Display</>
                )}
              </button>
              <p className="text-[9px] text-gray-300 text-center uppercase tracking-[0.15em] font-black">1-Click Manager Text Approval System</p>
            </div>
          ))}
        </div>
      )}

      {/* Alert Form Modal */}
      {showAlertModal && (
        <SaleAlertFormModal
          isOpen={showAlertModal}
          onClose={() => setShowAlertModal(false)}
          onSubmit={handleAlertSubmit}
          routes={routes}
          alert={editingAlert}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={handleConfirmDelete}
          title="Delete Promo Alert"
          message={`Are you sure you want to delete the promo alert for "${deletingAlert?.storeName}"? This action cannot be undone.`}
          confirmText="Delete"
          danger={true}
        />
      )}
    </div>
  );
};

const DriverPreviewPicker: React.FC<{
  routes: RouteTerritory[];
  onSelect: (r: RouteTerritory) => void;
  onClose: () => void;
}> = ({ routes, onSelect, onClose }) => (
  <div
    className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4"
    onClick={onClose}
  >
    <div
      className="bg-white w-full max-w-md rounded-[2rem] p-6 shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-black uppercase tracking-tight text-lg">Preview as driver</h3>
        <button
          onClick={onClose}
          className="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center active:scale-95"
          aria-label="Close"
        >
          <i className="fas fa-times"></i>
        </button>
      </div>
      <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-4">
        Pick a route · writes disabled
      </p>
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {routes.map((r) => (
          <button
            key={r.id}
            onClick={() => onSelect(r)}
            className="w-full text-left bg-gray-50 hover:bg-black rounded-2xl p-4 flex items-center justify-between transition-all active:scale-95 group"
          >
            <div>
              <div className="font-black uppercase tracking-widest text-xs group-hover:text-[#FFD700]">{r.name}</div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">{r.id}</div>
            </div>
            <i className="fas fa-chevron-right text-gray-300 group-hover:text-[#FFD700]"></i>
          </button>
        ))}
        {routes.length === 0 && (
          <p className="text-center text-gray-400 text-xs font-black uppercase tracking-widest py-8">
            No routes yet
          </p>
        )}
      </div>
    </div>
  </div>
);

const LoadingScreen: React.FC<{ message: string }> = ({ message }) => (
  <div className="min-h-screen flex items-center justify-center bg-black">
    <div className="text-center">
      <i className="fas fa-truck-fast text-[#FFD700] text-6xl mb-4 animate-pulse"></i>
      <p className="text-white font-black uppercase tracking-widest text-sm">{message}</p>
    </div>
  </div>
);

export default App;
