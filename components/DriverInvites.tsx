import React from 'react';
import { useData } from '../contexts/DataContext';
import { DriverInvite } from './DriverInvite';
import { sortRoutesForDisplay } from '../services/routeOrdering';
import type { RouteTerritory } from '../types';

/**
 * Driver Invites (owner surface, added 2026-11-08): one card per route with
 * the route's invite code, used count, redemption history and joined
 * drivers, plus code generation / regeneration. This is the same
 * DriverInvite component the Setup Guide wizard renders at Step 5 — the
 * wizard keeps working; this screen just makes invites reachable without
 * walking the wizard.
 */
export const DriverInvites: React.FC = () => {
  const { routes, loading } = useData();
  const sorted = sortRoutesForDisplay(routes) as RouteTerritory[];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black uppercase tracking-tight">Driver Invites</h2>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
          One code per route — text it to the driver, they join that route automatically
        </p>
      </div>

      {loading ? (
        <div className="h-32 animate-pulse rounded-2xl bg-gray-100" />
      ) : sorted.length === 0 ? (
        <div className="bg-white rounded-3xl p-10 text-center border-2 border-dashed border-gray-200">
          <i className="fas fa-route text-3xl text-gray-300 mb-3"></i>
          <p className="text-gray-400 text-xs font-black uppercase tracking-widest">
            No routes yet — add a route first, then generate its invite code here
          </p>
        </div>
      ) : (
        sorted.map((r) => (
          <div key={r.id}>
            <h3 className="text-xs font-black uppercase tracking-widest mb-2">
              {r.name}
              {r.routeNumber ? <span className="text-gray-400"> · #{r.routeNumber}</span> : null}
            </h3>
            <DriverInvite routeId={r.id} routeName={r.name} />
          </div>
        ))
      )}
    </div>
  );
};
