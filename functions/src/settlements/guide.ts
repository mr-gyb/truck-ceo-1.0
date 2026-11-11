/**
 * Route guide generation (Chris's directive, 2026-11-10) — PURE builder.
 *
 * When a settlement is ingested for a route, the driver-side guide book
 * and route card are generated from (a) the settlement's store rows and
 * (b) the route's store registry — the app-side equivalent of the
 * hand-built guide/card packs. No figure is invented: a store with no
 * settlement row carries null pieces/sales, a store with no registry
 * match carries a null address, and unconfirmed run order stays null.
 */

import type { RouteGuideData, GuideStoreRow, SettlementRecord, SettlementStoreRow } from './types';

/** The registry shape this builder needs from businesses/{bid}/routes/{rid}. */
export interface RouteRegistryForGuide {
  name?: string;
  routeNumber?: string;
  stores?: Array<{
    id?: string;
    name: string;
    address?: string;
    storeNumber?: string;
    sequence?: number | null;
  }>;
}

function joinRow(
  row: SettlementStoreRow,
  registryByNumber: Map<string, NonNullable<RouteRegistryForGuide['stores']>[number]>,
): GuideStoreRow {
  const reg = registryByNumber.get(row.storeNumber);
  return {
    storeNumber: row.storeNumber,
    storeName: reg?.name ?? row.storeName,
    address: reg?.address ?? null,
    sequence: reg?.sequence ?? null,
    pieces: row.quantity ?? null,
    sales: row.sales ?? null,
  };
}

/** Confirmed sequences first in order; unsequenced keep registry order. */
function inRunOrder<T extends { sequence?: number | null }>(rows: T[]): T[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const sa = a.r.sequence ?? null;
      const sb = b.r.sequence ?? null;
      if (sa == null && sb == null) return a.i - b.i;
      if (sa == null) return 1;
      if (sb == null) return -1;
      return sa - sb || a.i - b.i;
    })
    .map((x) => x.r);
}

export function buildRouteGuide(input: {
  route: RouteRegistryForGuide;
  settlement: Pick<
    SettlementRecord,
    'routeNumber' | 'week' | 'weekEnding' | 'storeRows' | 'computed'
  >;
  sourceSettlementPath: string;
  generatedAt: string;
}): RouteGuideData {
  const { route, settlement, sourceSettlementPath, generatedAt } = input;
  const registry = route.stores ?? [];
  const registryByNumber = new Map(
    registry.filter((s) => s.storeNumber).map((s) => [String(s.storeNumber), s]),
  );
  const rowByNumber = new Map(settlement.storeRows.map((r) => [r.storeNumber, r]));

  const routeLabel = `Route ${settlement.routeNumber}${route.name ? ` — ${route.name}` : ''}`;

  // Guide book stores: the week's settlement rows, joined to the registry.
  const bookStores = inRunOrder(settlement.storeRows.map((r) => joinRow(r, registryByNumber)));

  // Route card stops: EVERY registry stop in run order (a driver runs
  // the whole route, not just the stores that billed this week), with
  // the week's figures attached where a settlement row exists.
  const cardStops = inRunOrder(
    registry.map((s) => {
      const row = s.storeNumber ? rowByNumber.get(String(s.storeNumber)) : undefined;
      return {
        storeNumber: s.storeNumber ?? '',
        storeName: s.name,
        address: s.address ?? null,
        sequence: s.sequence ?? null,
        pieces: row?.quantity ?? null,
        sales: row?.sales ?? null,
      } as GuideStoreRow;
    }),
  );

  const weekPieces = settlement.storeRows.length
    ? settlement.storeRows.reduce((sum, r) => sum + (r.quantity ?? 0), 0)
    : null;
  const weekSales = settlement.storeRows.length
    ? settlement.storeRows.reduce((sum, r) => sum + (r.sales ?? 0), 0)
    : null;

  return {
    weekEnding: settlement.weekEnding,
    week: settlement.week,
    routeNumber: settlement.routeNumber,
    generatedAt,
    sourceSettlementPath,
    guideBook: {
      routeLabel,
      weekPieces,
      weekSales,
      stalesPct: settlement.computed?.stalesPct ?? null,
      stalesAmount: settlement.computed?.stalesAmount ?? null,
      stores: bookStores,
    },
    routeCard: {
      routeLabel,
      stops: cardStops,
    },
  };
}
