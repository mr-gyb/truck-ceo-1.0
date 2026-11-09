import React, { useState } from 'react';
import { todayId, useDriverDay } from '../contexts/DriverDayContext';
import type { Stop } from '../types';

const statusPill: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-slate-100 text-slate-600' },
  arrived: { label: 'Arrived', cls: 'bg-amber-100 text-amber-800' },
  done: { label: 'Delivered', cls: 'bg-green-100 text-green-800' },
};

const formatTime = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
};

export const StopRow: React.FC<{ stop: Stop; onOpen: (stop: Stop) => void }> = ({ stop, onOpen }) => {
  const { visits } = useDriverDay();
  const visit = visits[`${todayId()}:${stop.id}`];
  const status = visit?.status ?? 'pending';
  const pill = statusPill[status];

  return (
    <button
      type="button"
      onClick={() => onOpen(stop)}
      className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-left shadow-sm"
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black ${
          status === 'done' ? 'bg-green-600 text-white' : 'bg-black text-[#FFD700]'
        }`}
      >
        {status === 'done' ? <i className="fa-solid fa-check" /> : (stop.sequence ?? '•')}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold text-slate-900">{stop.name}</span>
        <span className="block truncate text-sm text-slate-500">{stop.address}</span>
        <span className="mt-0.5 block text-xs font-medium text-slate-500">
          {stop.targetArrivalTime ? (
            <>Target: {formatTime(stop.targetArrivalTime)}</>
          ) : (
            <span className="text-slate-400">Target time not set yet</span>
          )}
        </span>
      </span>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${pill.cls}`}>
        {pill.label}
      </span>
    </button>
  );
};

/**
 * The two hero KPIs of the driver app (Chris's design call, 2026-11-08):
 * the home dashboard mirrors the Truck CEO owner dashboard's card layout,
 * but where the owner sees money, the driver sees PIECES and STALE — the
 * two numbers a driver controls. No dollar amounts anywhere in this app.
 *
 * Values are honest by construction: pieces loaded is entered by the driver
 * at start of day; pieces left + stales pulled come from today's submitted
 * EOD; stale % is a settlement-derived weekly figure, so until it posts the
 * card says so instead of estimating one.
 */
const KpiCards: React.FC = () => {
  const { dayStartedAt, piecesLoaded, setPiecesLoaded, eod } = useDriverDay();
  const [draft, setDraft] = useState('');

  const piecesValue = eod ? eod.piecesLeft : piecesLoaded;
  const piecesCaption = eod
    ? `pieces left on the truck${piecesLoaded != null ? ` · of ${piecesLoaded} loaded` : ''}`
    : piecesLoaded != null
      ? 'pieces loaded at the depot'
      : 'pieces on the truck — not logged yet';

  return (
    <div className="mb-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-black px-4 py-4 text-white">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#FFD700]">
            <i className="fa-solid fa-bread-slice mr-1" /> Pieces
          </p>
          <p className="mt-1 text-4xl font-black leading-none">
            {piecesValue != null ? piecesValue.toLocaleString() : '—'}
          </p>
          <p className="mt-1.5 text-xs font-medium text-slate-300">{piecesCaption}</p>
        </div>
        <div className="rounded-2xl bg-black px-4 py-4 text-white">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#FFD700]">
            <i className="fa-solid fa-triangle-exclamation mr-1" /> Stale
          </p>
          <p className="mt-1 text-4xl font-black leading-none">
            {eod ? eod.stalesPulled.toLocaleString() : '—'}
          </p>
          <p className="mt-1.5 text-xs font-medium text-slate-300">
            {eod ? 'stales pulled today' : 'stales pulled — reported at end of day'}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">Stale % posts weekly with your score</p>
        </div>
      </div>

      {dayStartedAt && piecesLoaded == null && !eod && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(draft);
            if (draft.trim() !== '' && Number.isFinite(n) && n >= 0) setPiecesLoaded(n);
          }}
        >
          <input
            type="number"
            inputMode="numeric"
            min="0"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Pieces loaded at the depot"
            className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-black"
          />
          <button
            type="submit"
            className="shrink-0 rounded-xl bg-black px-4 py-3 text-sm font-bold text-[#FFD700]"
          >
            Log load
          </button>
        </form>
      )}
    </div>
  );
};

export const TodayScreen: React.FC<{ onOpenStop: (stop: Stop) => void }> = ({ onOpenStop }) => {
  const { loading, routes, route, setActiveRouteId, dayStartedAt, startDay, visits } =
    useDriverDay();

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-200" />
        ))}
        <p className="pt-2 text-center text-sm text-slate-500">Loading your route…</p>
      </div>
    );
  }

  if (!route) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center shadow-sm">
        <i className="fa-solid fa-route text-3xl text-slate-300" />
        <h2 className="mt-3 text-lg font-black uppercase tracking-tight">No route assigned</h2>
        <p className="mt-2 text-sm text-slate-600">
          Your account is not linked to a route yet. If you were given an invite code, sign out
          and join with it — or ask your manager to assign your route.
        </p>
      </div>
    );
  }

  const doneCount = route.stops.filter(
    (s) => visits[`${todayId()}:${s.id}`]?.status === 'done',
  ).length;

  return (
    <div>
      {routes.length > 1 && (
        <div className="mb-4 flex gap-2 overflow-x-auto no-scrollbar">
          {routes.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setActiveRouteId(r.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${
                r.id === route.id ? 'bg-black text-[#FFD700]' : 'bg-white text-slate-600 border border-slate-300'
              }`}
            >
              Route {r.routeNumber ?? r.name}
            </button>
          ))}
        </div>
      )}

      <KpiCards />

      {!dayStartedAt ? (
        <button
          type="button"
          onClick={startDay}
          className="mb-4 w-full rounded-2xl bg-black py-4 text-lg font-black uppercase tracking-tight text-[#FFD700]"
        >
          <i className="fa-solid fa-play mr-2" /> Start my day
        </button>
      ) : (
        <div className="mb-4 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-900">
          Day started {new Date(dayStartedAt).toLocaleTimeString()} · {doneCount} of{' '}
          {route.stops.length} stops delivered
        </div>
      )}

      {route.stops.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center shadow-sm">
          <i className="fa-solid fa-store text-3xl text-slate-300" />
          <h2 className="mt-3 text-lg font-black uppercase tracking-tight">No stops on this route yet</h2>
          <p className="mt-2 text-sm text-slate-600">
            This route has no stores listed. Once stores are added in TruckCEO, they will show
            up here in order.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {route.stops.map((stop) => (
            <StopRow key={stop.id} stop={stop} onOpen={onOpenStop} />
          ))}
        </div>
      )}
    </div>
  );
};
