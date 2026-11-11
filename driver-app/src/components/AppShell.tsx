import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useDriverDay } from '../contexts/DriverDayContext';

export type Tab = 'today' | 'eod' | 'score';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'today', label: 'Today', icon: 'fa-route' },
  { id: 'eod', label: 'End of Day', icon: 'fa-clipboard-check' },
  { id: 'score', label: 'My Score', icon: 'fa-star' },
];

/** Shared chrome: black header, gold accents, bottom tab bar — the
 *  TruckCEO design language, driver-app simple. */
export const AppShell: React.FC<{
  tab: Tab;
  onTab: (t: Tab) => void;
  onJoinRoute: () => void;
  children: React.ReactNode;
}> = ({ tab, onTab, onJoinRoute, children }) => {
  const { profile, logout } = useAuth();
  const { route, routes, setActiveRouteId } = useDriverDay();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-slate-50">
      <header className="sticky top-0 z-10 bg-black px-5 py-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#FFD700]">
              TruckCEO Driver
            </p>
            <h1 className="text-lg font-black uppercase leading-tight tracking-tight">
              {route ? `Route ${route.routeNumber ?? route.name}` : 'No route yet'}
            </h1>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onJoinRoute}
              title="Join another route with an invite code"
              className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200"
            >
              <i className="fa-solid fa-ticket mr-1" /> Add route
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200"
            >
              <i className="fa-solid fa-right-from-bracket mr-1" /> Sign out
            </button>
          </div>
        </div>
        {routes.length > 1 && route && (
          <select
            aria-label="Switch route"
            value={route.id}
            onChange={(e) => setActiveRouteId(e.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
          >
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                Route {r.routeNumber ?? r.name} — {r.name}
              </option>
            ))}
          </select>
        )}
        {profile && (
          <p className="mt-1 text-xs text-slate-400">
            {profile.displayName} · {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        )}
      </header>

      <main className="flex-1 px-4 pb-24 pt-4">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto w-full max-w-md border-t border-slate-200 bg-white">
        <div className="grid grid-cols-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTab(t.id)}
              className={`flex flex-col items-center gap-1 py-3 text-xs font-bold ${
                tab === t.id ? 'text-black' : 'text-slate-400'
              }`}
            >
              <i className={`fa-solid ${t.icon} text-lg ${tab === t.id ? 'text-[#bfa100]' : ''}`} />
              {t.label}
              {tab === t.id && <span className="h-1 w-8 rounded-full bg-[#FFD700]" />}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
};
