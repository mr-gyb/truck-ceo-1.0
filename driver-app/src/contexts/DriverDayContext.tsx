import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { getEodReport, getMembershipRoutes } from '../services/driverService';
import { listCapturesForDay } from '../services/captureService';
import { sortRoutesForDisplay } from '../services/routeOrdering';
import type { DriverCapture, EodReport, Route, StopVisit } from '../types';

export const todayId = () => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

// The driver's day, in session state for v0: which route is active, whether
// the day has started, per-stop visits, and today's EOD (loaded from
// Firestore when one was already submitted). StopVisit persistence to
// Firestore is v1 — see the plan doc.

interface DriverDayContextType {
  loading: boolean;
  routes: Route[];
  route: Route | null;
  setActiveRouteId: (id: string) => void;
  dayStartedAt: string | null;
  startDay: () => void;
  /** Pieces loaded at the depot, entered by the driver at start of day.
   *  Null until entered — never defaulted or estimated. */
  piecesLoaded: number | null;
  setPiecesLoaded: (n: number | null) => void;
  visits: Record<string, StopVisit>;
  updateVisit: (stopId: string, patch: Partial<StopVisit>) => void;
  eod: EodReport | null;
  setEod: (eod: EodReport | null) => void;
  /** Today's captures on the active route (capture-first intake). */
  captures: DriverCapture[];
  refreshCaptures: () => Promise<void>;
  refresh: () => Promise<void>;
}

const DriverDayContext = createContext<DriverDayContextType | undefined>(undefined);

export const useDriverDay = () => {
  const ctx = useContext(DriverDayContext);
  if (!ctx) throw new Error('useDriverDay must be used within DriverDayProvider');
  return ctx;
};

export const DriverDayProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [dayStartedAt, setDayStartedAt] = useState<string | null>(null);
  const [piecesLoaded, setPiecesLoaded] = useState<number | null>(null);
  const [visits, setVisits] = useState<Record<string, StopVisit>>({});
  const [eod, setEod] = useState<EodReport | null>(null);
  const [captures, setCaptures] = useState<DriverCapture[]>([]);

  const refresh = async () => {
    if (!profile) {
      setRoutes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Multi-route: every membership's route, each from its own business.
      const fetched = sortRoutesForDisplay(await getMembershipRoutes(profile));
      setRoutes(fetched);
      setActiveRouteId((prev) =>
        prev && fetched.some((r) => r.id === prev) ? prev : (fetched[0]?.id ?? null),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.businessId, profile?.routeIds?.join(',')]);

  const route = useMemo(
    () => routes.find((r) => r.id === activeRouteId) ?? routes[0] ?? null,
    [routes, activeRouteId],
  );

  // The business every route-scoped read/write targets: the ROUTE's own
  // business (memberships can span businesses), falling back to the
  // profile's primary business.
  const routeBusinessId = route?.businessId ?? profile?.businessId ?? null;

  // Load today's submitted EOD (if any) whenever the active route changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!routeBusinessId || !route) {
        setEod(null);
        return;
      }
      const existing = await getEodReport(routeBusinessId, route.id, todayId()).catch(
        () => null,
      );
      if (!cancelled) setEod(existing);
    })();
    return () => {
      cancelled = true;
    };
  }, [routeBusinessId, route?.id]);

  const refreshCaptures = async () => {
    if (!routeBusinessId || !route) {
      setCaptures([]);
      return;
    }
    const list = await listCapturesForDay(routeBusinessId, route.id, todayId()).catch(() => []);
    setCaptures(list);
  };

  // Captures are scoped to the active route + today; reload on switch.
  useEffect(() => {
    void refreshCaptures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeBusinessId, route?.id]);

  const updateVisit = (stopId: string, patch: Partial<StopVisit>) => {
    if (!route) return;
    const date = todayId();
    setVisits((prev) => {
      const key = `${date}:${stopId}`;
      const existing: StopVisit =
        prev[key] ??
        {
          id: key,
          routeId: route.id,
          stopId,
          date,
          status: 'pending',
          arrivedAt: null,
          completedAt: null,
          photos: {},
          notes: '',
        };
      return { ...prev, [key]: { ...existing, ...patch } };
    });
  };

  const value: DriverDayContextType = {
    loading,
    routes,
    route,
    setActiveRouteId,
    dayStartedAt,
    startDay: () => setDayStartedAt((prev) => prev ?? new Date().toISOString()),
    piecesLoaded,
    setPiecesLoaded,
    visits,
    updateVisit,
    eod,
    setEod,
    captures,
    refreshCaptures,
    refresh,
  };

  return <DriverDayContext.Provider value={value}>{children}</DriverDayContext.Provider>;
};
