import type { BaselineGuide } from '../types';
import data from './baselineGuide7823.json';

/**
 * Route 7823 (Stratford, Flowers — Jamarr) baseline guide.
 *
 * The canonical dataset is baselineGuide7823.json beside this file,
 * built 2026-11-11 from Chris's FINAL approved pack of the same day:
 * the baseline schedule he dictated and approved, and the final
 * delivery quantities (goal split at the 2,500 pcs/wk route goal,
 * ROUNDED tracking figures), as folded into
 * guide-route-7823-stratford.html and the DRAFT FINAL driver card.
 *
 * This module only types the JSON. The data's home in the live system
 * is the Firestore doc at
 *   businesses/{bid}/routes/{rid}/baselineGuide/current
 * seeded from the JSON by scripts/seed-baseline-guide-7823.mjs (repo
 * root). Nothing in the app imports this module at runtime — the app
 * reads Firestore only, so the guide can be revised without a deploy.
 *
 * NO MONEY: the paper card carries revenue/margin/shrink dollars and
 * the bonus rule; per the Route Runner rule (pieces + stale only)
 * none of that is in the dataset. Shrink appears in units only.
 *
 * Inventory locks follow the approved schedule (Mon: Walmart +
 * Stop & Shop · Tue: Family Dollars ×3 · Fri: BJ's + ShopRite). The
 * quantities sheet's per-cell "+ Inventory" tags for BJ's/ShopRite
 * sit on Thursday; the schedule Chris dictated — and the card built
 * from it — locks them on Friday, so Friday governs in the data.
 */
export const BASELINE_GUIDE_7823: BaselineGuide = data as BaselineGuide;
