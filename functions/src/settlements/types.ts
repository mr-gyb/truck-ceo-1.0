/**
 * TruckCEO data-intake schema — one knowledge base per business.
 *
 * Settlements are the financial spine; every other source (shrink, stales,
 * load/margin rollups, iPlan orders, Discord activity, Drive documents)
 * registers in the SAME ingestion registry and attaches to the same
 * routes / weeks / stores so the assistant can reason across sources.
 *
 * Firestore layout (see docs/data-intake-design.md):
 *   businesses/{bid}/routes/{rid}/settlements/{weekEnding}     <- this file's SettlementRecord
 *   businesses/{bid}/routes/{rid}/shrinkReports/{weekEnding}   <- FlowersShrinkRecord
 *   businesses/{bid}/routes/{rid}/stalesReports/{weekEnding}   <- FlowersStalesDetailRecord (design only)
 *   businesses/{bid}/routes/{rid}/loadSummaries/{weekEnding}   <- FlowersLoadSummaryRecord (design only)
 *   businesses/{bid}/routes/{rid}/marginTotals/{weekEnding}    <- FlowersRouteMarginTotalsRecord (design only)
 *   businesses/{bid}/routes/{rid}/orders/{weekEnding}          <- IPlanWeeklyOrderRecord (design only)
 *   businesses/{bid}/routes/{rid}/activity/{date}              <- DiscordDailyActivityRecord (design only)
 *   businesses/{bid}/ingestionRegistry/{ingestId}              <- IngestionRegistryEntry (every source)
 *
 * GROUNDING RULE (binding on the assistant, from the 2026-11-06 expansion):
 * the assistant answers ONLY from ingested records, cites the record it
 * used (registry id / record path), and reports missing data as missing.
 * It never estimates or invents a number that is not in a record.
 */

/** Parse/validation lifecycle shared by every ingested record. */
export type ParseStatus = 'received' | 'parsed' | 'validated' | 'needs_review';

export type Supplier = 'flowers' | 'bimbo';

/** Every source type the registry knows about. Parsers exist today only for
 *  the four Flowers IDP document types marked (parser built); the rest are
 *  registered shapes whose parsers land in later phases. */
export type SourceType =
  | 'flowers_master_statement' // (parser built)
  | 'flowers_distributor_statement' // (parser built)
  | 'flowers_margin_detail' // (parser built)
  | 'flowers_sbt_shrink' // (parser built)
  | 'flowers_stales_detail' // design only — IDP stales / Always Fresh detail
  | 'flowers_load_summary' // design only — IDP Load Summary
  | 'flowers_route_margin_totals' // design only — IDP Route Margin Totals
  | 'iplan_weekly_orders' // design only — read-only intake, ordering stays recommend-only
  | 'discord_daily_activity' // design only — roll call / step posts / EOD
  | 'bimbo_setl_statement'; // deferred by user 2026-11-06

export type IngestionGrain = 'route-week' | 'route-day' | 'business-week';

/** Where an ingested item came from. Exactly one of fileName / portal /
 *  messageId is expected to be set, matching `kind`. */
export interface Provenance {
  kind: 'file' | 'portal' | 'message' | 'connector';
  fileName?: string;
  storagePath?: string;
  /** e.g. 'flowers-idp-onbase' | 'iplan-omsi' | 'discord' | 'google-drive' */
  portal?: string;
  /** Discord/message id for message-sourced records. */
  messageId?: string;
  channelId?: string;
}

/** One row of the ingestion registry: businesses/{bid}/ingestionRegistry/{id}.
 *  EVERY ingested item — any source — gets exactly one entry. */
export interface IngestionRegistryEntry {
  id: string; // deterministic: `${sourceType}_${routeNumber|master}_${weekEnding|date}` (+ doc discriminator)
  businessId: string;
  routeId?: string;
  routeNumber?: string; // supplier route number, e.g. '7823' — never the text label
  sourceType: SourceType;
  grain: IngestionGrain;
  /** Route-week records: Saturday week-ending date, ISO yyyy-mm-dd. */
  weekEnding?: string;
  /** Route-day records: ISO yyyy-mm-dd. */
  date?: string;
  provenance: Provenance;
  parserVersion?: string;
  status: ParseStatus;
  /** Firestore path of the structured record this entry produced, if any. */
  recordPath?: string;
  /** Human-readable discrepancy when status = needs_review. */
  discrepancy?: string;
  ingestedAt: string; // ISO timestamp
}

