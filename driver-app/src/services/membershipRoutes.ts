import type { DriverMembership, Route } from '../types';

/**
 * Membership → routes resolution (pure: the Firestore fetch is injected,
 * so this logic is unit-testable without a live backend).
 *
 * Memberships are the many-to-many source of truth; each route lives in
 * its OWN business, because memberships can span businesses. Falls back
 * to (businessId, routeIds) pairs for profiles written before
 * memberships existed.
 *
 * TOLERANCE (2026-11-10 join defect): a route is readable only while the
 * profile's businessId points at that route's business — the Firestore
 * rules key every businesses/{bid} read on that single field. Redeeming
 * an invite in a NEW business flips businessId mid-sequence, so the
 * driver's older routes in the previous business become unreadable the
 * moment the join lands. One denied (or missing) route must be SKIPPED,
 * never thrown: before this fix the throw escaped refresh() and surfaced
 * in the join panel as "Missing or insufficient permissions", making a
 * join that had actually landed look like a failure.
 */
export type RouteFetcher = (
  businessId: string,
  routeId: string,
) => Promise<Route | null>;

export function membershipRoutePairs(profile: {
  businessId: string;
  routeIds: string[];
  driverMemberships?: DriverMembership[];
}): Array<{ businessId: string; routeId: string }> {
  const pairs: Array<{ businessId: string; routeId: string }> = [];
  const seen = new Set<string>();
  const add = (businessId: string, routeId: string) => {
    const key = `${businessId}/${routeId}`;
    if (businessId && routeId && !seen.has(key)) {
      seen.add(key);
      pairs.push({ businessId, routeId });
    }
  };
  for (const m of profile.driverMemberships ?? []) add(m.businessId, m.routeId);
  for (const rid of profile.routeIds ?? []) add(profile.businessId, rid);
  return pairs;
}

export async function resolveMembershipRoutes(
  profile: {
    businessId: string;
    routeIds: string[];
    driverMemberships?: DriverMembership[];
  },
  fetchRoute: RouteFetcher,
): Promise<Route[]> {
  const routes: Route[] = [];
  for (const p of membershipRoutePairs(profile)) {
    try {
      const route = await fetchRoute(p.businessId, p.routeId);
      if (route) routes.push(route);
    } catch (err) {
      // Denied (tenant isolation after a businessId flip) or transiently
      // unreadable: skip this route, keep the rest of the driver's day.
      console.warn(
        `Skipping unreadable route ${p.routeId} in business ${p.businessId}.`,
        err,
      );
    }
  }
  return routes;
}
