import type {
  BaselineGuide,
  BaselineGuideDay,
  BaselineGuideStop,
  GuideDayKey,
  Route,
  Stop,
} from '../types';

/**
 * Baseline-guide consumption logic (pure — no Firebase here, mirroring
 * membershipRoutes.ts). The Firestore read lives in driverService
 * (getBaselineGuide); everything that decides what the driver sees
 * today lives here.
 *
 * The merge: today's guide day is the run. Each guide stop is matched
 * to a registry stop on the route (store number first — the settlement
 * join key — then name, then address), so visits and captures keep
 * keying on the registry stop id. A guide stop with no registry match
 * still renders (the guide is the approved run) under a synthetic
 * guide-scoped id. Registry stops that are NOT on today's guide day
 * are not shown — the guide, not the raw registry, is the day's run.
 */

const DAY_KEYS: GuideDayKey[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const guideDayKeyForDate = (date: Date): GuideDayKey => DAY_KEYS[date.getDay()];

export function guideDayForDate(
  guide: BaselineGuide | null,
  date: Date,
): BaselineGuideDay | null {
  if (!guide) return null;
  const key = guideDayKeyForDate(date);
  return guide.days.find((d) => d.day === key) ?? null;
}

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

/** 'C-Town Stratford' and 'C-Town' should meet; 'FD Boston Ave' and a
 *  registry 'Family Dollar — 310 Boston Ave' should NOT be guessed at —
 *  Family Dollars match on store number or street address instead. */
function nameMatches(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  // Containment counts only when the shorter name is a real name, not a
  // fragment — and never for the street-labeled Family Dollars.
  return shorter.length >= 5 && !shorter.startsWith('fd ') && longer.includes(shorter);
}

function addressMatches(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  // Street number + first street word ('1100 barnum') is a strong key.
  const key = (s: string) => {
    const parts = s.split(' ');
    return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : s;
  };
  return key(na) === key(nb) || na === nb;
}

function matchRegistryStop(
  guideStop: BaselineGuideStop,
  registry: Stop[],
  used: Set<string>,
): Stop | null {
  const available = registry.filter((s) => !used.has(s.id));
  if (guideStop.storeNumber) {
    const byNumber = available.find(
      (s) => s.storeNumber != null && String(s.storeNumber) === guideStop.storeNumber,
    );
    if (byNumber) return byNumber;
  }
  const byName = available.find((s) => nameMatches(s.name, guideStop.storeName));
  if (byName) return byName;
  return available.find((s) => addressMatches(s.address, guideStop.address)) ?? null;
}

const slug = (s: string) => normalize(s).replace(/ /g, '-');

/**
 * Today's stops with the baseline guide applied. Returns the route's
 * own stops untouched when there is no guide, no entry for today, or
 * the guide belongs to a different route number than the route in hand.
 */
export function applyGuideToStops(
  route: Route,
  guide: BaselineGuide | null,
  date: Date,
): { stops: Stop[]; day: BaselineGuideDay | null } {
  const day = guideDayForDate(guide, date);
  if (!guide || !day) return { stops: route.stops, day: null };
  if (route.routeNumber && guide.routeNumber !== route.routeNumber) {
    return { stops: route.stops, day: null };
  }
  if (day.off) return { stops: [], day };

  const used = new Set<string>();
  const stops: Stop[] = day.stops.map((gs, i) => {
    const reg = matchRegistryStop(gs, route.stops, used);
    const enrichment = {
      guidePieces: gs.pieces,
      guideApproxPieces: gs.approxPieces ?? null,
      guideLoadLabel: gs.loadLabel,
      guideInventory: gs.inventory,
      guideNote: gs.note ?? null,
      guideSelfOrders: gs.selfOrders === true,
    };
    if (reg) {
      used.add(reg.id);
      return { ...reg, sequence: i + 1, ...enrichment };
    }
    return {
      id: `guide-${guide.routeNumber}-${gs.storeNumber ?? slug(gs.storeName)}`,
      name: gs.storeName,
      address: gs.address,
      storeNumber: gs.storeNumber ?? undefined,
      sequence: i + 1,
      targetArrivalTime: null,
      deliveryDays: null,
      ...enrichment,
    };
  });
  return { stops, day };
}