export interface ValidationCheck {
  name: string;
  expected: number;
  actual: number;
  /** actual - expected, in the units of the check (dollars or pieces). */
  delta: number;
  ok: boolean;
}

export interface ValidationResult {
  status: ParseStatus; // 'validated' | 'needs_review' (or 'parsed' pre-validation)
  checks: ValidationCheck[];
  discrepancies: string[];
}

export interface SourceRef {
  fileName: string;
  storagePath?: string;
  /** Supplier document/account identifier, e.g. Flowers distributor number. */
  documentId?: string;
  parserVersion: string;
  ingestedAt: string;
}

/** Route mapping fields (mirrored onto the frontend RouteTerritory type).
 *  These live on businesses/{bid}/routes/{rid}. */
export interface RouteSupplierMapping {
  supplier?: Supplier;
  /** Settlement account id with the supplier: Bimbo SA (5045/6442/6418/5713)
   *  or Flowers distributor number (20040812/20040846/20042103). */
  settlementAccount?: string;
  /** Umbrella vendor id where the supplier uses one (Bimbo 116300). */
  vendorId?: string;
}

/** A store row keyed by the supplier's store number. Flowers margin detail
 *  and shrink key stores by customer/sold-to number + store # — the join key
 *  is `storeNumber` on the TruckCEO Store (frontend types.ts). */
export interface SettlementStoreRow {
  /** Supplier store/customer number, e.g. Flowers sold-to '40408551'. */
  storeNumber: string;
  /** Store name exactly as printed by the supplier (labels can be wrong for
   *  ROUTES; store names are carried as printed). */
  storeName: string;
  /** Chain store #, e.g. '2439' (ACME #2439), when the source prints one. */
  chainStoreNumber?: string;
  quantity?: number; // pieces
  sales?: number; // dollars at the source's price basis (see record notes)
  wholesale?: number;
  margin?: number;
}

export interface SettlementItemRow {
  itemCode: string;
  upc?: string;
  description: string;
  storeNumber?: string;
  quantity?: number;
  amount?: number;
}

/**
 * The settlement record: businesses/{bid}/routes/{rid}/settlements/{weekEnding}.
 * Supplier-agnostic shape; Flowers-populated first (Nov 2026). For Flowers,
 * kind='route' records come from the per-route Distributor Statement and
 * kind='master' from the Master statement (stored under the master route's
 * pseudo-route doc; per-route records NEVER take numbers from the master).
 */
export interface SettlementRecord {
  supplier: Supplier;
  kind: 'route' | 'master';
  /** Supplier route number — the ONLY route identity. Flowers text labels
   *  are unreliable (7823 is printed 'MILFORD CT' but is Stratford). */
  routeNumber: string;
  /** Printed label, kept for audit only. Never used as identity. */
  routeLabelPrinted?: string;
  distributorNumber?: string;
  /** Fiscal week number within the year, as printed (e.g. 43). */
  week: number;
  weekStart: string; // ISO yyyy-mm-dd (Sunday)
  weekEnd: string; // ISO yyyy-mm-dd (Saturday)
  weekEnding: string; // == weekEnd; the doc id

  header: {
    beginningBalanceOwed: number;
    priorWeeksBalancesTransferred: number;
    fundsPaidToDistributor: number;
    fundsReceivedFromDistributor: number;
  };

  /** Accountability block — the wholesale side. For Flowers, `totalProductCharged`
   *  is product billed at wholesale: a COST base, and the statement's balance
   *  math walks it down. There is no revenue line on a Flowers statement;
   *  "Total net" in IDP margin reporting is the wholesale bill owed TO
   *  Flowers — a cost, never revenue. */
  accountability: {
    totalProductCharged: number;
    relayAdjustment: number;
    loadAdjustment: number;
    damaged: number;
    shortCode: number;
    productTransfers: number;
    custPriceAllowancesOverrides: number;
    stales: number; // signed as printed (credit, negative in the walk)
    authorizedCharges: number;
    arCustomerInvoiceAdjustment: number;
  };

  /** Scan Based Trading block (Flowers). Window lags one week behind the
   *  statement week. All values signed as printed. */
  sbt?: {
    windowStart: string;
    windowEnd: string;
    reversalPriorWeekInventoryCredit: number;
    reversalPriorWeekDeliveryCredit: number;
    pointOfSaleData: number;
    revaluationVariance: number;
    shrink: number;
    currentWeekInventoryCredit: number;
    currentWeekDeliveryCredit: number;
  };

