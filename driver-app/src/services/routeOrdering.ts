import { BusinessEntity, Route } from '../types';

/**
 * Standing DISPLAY rule (user, 2026-11-07): wherever routes are listed or
 * dashboarded, they display grouped in this order —
 *   1. Flowers routes (Mateo's in Motion): 7823 Stratford, 13445 Milford,
 *      7814 Stamford
 *   2. CNR Bimbo routes: 1510 Norwalk, 2080 Stamford, 2286 Ridgefield,
 *      6286 Danbury
 *   3. LMB Bimbo routes: 0721 Yonkers, 1612 Ossining
 * and dashboard totals are the combined grand total across all
 * businesses/routes, never a per-business subtotal.
 *
 * Display ordering only — this never changes stored data. Applied centrally
 * in FirestoreService.getRoutes() so every route list in the app (Routes
 * management, route switcher, fleet assignment, dashboards) inherits it.
 * See docs/data-intake-design.md, "Standing display rule".
 */
export const ROUTE_DISPLAY_GROUPS: Array<{
  key: 'flowers' | 'cnr-bimbo' | 'lmb-bimbo';
  label: string;
  entity: BusinessEntity;
  routeNumbers: string[];
}> = [
  { key: 'flowers', label: "Mateo's in Motion — Flowers", entity: 'mateos-in-motion', routeNumbers: ['7823', '13445', '7814'] },
  { key: 'cnr-bimbo', label: 'CNR Distributors — Bimbo', entity: 'cnr', routeNumbers: ['1510', '2080', '2286', '6286'] },
  { key: 'lmb-bimbo', label: 'LMB — Bimbo', entity: 'lmb', routeNumbers: ['0721', '1612'] },
];

const ENTITY_BY_NUMBER = new Map<string, BusinessEntity>();
ROUTE_DISPLAY_GROUPS.forEach((g) => {
  g.routeNumbers.forEach((n) => ENTITY_BY_NUMBER.set(n.replace(/^0+(?=\d)/, ''), g.entity));
});

/**
 * The business entity operating a route: the stored `businessEntity`
 * field wins; otherwise derived from the route number via the display
 * groups (which ARE Chris's entity map). Null when unidentified.
 */
export function routeBusinessEntity(
  route: Pick<Route, 'routeNumber' | 'name' | 'businessEntity'>,
): BusinessEntity | null {
  if (route.businessEntity) return route.businessEntity;
  const raw = route.routeNumber || (route.name || '').match(/\d{3,5}/)?.[0] || '';
  const digits = String(raw).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return (digits && ENTITY_BY_NUMBER.get(digits)) || null;
}

/** '0721' and '721' are the same route number. */
function normalizeRouteNumber(n: string | null | undefined): string {
  if (!n) return '';
  const digits = String(n).replace(/\D/g, '');
  return digits.replace(/^0+(?=\d)/, '');
}

const RANK = new Map<string, number>();
ROUTE_DISPLAY_GROUPS.forEach((g) => {
  g.routeNumbers.forEach((n) => RANK.set(normalizeRouteNumber(n), RANK.size));
});

/** Sort rank for one route. Known route numbers rank by the rule above.
 *  Unknown routes sort after the known network, Flowers before Bimbo,
 *  then by name — a new route never jumps the queue ahead of the nine. */
export function routeDisplayRank(route: Pick<Route, 'routeNumber' | 'name' | 'supplier'>): number {
  const fromField = normalizeRouteNumber(route.routeNumber);
  if (fromField && RANK.has(fromField)) return RANK.get(fromField)!;
  // Fall back to a route number embedded in the display name.
  const inName = normalizeRouteNumber((route.name || '').match(/\d{3,5}/)?.[0]);
  if (inName && RANK.has(inName)) return RANK.get(inName)!;
  if (route.supplier === 'flowers') return 1000;
  if (route.supplier === 'bimbo') return 2000;
  return 3000;
}

export function compareRoutesForDisplay(
  a: Pick<Route, 'routeNumber' | 'name' | 'supplier'>,
  b: Pick<Route, 'routeNumber' | 'name' | 'supplier'>,
): number {
  const d = routeDisplayRank(a) - routeDisplayRank(b);
  if (d !== 0) return d;
  return (a.name || '').localeCompare(b.name || '');
}

/** Returns a NEW array in display order; the input is left untouched. */
export function sortRoutesForDisplay<T extends Pick<Route, 'routeNumber' | 'name' | 'supplier'>>(routes: T[]): T[] {
  return [...routes].sort(compareRoutesForDisplay);
}
