import React, { useEffect, useState } from 'react';
import { doc, getDoc, getDocs, collection, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebaseConfig';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { RouteFormModal } from './forms/RouteFormModal';
import { TruckFormModal } from './forms/TruckFormModal';
import { DriverInvite } from './DriverInvite';

// Demo ids seeded by scripts/migrateData.ts for brand-new businesses.
// Real customer data never uses these ids — the badge keeps the owner honest
// about what still needs replacing with their own routes/trucks/team.
const DEMO_ROUTE_IDS = new Set(['ny-1', 'ny-2', 'ct-1', 'ct-2', 'ct-3', 'ct-4']);
const DEMO_TRUCK_IDS = new Set(['t1', 't2', 't3', 't4', 't5', 't6']);
const DEMO_EMPLOYEE_IDS = new Set([
  'exec-1', 'exec-2', 'exec-3',
  'driver-1', 'driver-2', 'driver-3', 'driver-4',
]);

const STEPS = ['Welcome', 'Business', 'Routes', 'Trucks', 'Team', 'Data feeds', 'Done'] as const;

interface OnboardingWizardProps {
  /** completed=true when the owner finished; false on "skip for now". */
  onDone: (completed: boolean) => void;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onDone }) => {
  const { userProfile, currentUser } = useAuth();
  const { routes, trucks, employees, addRoute, addTruck } = useData();
  const businessId = userProfile?.businessId;

  const [step, setStep] = useState(0);
  const [businessName, setBusinessName] = useState('');
  const [nameLoaded, setNameLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [routeModalOpen, setRouteModalOpen] = useState(false);
  const [truckModalOpen, setTruckModalOpen] = useState(false);
  const [connections, setConnections] = useState<Array<{ id: string; data: any }>>([]);
  const [feedsLoaded, setFeedsLoaded] = useState(false);

  // Load the business name for step 2.
  useEffect(() => {
    if (!businessId) return;
    getDoc(doc(db, 'businesses', businessId))
      .then((snap) => {
        if (snap.exists()) setBusinessName(String((snap.data() as any).name || ''));
      })
      .catch((err) => console.error('Wizard: business name load failed', err))
      .finally(() => setNameLoaded(true));
  }, [businessId]);

  // Load data-feed connection status for step 6 (written by GYBs, read-only here).
  useEffect(() => {
    if (step !== 5 || !businessId || feedsLoaded) return;
    getDocs(collection(db, `businesses/${businessId}/connections`))
      .then((snap) => setConnections(snap.docs.map((d) => ({ id: d.id, data: d.data() }))))
      .catch(() => setConnections([]))
      .finally(() => setFeedsLoaded(true));
  }, [step, businessId, feedsLoaded]);

  if (!businessId || !currentUser) return null;

  const saveBusinessName = async () => {
    const name = businessName.trim();
    if (!name) return false;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'businesses', businessId), { name });
      return true;
    } catch (err) {
      console.error('Wizard: business name save failed', err);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), {
        onboardingSkippedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Wizard: skip save failed', err);
    } finally {
      setSaving(false);
      onDone(false);
    }
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), {
        onboardingCompleted: true,
        onboardingCompletedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Wizard: completion save failed', err);
    } finally {
      setSaving(false);
      onDone(true);
    }
  };

  const next = async () => {
    // Business step: persist the name before moving on.
    if (step === 1) {
      const ok = await saveBusinessName();
      if (!ok) return;
    }
    if (step === 6) {
      await handleComplete();
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const back = () => setStep((s) => Math.max(s - 1, 0));

  const realRoutes = routes.filter((r) => !DEMO_ROUTE_IDS.has(r.id));
  const realTrucks = trucks.filter((t) => !DEMO_TRUCK_IDS.has(t.id));
  const realEmployees = employees.filter((e) => !DEMO_EMPLOYEE_IDS.has(e.id));

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-end sm:items-center justify-center p-4">
      <div
        className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden max-h-[92dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-black p-6 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white font-black text-sm uppercase tracking-[0.2em]">
              <i className="fas fa-truck-fast text-[#FFD700] mr-2"></i>
              Setup TruckCEO
            </h2>
            {step < 6 && (
              <button
                onClick={handleSkip}
                disabled={saving}
                className="text-gray-500 hover:text-white text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-50"
              >
                Skip for now
              </button>
            )}
          </div>
          {/* Progress */}
          <div className="flex items-center gap-1.5">
            {STEPS.map((label, i) => (
              <div
                key={label}
                title={label}
                className={`h-1.5 flex-1 rounded-full transition-all ${
                  i < step ? 'bg-[#FFD700]' : i === step ? 'bg-[#FFD700] animate-pulse' : 'bg-gray-800'
                }`}
              />
            ))}
          </div>
          <p className="text-gray-500 text-[9px] font-black uppercase tracking-[0.25em] mt-2">
            Step {step + 1} of {STEPS.length} · {STEPS[step]}
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 no-scrollbar">
          {step === 0 && (
            <div className="text-center space-y-5 py-4">
              <div className="w-20 h-20 bg-[#FFD700] rounded-[1.8rem] flex items-center justify-center mx-auto shadow-xl">
                <i className="fas fa-truck-fast text-black text-3xl"></i>
              </div>
              <h3 className="text-xl font-black uppercase tracking-tight">Welcome to TruckCEO</h3>
              <p className="text-sm text-gray-500 font-bold leading-relaxed">
                Your command center for the bread routes — live driver check-ins,
                end-of-day reports, fleet health, and Mateo AI, your in-app assistant.
              </p>
              <p className="text-sm text-gray-500 font-bold leading-relaxed">
                Let's get your operation set up. It takes about two minutes —
                routes, trucks, your team, and driver invite codes.
              </p>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <h3 className="text-xl font-black uppercase tracking-tight">Your business</h3>
              <p className="text-sm text-gray-500 font-bold leading-relaxed">
                Confirm the name your team will see across the app.
              </p>
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                  Business name
                </label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  disabled={!nameLoaded}
                  placeholder={nameLoaded ? 'e.g., Mateo\'s in Motion' : 'Loading…'}
                  className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold disabled:opacity-50"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h3 className="text-xl font-black uppercase tracking-tight">Routes</h3>
              <p className="text-sm text-gray-500 font-bold leading-relaxed">
                Add each route with its bakery route number — that number is how
                Mateo AI matches a route to live data.
              </p>
              {routes.length === 0 && (
                <p className="text-xs text-gray-400 font-bold uppercase tracking-widest text-center py-4">
                  No routes yet
                </p>
              )}
              <div className="space-y-2">
                {routes.map((r) => (
                  <div key={r.id} className="flex items-center justify-between bg-gray-50 rounded-2xl px-4 py-3 border border-gray-100">
                    <div>
                      <div className="font-black uppercase tracking-widest text-xs">{r.name}</div>
                      {r.routeNumber && (
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">
                          #{r.routeNumber}
                        </div>
                      )}
                    </div>
                    {DEMO_ROUTE_IDS.has(r.id) && (
                      <span className="text-[8px] font-black uppercase tracking-widest bg-gray-200 text-gray-500 px-2 py-1 rounded-full">
                        Demo
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={() => setRouteModalOpen(true)}
                className="w-full py-4 bg-black text-[#FFD700] rounded-2xl font-black uppercase tracking-widest text-[11px] active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <i className="fas fa-plus"></i> Add route
              </button>
              <p className="text-[10px] text-gray-400 font-bold text-center">
                Demo routes are marked — replace them with your real routes, then delete the demos from Routes management.
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h3 className="text-xl font-black uppercase tracking-tight">Trucks</h3>
              <p className="text-sm text-gray-500 font-bold leading-relaxed">
                Add your trucks so fleet health and assignments stay accurate.
              </p>
              {trucks.length === 0 && (
                <p className="text-xs text-gray-400 font-bold uppercase tracking-widest text-center py-4">
                  No trucks yet
                </p>
              )}
              <div className="space-y-2">
                {trucks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between bg-gray-50 rounded-2xl px-4 py-3 border border-gray-100">
                    <div>
                      <div className="font-black uppercase tracking-widest text-xs">{t.plate || t.type}</div>
                      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">
                        {t.type}
                      </div>
                    </div>
                    {DEMO_TRUCK_IDS.has(t.id) && (
                      <span className="text-[8px] font-black uppercase tracking-widest bg-gray-200 text-gray-500 px-2 py-1 rounded-full">
                        Demo
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={() => setTruckModalOpen(true)}
                className="w-full py-4 bg-black text-[#FFD700] rounded-2xl font-black uppercase tracking-widest text-[11px] active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <i className="fas fa-plus"></i> Add truck
              </button>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h3 className="text-xl font-black uppercase tracking-tight">Team</h3>
              <p className="text-sm text-gray-500 font-bold leading-relaxed">
                Generate an invite code per route, text it to the driver, and they
                join the right route automatically.
              </p>
              {routes.length === 0 ? (
                <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl p-6 text-center">
                  <p className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3">
                    Add a route first
                  </p>
                  <button
                    onClick={() => setStep(2)}
                    className="px-5 py-3 bg-black text-[#FFD700] rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95"
                  >
                    Back to routes
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {routes.map((r) => (
                    <div key={r.id}>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                        {r.name}
                      </p>
                      <DriverInvite routeId={r.id} routeName={r.name} />
                    </div>
                  ))}
                </div>
              )}
              {employees.length > 0 && (
                <p className="text-[10px] text-gray-400 font-bold text-center uppercase tracking-widest">
                  {realEmployees.length} real team {realEmployees.length === 1 ? 'member' : 'members'}
                  {employees.length - realEmployees.length > 0 &&
                    ` · ${employees.length - realEmployees.length} demo`}
                </p>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <h3 className="text-xl font-black uppercase tracking-tight">Data feeds</h3>
              <div className="bg-blue-50 border-2 border-blue-100 rounded-2xl p-5">
                <p className="text-xs font-bold text-blue-900 leading-relaxed">
                  <i className="fas fa-info-circle mr-2"></i>
                  Bakery data feeds (Flowers IDP, Bimbo ION) are connected by GYBs —
                  your ops team — not something you plug in here. Nothing to
                  configure on this screen.
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                  Connection status
                </p>
                {!feedsLoaded ? (
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Checking…</p>
                ) : connections.length === 0 ? (
                  <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl p-5 text-center">
                    <p className="text-xs font-black uppercase tracking-widest text-gray-400">
                      No feeds connected yet
                    </p>
                    <p className="text-[10px] text-gray-400 font-bold mt-1">
                      GYBs wires these during setup — status appears here when live.
                    </p>
                  </div>
                ) : (
                  connections.map((c) => (
                    <div key={c.id} className="flex items-center justify-between bg-gray-50 rounded-2xl px-4 py-3 border border-gray-100">
                      <span className="font-black uppercase tracking-widest text-xs">
                        {String(c.data.label || c.data.name || c.id)}
                      </span>
                      <span
                        className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${
                          c.data.status === 'live'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-200 text-gray-500'
                        }`}
                      >
                        {String(c.data.status || 'pending')}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <p className="text-[10px] text-gray-400 font-bold text-center leading-relaxed">
                Driver check-ins, end-of-day reports, and photos flow in automatically
                once your team joins — no feed needed for those.
              </p>
            </div>
          )}

          {step === 6 && (
            <div className="text-center space-y-5 py-4">
              <div className="w-20 h-20 bg-green-500 rounded-[1.8rem] flex items-center justify-center mx-auto shadow-xl">
                <i className="fas fa-check text-white text-3xl"></i>
              </div>
              <h3 className="text-xl font-black uppercase tracking-tight">You're set</h3>
              <div className="flex justify-center gap-6">
                {[
                  { n: realRoutes.length, label: 'Routes' },
                  { n: realTrucks.length, label: 'Trucks' },
                  { n: realEmployees.length, label: 'Team' },
                ].map((s) => (
                  <div key={s.label} className="text-center">
                    <div className="text-3xl font-black text-black">{s.n}</div>
                    <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-sm text-gray-500 font-bold leading-relaxed">
                Text those invite codes to your drivers and the live data starts flowing.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 pt-2 shrink-0 bg-white">
          <div className="flex gap-3">
            {step > 0 && step < 6 && (
              <button
                onClick={back}
                disabled={saving}
                className="px-6 py-4 bg-gray-100 text-black font-black uppercase tracking-widest text-xs rounded-2xl active:scale-95 transition-all disabled:opacity-50"
              >
                Back
              </button>
            )}
            <button
              onClick={next}
              disabled={saving || (step === 1 && (!nameLoaded || !businessName.trim()))}
              className="flex-1 py-4 bg-[#FFD700] text-black font-black uppercase tracking-widest text-xs rounded-2xl shadow-xl active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? (
                <i className="fas fa-spinner fa-spin"></i>
              ) : step === 0 ? (
                <>Let's go <i className="fas fa-arrow-right"></i></>
              ) : step === 6 ? (
                <>Start using TruckCEO <i className="fas fa-check"></i></>
              ) : (
                <>Continue <i className="fas fa-arrow-right"></i></>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Reused form modals */}
      {routeModalOpen && (
        <RouteFormModal
          isOpen={routeModalOpen}
          onClose={() => setRouteModalOpen(false)}
          onSubmit={async (data) => {
            await addRoute({ name: data.name, routeNumber: data.routeNumber, stores: data.stores || [] });
          }}
        />
      )}
      {truckModalOpen && (
        <TruckFormModal
          isOpen={truckModalOpen}
          onClose={() => setTruckModalOpen(false)}
          onSubmit={async (data) => {
            await addTruck(data);
          }}
        />
      )}
    </div>
  );
};