  /** Margin / Discounts column (Flowers): what the distributor earned on the
   *  wholesale spread this week. Values signed as printed (credits negative). */
  marginDiscounts: {
    standardDiscount: number;
    additionalDiscount: number;
    contestEarnings: number;
    otherEarnings: number;
    total: number; // as printed on the New Distributor Balance row
  };

  businessExpenses: {
    administrativeFee: number;
    warehouseFee: number;
    /** Flowers territory loan payment: $572.25/wk for 7823+13445 through
     *  W42; master steps to $1,219.99 at W43 when 7814's $647.74 joins. */
    territoryPayment: number;
    sbtShrinkCharges: number; // signed as printed
    total: number; // as printed
  };

  balances: {
    /** Accountability-column result of the weekly walk, as printed. */
    newDistributorBalance: number;
    /** Weekly distributor balance as printed. Negative = owed TO the
     *  distributor, paid by direct deposit (statement's own note). */
    weeklyDistributorBalance: number;
  };

  /** Master statements only: page-2 Associated Route Balance rows. */
  associatedRoutes?: Array<{
    routeNumber: string;
    routeLabelPrinted: string;
    distributorNumber: string;
    cumulativeBalance: number; // signed as printed
  }>;

  /** Store rows for this route-week. For Flowers these are populated from
   *  Customer Margin Detail (separate document, same route-week), merged by
   *  the ingest pipeline; the statement itself carries no store rows. */
  storeRows: SettlementStoreRow[];
  itemRows: SettlementItemRow[];

  computed: {
    productCharged: number;
    /** Stales as a positive dollar amount + share of product charged. */
    stalesAmount: number;
    stalesPct: number;
    /** Margin/discounts earned (positive dollars). */
    margin: number;
    territoryPayment: number;
    weeklyBalance: number;
    /** Amount Flowers owes the distributor for the week (direct deposit)
     *  when weeklyBalance < 0; 0 when the distributor owes Flowers. */
    fundsDueToDistributor: number;
    /** True net after operating costs — Phase 3 cost layering; null until
     *  costDefaults are applied. Never estimated here. */
    netProfit: number | null;
    /** Bimbo 'check issued' equivalent; for Flowers this is
     *  fundsDueToDistributor. Null for master records (not a payable). */
    check: number | null;
  };

  validation: ValidationResult;
  sources: SourceRef[];
  registryId: string;
}

/* ------------------------------------------------------------------ *
 * Generated driver guide book + route card (Chris's directive,
 * 2026-11-10): when a settlement is ingested for a route, the ingest
 * pipeline generates these from the settlement's store rows + the
 * route's store registry and stores them at
 *   businesses/{bid}/routes/{rid}/guides/{weekEnding}
 * so any driver picking up the route can run it for the day. Built
 * ONLY from records — a figure with no source row stays null.
 * ------------------------------------------------------------------ */

export interface GuideStoreRow {
  /** Supplier store/customer number — the join key, as on Store. */
  storeNumber: string;
  storeName: string;
  /** Registry address; null when the row has no registry match. */
  address?: string | null;
  /** Run order from the registry when confirmed; null otherwise. */
  sequence?: number | null;
  /** Settlement-week pieces for this store; null when no row. */
  pieces?: number | null;
  /** Settlement-week dollars for this store; null when no row. */
  sales?: number | null;
}

export interface RouteGuideData {
  weekEnding: string;
  week: number;
  routeNumber: string;
  generatedAt: string; // ISO timestamp
  /** Firestore path of the settlement record this was generated from. */
  sourceSettlementPath: string;
  /** The full blueprint book for the route-week. */
  guideBook: {
    routeLabel: string;
    weekPieces: number | null;
    weekSales: number | null;
    stalesPct: number | null;
    stalesAmount: number | null;
    stores: GuideStoreRow[];
  };
  /** The one-page registry sheet: every registry stop, in run order. */
  routeCard: {
    routeLabel: string;
    stops: GuideStoreRow[];
  };
}

/** SBT Shrink record: businesses/{bid}/routes/{rid}/shrinkReports/{weekEnding}.
 *  KEYED BY THE COVERED WEEK read from the document ('Week N, YYYY' /
 *  'Between <start> and <end>'), never the posting week — Flowers posts
 *  each report one week after the week it covers. */
