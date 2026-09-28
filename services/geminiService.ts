
import { GoogleGenAI } from "@google/genai";
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from "firebase/firestore";
import { Product, SmartSuggestion, Truck } from "../types";
import { db } from "./firebaseConfig";
import { getRouteCoordinates } from "./routeCoordinates";

// Check if API key exists and is valid
const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
const isApiKeyValid = apiKey && apiKey !== 'PLACEHOLDER_API_KEY' && apiKey.length > 10;

const ai = isApiKeyValid ? new GoogleGenAI({ apiKey }) : null;

// ===== Deterministic order-signal engine (recommend-only) =====
// Signals come from real data only:
//   - Driver end-of-day reports: businesses/{businessId}/routes/{routeId}/eod/{date}
//   - Live 7-day max-temp forecast from Open-Meteo for the route territory
//   - US federal holidays (hardcoded 2026-2027)
// Every generated reason cites its evidence. No signal -> no suggestion.

interface EodSignal {
  piecesLeft: number | null;
  stalesPulled: number | null;
}

interface RankedSuggestion extends SmartSuggestion {
  strength: number;
}

const US_FEDERAL_HOLIDAYS: Array<{ date: string; name: string }> = [
  // 2026
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-01-19', name: 'Martin Luther King Jr. Day' },
  { date: '2026-02-16', name: "Presidents' Day" },
  { date: '2026-05-25', name: 'Memorial Day' },
  { date: '2026-06-19', name: 'Juneteenth' },
  { date: '2026-07-03', name: 'Independence Day (observed)' },
  { date: '2026-09-07', name: 'Labor Day' },
  { date: '2026-10-12', name: 'Columbus Day' },
  { date: '2026-11-11', name: 'Veterans Day' },
  { date: '2026-11-26', name: 'Thanksgiving' },
  { date: '2026-12-25', name: 'Christmas Day' },
  // 2027
  { date: '2027-01-01', name: "New Year's Day" },
  { date: '2027-01-18', name: 'Martin Luther King Jr. Day' },
  { date: '2027-02-15', name: "Presidents' Day" },
  { date: '2027-05-31', name: 'Memorial Day' },
  { date: '2027-06-18', name: 'Juneteenth (observed)' },
  { date: '2027-07-05', name: 'Independence Day (observed)' },
  { date: '2027-09-06', name: 'Labor Day' },
  { date: '2027-10-11', name: 'Columbus Day' },
  { date: '2027-11-11', name: 'Veterans Day' },
  { date: '2027-11-25', name: 'Thanksgiving' },
  { date: '2027-12-24', name: 'Christmas Day (observed)' },
];

const HEAT_THRESHOLD_F = 88;
const MAX_SUGGESTIONS = 6;

const isBunsLike = (p: Product): boolean =>
  p.category === 'buns' || /bun|roll/i.test(p.name);

const isStaleProne = (p: Product): boolean =>
  p.category === 'bread' || isBunsLike(p);

const plusUpQty = (p: Product): number =>
  Math.max(1, Math.round(p.lastOrderQuantity * 1.25));

const cutQty = (p: Product): number =>
  Math.max(1, Math.round(p.lastOrderQuantity * 0.8));

const impactRank = { high: 3, medium: 2, low: 1 } as const;