export interface FlowersShrinkRecord {
  supplier: 'flowers';
  routeNumber: string;
  distributorNumber: string;
  coveredWeek: number;
  weekStart: string;
  weekEnd: string;
  weekEnding: string;
  runDate: string; // when Flowers generated the report (posting evidence)
  totals: ShrinkTotals;
  customers: Array<{
    customerNumber: string;
    storeName: string;
    chainStoreNumber?: string;
    duns?: string;
    totals: ShrinkTotals;
    items: Array<{
      itemCode: string;
      upc: string;
      description: string;
      quantities: number[]; // the report's 10 unit columns, in print order
      shrinkQty: number;
      shrinkPct: number;
      shrinkDollars: number;
      perpetualShrinkDollars: number;
      revalVsShrinkDollars: number;
    }>;
  }>;
  validation: ValidationResult;
  sources: SourceRef[];
  registryId: string;
}

export interface ShrinkTotals {
  quantities: number[]; // 10 unit columns as printed
  shrinkQty: number;
  shrinkPct: number;
  shrinkDollars: number;
  perpetualShrinkDollars: number;
  revalVsShrinkDollars: number;
}

/* ------------------------------------------------------------------ *
 * Design-only record shapes (parsers land in later phases).          *
 * ------------------------------------------------------------------ */

/** IDP stales / Always Fresh detail — the per-store, per-item stales feed
 *  behind the settlement's single stales line. Grain: route-week. */
export interface FlowersStalesDetailRecord {
  supplier: 'flowers';
  routeNumber: string;
  week: number;
  weekEnding: string;
  /** Settlement stales line this detail must tie to (dollars). */
  settlementStalesAmount: number;
  /** 11% of Total Product Charged, per route — the allowance benchmark. */
  allowancePct: number;
  stores: Array<{
    storeNumber: string;
    storeName: string;
    stalesAmount: number;
    stalesUnits?: number;
    items?: Array<{ itemCode: string; description: string; units: number; amount: number; reasonCode?: string }>;
  }>;
  validation: ValidationResult;
  sources: SourceRef[];
  registryId: string;
}

/** IDP Load Summary — load/pickup rollup per route-week. */
export interface FlowersLoadSummaryRecord {
  supplier: 'flowers';
  routeNumber: string;
  week: number;
  weekEnding: string;
  totalLoadedUnits?: number;
  totalDeliveredUnits?: number;
  stores?: Array<{ storeNumber: string; storeName: string; loadedUnits?: number; deliveredUnits?: number }>;
  sources: SourceRef[];
  registryId: string;
}

/** IDP Route Margin Totals — margin rollup companion to Customer Margin
 *  Detail (detail feeds store rows; totals feed the route-week margin). */
export interface FlowersRouteMarginTotalsRecord {
  supplier: 'flowers';
  routeNumber: string;
  week: number;
  weekEnding: string;
  totalQuantity: number;
  totalWholesale: number;
  totalSales: number; // HHC price basis in IDP margin reporting
  totalMargin: number;
  sources: SourceRef[];
  registryId: string;
}

/** iPlan weekly orders — READ-ONLY intake. Ordering in TruckCEO stays
 *  recommend-only; this record only captures what iPlan proposed/finalized
 *  so order-vs-sales variance can be computed against settlements. */
export interface IPlanWeeklyOrderRecord {
  routeNumber: string; // iPlan territory, e.g. '7823'
  week: number; // iPlan week id, e.g. 202646
  weekEnding: string;
  status: 'proposed' | 'final';
  totalPieces: number;
  stores?: Array<{
    storeNumber: string;
    storeName: string;
    pieces: number;
    items?: Array<{ itemCode: string; description: string; pieces: number; day?: string }>;
  }>;
  sources: SourceRef[];
  registryId: string;
}

/** Discord daily activity — structured output of the existing morning /
 *  evening route reads of the Mateo's in Motion server. Grain: route-day. */
export interface DiscordDailyActivityRecord {
  routeNumber: string;
  date: string; // ISO yyyy-mm-dd
  rollCall?: { postedAt?: string; messageId?: string; depotTime?: string };
  steps: Array<{
    step: 1 | 2 | 3 | 4 | 5;
    posted: boolean;
    postedAt?: string;
    messageId?: string;
  }>;
  eod?: { posted: boolean; postedAt?: string; messageId?: string; piecesLeft?: number; stalesPulled?: number };
  stopsDocumented?: string[];
  stopsScheduled?: string[];
  transfers?: Array<{ direction: 'in' | 'out'; units?: number; reason?: string; messageId?: string }>;
  flags: string[];
  sources: SourceRef[];
  registryId: string;
}