export const getSmartOrderSuggestions = async (
  products: Product[],
  currentDate: string,
  weather: string = "Sunny, 75°F",
  context?: { businessId: string; routeId: string | null }
): Promise<SmartSuggestion[]> => {
  void weather; // live forecast is fetched directly below; param kept for signature compatibility
  const businessId = context?.businessId?.trim();
  const routeId = context?.routeId ?? null;
  // No route in scope -> no signals; the UI shows the honest empty state.
  if (!businessId || !routeId) return [];
  if (products.length === 0) return [];

  // --- Load route name (for territory coordinates) + last 14 EOD reports ---
  let routeName = '';
  let eods: EodSignal[] = [];
  try {
    const [routeSnap, eodSnap] = await Promise.all([
      getDoc(doc(db, `businesses/${businessId}/routes`, routeId)),
      getDocs(
        query(
          collection(db, `businesses/${businessId}/routes/${routeId}/eod`),
          orderBy('submittedAt', 'desc'),
          limit(14)
        )
      ),
    ]);
    if (routeSnap.exists()) routeName = String(routeSnap.data()?.name ?? '');
    const asNum = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    eods = eodSnap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return { piecesLeft: asNum(data.piecesLeft), stalesPulled: asNum(data.stalesPulled) };
    });
  } catch (err) {
    console.error('Order signals: failed to load route/EOD data', err);
    return [];
  }

  const today = new Date(`${currentDate}T12:00:00`);
  const candidates: RankedSuggestion[] = [];

  // One suggestion per product: keep the strongest signal when several fire.
  const push = (s: RankedSuggestion): void => {
    const idx = candidates.findIndex((c) => c.productId === s.productId);
    if (idx === -1) {
      candidates.push(s);
      return;
    }
    const prev = candidates[idx];
    if (
      impactRank[s.impactLevel] > impactRank[prev.impactLevel] ||
      (s.impactLevel === prev.impactLevel && s.strength > prev.strength)
    ) {
      candidates[idx] = s;
    }
  };

  // --- Rule A: SELLOUT — piecesLeft === 0 on >=2 of the last 7 reported days ---
  const last7 = eods.slice(0, 7).filter((e) => e.piecesLeft !== null);
  const selloutDays = last7.filter((e) => e.piecesLeft === 0).length;
  if (selloutDays >= 2) {
    const impactLevel = selloutDays >= 4 ? 'high' : 'medium';
    for (const p of products.filter(isBunsLike)) {
      push({
        productId: p.id,
        recommendedQty: plusUpQty(p),
        reason: `Sold out ${selloutDays} of last ${last7.length} reported days — driver end-of-day reports. Plus up to cover demand.`,
        impactLevel,
        strength: selloutDays,
      });
    }
  }

  // --- Rule B: STALES TREND — stalesPulled rising week-over-week ---
  const week1 = eods.slice(0, 7).filter((e) => e.stalesPulled !== null);
  const week2 = eods.slice(7, 14).filter((e) => e.stalesPulled !== null);
  const staleSum = (arr: EodSignal[]): number =>
    arr.reduce((sum, e) => sum + (e.stalesPulled ?? 0), 0);
  const w1 = staleSum(week1);
  const w2 = staleSum(week2);
  if (week1.length >= 2 && week2.length >= 2 && w2 > 0 && w1 > w2) {
    const pct = Math.round(((w1 - w2) / w2) * 100);
    const impactLevel = pct >= 50 ? 'high' : pct >= 25 ? 'medium' : 'low';
    for (const p of products.filter(isStaleProne)) {
      push({
        productId: p.id,
        recommendedQty: cutQty(p),
        reason: `Stales up ${pct}% vs prior week (${w2} → ${w1} pulled) — driver end-of-day reports. Trim order to cut waste.`,
        impactLevel,
        strength: pct,
      });
    }
  }

  // --- Rule C: HEAT — any of the next 4 days >= 88°F, buns/rolls plus-up ---
  try {
    const { latitude, longitude } = getRouteCoordinates(routeName);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&daily=temperature_2m_max&timezone=America%2FNew_York&forecast_days=7`;
    const res = await fetch(url);
    if (res.ok) {
      const fc = (await res.json()) as {
        daily?: { time?: string[]; temperature_2m_max?: number[] };
      };
      const times = fc.daily?.time ?? [];
      const temps = fc.daily?.temperature_2m_max ?? [];
      const hotDays: Array<{ day: string; temp: number }> = [];
      for (let i = 0; i < Math.min(4, times.length, temps.length); i++) {
        const t = Number(temps[i]);
        if (Number.isFinite(t) && t >= HEAT_THRESHOLD_F) {
          hotDays.push({
            day: new Date(`${times[i]}T12:00:00`).toLocaleDateString('en-US', {
              weekday: 'short',
            }),
            temp: Math.round(t),
          });
        }
      }
      if (hotDays.length > 0) {
        const hottest = hotDays.reduce((a, b) => (b.temp > a.temp ? b : a));
        const impactLevel = hottest.temp >= 95 ? 'high' : 'medium';
        for (const p of products.filter(isBunsLike)) {
          push({
            productId: p.id,
            recommendedQty: plusUpQty(p),
            reason: `${hottest.temp}°F forecast ${hottest.day} — heat drives bun/roll demand (live forecast).`,
            impactLevel,
            strength: hottest.temp,
          });
        }
      }
    }
  } catch (err) {
    console.error('Order signals: forecast unavailable', err);
  }

  // --- Rule D: HOLIDAY — US federal holiday within the next 7 days ---
  const upcomingHoliday = US_FEDERAL_HOLIDAYS.map((h) => ({
    ...h,
    daysOut: Math.round(
      (new Date(`${h.date}T12:00:00`).getTime() - today.getTime()) / 86400000
    ),
  }))
    .filter((h) => h.daysOut > 0 && h.daysOut <= 7)
    .sort((a, b) => a.daysOut - b.daysOut)[0];
  if (upcomingHoliday) {
    const impactLevel = upcomingHoliday.daysOut <= 3 ? 'high' : 'medium';
    const dayWord = upcomingHoliday.daysOut === 1 ? 'day' : 'days';
    for (const p of products.filter((p) => p.category === 'buns' || p.category === 'snacks')) {
      push({
        productId: p.id,
        recommendedQty: plusUpQty(p),
        reason: `${upcomingHoliday.name} in ${upcomingHoliday.daysOut} ${dayWord} — holiday demand lifts buns & snacks.`,
        impactLevel,
        strength: 10 - upcomingHoliday.daysOut,
      });
    }
  }

  // --- Rank by impact, then evidence strength; cap at 6 ---
  candidates.sort(
    (a, b) =>
      impactRank[b.impactLevel] - impactRank[a.impactLevel] || b.strength - a.strength
  );
  return candidates
    .slice(0, MAX_SUGGESTIONS)
    .map(({ productId, recommendedQty, reason, impactLevel }) => ({
      productId,
      recommendedQty,
      reason,
      impactLevel,
    }));
};

export const getTruckSafeRoute = async (start: string, end: string, truck: Truck) => {
  if (!ai || !isApiKeyValid) {
    console.warn('⚠️ Gemini API key not configured.');
    return {
      route: `${start} → ${end}`,
      distance: "Calculating...",
      duration: "Calculating...",
      warnings: ["AI route calculation unavailable - Configure VITE_GEMINI_API_KEY"]
    };
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Calculate a truck-safe navigation route from "${start}" to "${end}".
      TRUCK CONSTRAINTS:
      - Height: ${truck.dimensions.height} feet
      - Weight: ${truck.dimensions.weight} lbs
      - Length: ${truck.dimensions.length} feet
      
      CRITICAL: Avoid any parkways where trucks are prohibited (like Merritt Parkway, Hutchinson River Parkway) and any bridges with clearance lower than ${truck.dimensions.height + 0.5} feet.
      Provide step-by-step driving directions that strictly adhere to these constraints.`,
      config: {
        tools: [{ googleMaps: {} }]
      }
    });

    return {
      text: response.text,
      grounding: response.candidates?.[0]?.groundingMetadata?.groundingChunks
    };
  } catch (error) {
    console.error("Routing Error:", error);
    return { text: "Failed to calculate truck-safe route. Please use secondary commercial route maps." };
  }
};
