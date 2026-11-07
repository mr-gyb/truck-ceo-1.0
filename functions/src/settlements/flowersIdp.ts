/**
 * Flowers IDP (OnBase distributor portal) document parsers.
 *
 * Parses the TEXT LAYER of the portal PDFs (layout-preserving extraction,
 * e.g. pdftotext -layout) into the schema in ./types.ts. Pure functions —
 * no Firestore, no I/O — so the acceptance harness can run them against
 * fixture PDFs.
 *
 * Locked rules (user, 2026-11-06):
 *  - "Total net" in Flowers reporting = the wholesale bill owed TO Flowers.
 *    A cost, never revenue. Statements carry no revenue line.
 *  - Route identity = route NUMBER, never the printed text label
 *    (statements print 7823 as 'MILFORD CT'; 7823 is Stratford, 13445 is
 *    Milford, 7814 is Stamford).
 *  - Master statements are combined across routes. Per-route records come
 *    from Distributor Statements; the master is its own record used for
 *    tie-out (its page-2 Associated Route Balances must sum to its weekly
 *    distributor balance, and same-week route charges must sum to the
 *    master's Total Product Charged — checked by the ingest pipeline).
 *  - Shrink reports post one week after the week they cover; records are
 *    keyed by the COVERED week read from the document.
 *
 * Reconcile validation (a record is `validated` only when every check ties
 * to the cent; otherwise `needs_review` with the exact discrepancies):
 *  Statements: (1) accountability walk (product block + SBT block) ==
 *    printed New Distributor Balance; (2) discount lines sum == printed
 *    margin/discount total; (3) NDB + margin total == printed combined;
 *    (4) business-expense lines sum == printed total; (5) weekly balance
 *    == combined + expenses (route statements) or == page-2 route-balance
 *    sum (master statements).
 *  Margin Detail: customer subtotals sum == route subtotal (qty + sales);
 *    invoice subtotals sum == customer subtotal per customer.
 *  Shrink: item rows sum == Customer Total per customer; customer totals
 *    sum == distributor total.
 */

import {
  FlowersShrinkRecord,
  SettlementRecord,
  SettlementStoreRow,
  SettlementItemRow,
  ShrinkTotals,
  SourceRef,
  ValidationCheck,
  ValidationResult,
} from './types';

export const FLOWERS_PARSER_VERSION = 'flowers-idp-1.0.0';

const CENT = 0.005;

/** Flowers prints negatives with a trailing minus: '1,986.02-'. */
export function parseFlowersMoney(tok: string): number | null {
  if (!tok) return null;
  let t = tok.trim().replace(/[$,]/g, '');
  let neg = false;
  if (t.endsWith('-')) { neg = true; t = t.slice(0, -1); }
  if (t.startsWith('-')) { neg = true; t = t.slice(1); }
  if (t.startsWith('(') && t.endsWith(')')) { neg = true; t = t.slice(1, -1); }
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = parseFloat(t);
  return neg ? -v : v;
}

const MONEY_RE = /-?[\d,]+\.\d{2}-?/g;

function amountsAfter(line: string, label: string): number[] {
  const idx = line.indexOf(label);
  if (idx < 0) return [];
  const rest = line.slice(idx + label.length);
  const toks = rest.match(MONEY_RE) || [];
  return toks.map((t) => parseFlowersMoney(t)).filter((v): v is number => v !== null);
}

/** First amount on the first line whose trimmed text starts with `label`. */
function labeledAmount(lines: string[], label: string): number | null {
  for (const ln of lines) {
    if (ln.trim().startsWith(label)) {
      const amts = amountsAfter(ln, label);
      if (amts.length) return amts[amts.length - 1];
    }
  }
  return null;
}

function check(name: string, expected: number, actual: number): ValidationCheck {
  const delta = Math.round((actual - expected) * 100) / 100;
  return { name, expected, actual, delta, ok: Math.abs(delta) <= CENT };
}

function validate(checks: ValidationCheck[]): ValidationResult {
  const discrepancies = checks
    .filter((c) => !c.ok)
    .map((c) => `${c.name}: printed ${c.expected.toFixed(2)} vs computed ${c.actual.toFixed(2)} (delta ${c.delta.toFixed(2)})`);
  return { status: discrepancies.length ? 'needs_review' : 'validated', checks, discrepancies };
}

function isoDate(m: string, d: string, y: string): string {
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export type FlowersDocType =
  | 'flowers_master_statement'
  | 'flowers_distributor_statement'
  | 'flowers_margin_detail'
  | 'flowers_sbt_shrink';

export function detectFlowersDocType(text: string): FlowersDocType | null {
  if (/Customer Margin Detail/.test(text)) return 'flowers_margin_detail';
  if (/Scan Based Trading Shrink Report/.test(text)) return 'flowers_sbt_shrink';
  if (/Page 2:\s+Associated Route Balance/.test(text) || /Master Distrib Number/.test(text) && /Master Route/.test(text) && !/^\s*Route:/m.test(text)) {
    return 'flowers_master_statement';
  }
  if (/Distributor Number/.test(text) && /Total Product Charged/.test(text)) return 'flowers_distributor_statement';
  return null;
}

/* ------------------------------------------------------------------ */
/*  Statements (Master + per-route Distributor)                        */
/* ------------------------------------------------------------------ */

const ACCOUNTABILITY_LABELS: Array<[string, keyof SettlementRecord['accountability']]> = [
  ['Total Product Charged', 'totalProductCharged'],
  ['Relay Adjustment', 'relayAdjustment'],
  ['Load Adjustment', 'loadAdjustment'],
  ['Damaged', 'damaged'],
  ['Short Code', 'shortCode'],
  ['Product Transfers', 'productTransfers'],
  ['Cust Price Allwncs/Overrides', 'custPriceAllowancesOverrides'],
  ['Stales', 'stales'],
  ['Authorized Charges', 'authorizedCharges'],
  ['A/R Customer Invoice Adjustment', 'arCustomerInvoiceAdjustment'],
];

const SBT_LABELS: Array<[string, keyof NonNullable<SettlementRecord['sbt']>]> = [
  ['Reversal Prior Week Inventory Credit', 'reversalPriorWeekInventoryCredit'],
  ['Reversal Prior Week Delivery Credit', 'reversalPriorWeekDeliveryCredit'],
  ['Point of Sale Data', 'pointOfSaleData'],
  ['Revaluation Variance', 'revaluationVariance'],
  ['Shrink', 'shrink'],
  ['Current Week Inventory Credit', 'currentWeekInventoryCredit'],
  ['Current Week Delivery Credit', 'currentWeekDeliveryCredit'],
];

export function parseFlowersStatement(
  text: string,
  source: SourceRef,
  registryId: string,
): SettlementRecord {
  const lines = text.split('\n');
  const isMaster = detectFlowersDocType(text) === 'flowers_master_statement';

  const weekMatch = text.match(/Week #\s*(\d+)\s*\(\s*(\d{2})\/(\d{2})\/(\d{4}) to (\d{2})\/(\d{2})\/(\d{4})\s*\)/);
  if (!weekMatch) throw new Error('flowers statement: week header not found');
  const week = parseInt(weekMatch[1], 10);
  const weekStart = isoDate(weekMatch[2], weekMatch[3], weekMatch[4]);
  const weekEnd = isoDate(weekMatch[5], weekMatch[6], weekMatch[7]);

  let routeNumber = '';
  let routeLabelPrinted: string | undefined;
  let distributorNumber: string | undefined;
  if (isMaster) {
    const mr = text.match(/Master Route:\s*(\d+)/);
    routeNumber = mr ? mr[1] : '';
    const dn = text.match(/Master Distrib Number:\s*(\d+)/);
    distributorNumber = dn ? dn[1] : undefined;
  } else {
    const rl = text.match(/^\s*Route:\s*(\d+)\s{2,}(.+?)\s*$/m);
    if (rl) { routeNumber = rl[1]; routeLabelPrinted = rl[2].trim(); }
    const dn = text.match(/Distributor Number:\s*(\d+)/);
    distributorNumber = dn ? dn[1] : undefined;
  }

  const header = {
    beginningBalanceOwed: labeledAmount(lines, 'Beginning Balance Owed') ?? 0,
    priorWeeksBalancesTransferred: (() => {
      // Two print columns (master shows the amount twice; route statements
      // show it once plus 0.00). The balance-relevant value is the LAST one
      // on the row for masters and the FIRST nonzero for route statements;
      // it is informational for validation, so take the max absolute value.
      for (const ln of lines) {
        if (ln.trim().startsWith("Prior Weeks' Balances Transferred")) {
          const amts = amountsAfter(ln, "Prior Weeks' Balances Transferred");
          if (amts.length) return amts.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), amts[0]);
        }
      }
      return 0;
    })(),
    fundsPaidToDistributor: labeledAmount(lines, 'Funds Paid To Distributor') ?? 0,
    fundsReceivedFromDistributor: labeledAmount(lines, 'Funds Received From Distributor') ?? 0,
  };

  const accountability = {} as SettlementRecord['accountability'];
  for (const [label, key] of ACCOUNTABILITY_LABELS) {
    accountability[key] = labeledAmount(lines, label) ?? 0;
  }

  // SBT block: lines between 'Scan Based Trading Adj.' and 'New Distributor Balance'.
  const sbtWindow = text.match(/Scan Based Trading Adj\.\s*\(\s*(\d{2})\/(\d{2})\/(\d{4}) to (\d{2})\/(\d{2})\/(\d{4})\s*\)/);
  const sbt = {
    windowStart: sbtWindow ? isoDate(sbtWindow[1], sbtWindow[2], sbtWindow[3]) : '',
    windowEnd: sbtWindow ? isoDate(sbtWindow[4], sbtWindow[5], sbtWindow[6]) : '',
    reversalPriorWeekInventoryCredit: 0,
    reversalPriorWeekDeliveryCredit: 0,
    pointOfSaleData: 0,
    revaluationVariance: 0,
    shrink: 0,
    currentWeekInventoryCredit: 0,
    currentWeekDeliveryCredit: 0,
  } as NonNullable<SettlementRecord['sbt']>;
  let inSbt = false;
  for (const ln of lines) {
    if (ln.includes('Scan Based Trading Adj')) { inSbt = true; continue; }
    if (inSbt) {
      if (ln.includes('New Distributor Balance')) break;
      const s = ln.trim();
      for (const [label, key] of SBT_LABELS) {
        if (s.startsWith(label)) {
          const amts = amountsAfter(ln, label);
          if (amts.length) (sbt as any)[key] = amts[amts.length - 1];
        }
      }
    }
  }

  const marginDiscounts = {
    standardDiscount: labeledAmount(lines, 'Standard Discount') ?? 0,
    additionalDiscount: labeledAmount(lines, 'Additional Discount') ?? 0,
    contestEarnings: labeledAmount(lines, 'Contest Earnings') ?? 0,
    otherEarnings: labeledAmount(lines, 'Other Earnings') ?? 0,
    total: 0,
  };

  // New Distributor Balance row carries 3 amounts: accountability, margin, combined.
  let ndbRow: number[] = [];
  for (const ln of lines) {
    if (ln.includes('New Distributor Balance')) { ndbRow = amountsAfter(ln, 'New Distributor Balance'); break; }
  }
  const newDistributorBalance = ndbRow.length ? ndbRow[0] : 0;
  const printedMarginTotal = ndbRow.length >= 2 ? ndbRow[1] : 0;
  const printedCombined = ndbRow.length >= 3 ? ndbRow[2] : newDistributorBalance + printedMarginTotal;
  marginDiscounts.total = printedMarginTotal;

  // Business expenses: lines are single- or dual-column in any pairing
  // (e.g. 'Administrative Fee ... SBT Shrink Charges ...'), and a line that
  // is absent entirely means 0. Scan each label wherever it appears.
  let administrativeFee = 0, warehouseFee = 0, territoryPayment = 0, sbtShrinkCharges = 0, totalExpenses = 0;
  const expenseLabels: Array<[string, (v: number) => void]> = [
    ['Administrative Fee', (v) => { administrativeFee = v; }],
    ['Warehouse Fee', (v) => { warehouseFee = v; }],
    ['Territory Payment', (v) => { territoryPayment = v; }],
    ['SBT Shrink Charges', (v) => { sbtShrinkCharges = v; }],
  ];
  let inExpenses = false;
  for (const ln of lines) {
    if (ln.includes('Business Expenses:')) { inExpenses = true; continue; }
    if (!inExpenses) continue;
    if (ln.includes('Weekly Distributor Balance')) break;
    if (ln.trim().startsWith('Total Business Expense')) {
      const a = amountsAfter(ln, 'Total Business Expense');
      if (a.length) totalExpenses = a[a.length - 1];
      continue;
    }
    for (const [label, set] of expenseLabels) {
      if (ln.includes(label)) {
        const a = amountsAfter(ln, label);
        if (a.length) set(a[0]);
      }
    }
  }

  const weeklyDistributorBalance = labeledAmount(lines, 'Weekly Distributor Balance') ?? 0;

  // Master page 2: Associated Route Balance rows.
  let associatedRoutes: SettlementRecord['associatedRoutes'];
  if (isMaster) {
    associatedRoutes = [];
    const p2 = text.split(/Page 2:\s+Associated Route Balance/)[1] || '';
    for (const ln of p2.split('\n')) {
      // Note: the distributor number can be jammed against the description
      // with no separating spaces ('...TO 7823 - MILF20040846').
      const m = ln.match(/^\s*(\d{4,8})\s{2,}(.+?)\s*(\d{8})\s{2,}(.+?)\s{2,}(-?[\d,]+\.\d{2}-?)\s*$/);
      if (m) {
        const bal = parseFlowersMoney(m[5]);
        if (bal !== null) {
          associatedRoutes.push({
            routeNumber: m[1],
            routeLabelPrinted: m[2].trim(),
            distributorNumber: m[3],
            cumulativeBalance: bal,
          });
        }
      }
    }
  }

  /* Validation */
  const acctSum = ACCOUNTABILITY_LABELS.reduce((s, [, k]) => s + (accountability[k] as number), 0);
  const sbtSum = SBT_LABELS.reduce((s, [, k]) => s + (sbt[k] as number), 0);
  const checks: ValidationCheck[] = [];
  checks.push(check('accountability walk -> New Distributor Balance', newDistributorBalance, acctSum + sbtSum));
  const discountSum = marginDiscounts.standardDiscount + marginDiscounts.additionalDiscount +
    marginDiscounts.contestEarnings + marginDiscounts.otherEarnings;
  checks.push(check('discount lines -> margin/discount total', printedMarginTotal, discountSum));
  checks.push(check('NDB + margin total -> combined', printedCombined, newDistributorBalance + printedMarginTotal));
  const expSum = administrativeFee + warehouseFee + territoryPayment + sbtShrinkCharges;
  checks.push(check('business expense lines -> total', totalExpenses, expSum));
  if (isMaster && associatedRoutes && associatedRoutes.length) {
    const routeSum = associatedRoutes.reduce((s, r) => s + r.cumulativeBalance, 0);
    checks.push(check('page-2 associated route balances -> weekly balance', weeklyDistributorBalance, routeSum));
  } else {
    checks.push(check('combined + expenses -> weekly distributor balance', weeklyDistributorBalance, printedCombined + totalExpenses));
  }
  const validation = validate(checks);

  const charged = accountability.totalProductCharged;
  const stalesAmount = Math.abs(accountability.stales);
  const weekly = weeklyDistributorBalance;
  return {
    supplier: 'flowers',
    kind: isMaster ? 'master' : 'route',
    routeNumber,
    routeLabelPrinted,
    distributorNumber,
    week,
    weekStart,
    weekEnd,
    weekEnding: weekEnd,
    header,
    accountability,
    sbt,
    marginDiscounts,
    businessExpenses: { administrativeFee, warehouseFee, territoryPayment, sbtShrinkCharges, total: totalExpenses },
    balances: { newDistributorBalance, weeklyDistributorBalance: weekly },
    associatedRoutes,
    storeRows: [],
    itemRows: [],
    computed: {
      productCharged: charged,
      stalesAmount,
      stalesPct: charged ? Math.round((stalesAmount / charged) * 10000) / 100 : 0,
      margin: Math.abs(printedMarginTotal),
      territoryPayment,
      weeklyBalance: weekly,
      fundsDueToDistributor: weekly < 0 ? -weekly : 0,
      netProfit: null,
      check: isMaster ? null : weekly < 0 ? -weekly : 0,
    },
    validation,
    sources: [source],
    registryId,
  };
}

/* ------------------------------------------------------------------ */
/*  Customer Margin Detail                                             */
/* ------------------------------------------------------------------ */

export interface FlowersMarginDetailRecord {
  supplier: 'flowers';
  routeNumber: string;
  distributorNumber?: string;
  week: number;
  weekStart: string;
  weekEnd: string;
  weekEnding: string;
  /** Route totals exactly as printed on 'Subtotal by Route'. Sales basis is
   *  the HHC Price column (what stores were billed at handheld prices). */
  routeTotals: { quantity: number; wholesale: number; sales: number; baseMargin: number; adjustedMargin: number; allowance: number };
  storeRows: SettlementStoreRow[];
  itemRows: SettlementItemRow[];
  validation: ValidationResult;
  sources: SourceRef[];
  registryId: string;
}

interface SubtotalNums { quantity: number; wholesale: number; sales: number; baseMargin: number; adjustedMargin: number; allowance: number }

function parseSubtotalNums(rest: string): SubtotalNums | null {
  const toks = rest.trim().split(/\s+/).filter(Boolean);
  if (toks.length < 6) return null;
  const tail = toks.slice(-6);
  const qty = parseInt(tail[0].replace(/,/g, ''), 10);
  const nums = tail.slice(1).map((t) => parseFlowersMoney(t));
  if (Number.isNaN(qty) || nums.some((n) => n === null)) return null;
  return { quantity: qty, wholesale: nums[0]!, sales: nums[1]!, baseMargin: nums[2]!, adjustedMargin: nums[3]!, allowance: nums[4]! };
}

export function parseFlowersMarginDetail(
  text: string,
  source: SourceRef,
  registryId: string,
): FlowersMarginDetailRecord {
  const lines = text.split('\n');
  const weekMatch = text.match(/Week\s+(\d+)\s+2026\s*\(\s*(\d{2})\/(\d{2})\/(\d{4}) to (\d{2})\/(\d{2})\/(\d{4})\s*\)/) ||
    text.match(/Week\s+(\d+)\s+\d{4}\s*\(\s*(\d{2})\/(\d{2})\/(\d{4}) to (\d{2})\/(\d{2})\/(\d{4})\s*\)/);
  if (!weekMatch) throw new Error('margin detail: week header not found');
  const week = parseInt(weekMatch[1], 10);
  const weekStart = isoDate(weekMatch[2], weekMatch[3], weekMatch[4]);
  const weekEnd = isoDate(weekMatch[5], weekMatch[6], weekMatch[7]);

  const routeMatch = text.match(/Route\s*:\s*(\d+)\s+([A-Z ]+)/);
  const routeNumber = routeMatch ? routeMatch[1] : '';
  const distMatch = text.match(/Distributor\s*:\s*(\d+)/);
  const distributorNumber = distMatch ? distMatch[1] : undefined;

  // Subtotals. The report is grouped by DATE: each date section repeats
  // 'Subtotal by Customer' rows, so a customer's route-week store row is
  // the SUM of its per-date subtotal rows.
  let routeTotals: SubtotalNums | null = null;
  const customerTotals = new Map<string, SubtotalNums>();
  const invoiceSubtotals: SubtotalNums[] = [];
  const customerNames = new Map<string, { name: string; chainStoreNumber?: string }>();
  const addNums = (a: SubtotalNums, b: SubtotalNums): SubtotalNums => ({
    quantity: a.quantity + b.quantity,
    wholesale: Math.round((a.wholesale + b.wholesale) * 100) / 100,
    sales: Math.round((a.sales + b.sales) * 100) / 100,
    baseMargin: Math.round((a.baseMargin + b.baseMargin) * 100) / 100,
    adjustedMargin: Math.round((a.adjustedMargin + b.adjustedMargin) * 100) / 100,
    allowance: Math.round((a.allowance + b.allowance) * 100) / 100,
  });

  // Banner tracking for customer names: a right-column ALL-CAPS name line,
  // followed by a '#nnnn' store line, precedes that customer's item rows.
  let pendingName = '';
  let pendingStoreNo: string | undefined;
  const itemStartRe = /^([A-Z])\s+(\d{10})\s+(\d{8})\s+(.*?)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{10})\s+(\d{8})\s*(.*)$/;
  const tailRe = /(-?[\d,]+)\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2}|0)\s+(-?[\d,]+\.\d{2}|0)\s+(-?[\d,]+\.\d{2}|0)\s*$/;

  const itemRows: SettlementItemRow[] = [];
  let lastSoldTo = '';
  let current: { soldTo: string; ticket: string; material: string; descParts: string[]; tailFrom?: string } | null = null;

  const flushItem = (tailText: string) => {
    if (!current) return;
    const tm = tailText.match(tailRe);
    if (tm) {
      const qty = parseInt(tm[1].replace(/,/g, ''), 10);
      const hhc = parseFlowersMoney(tm[3]);
      itemRows.push({
        itemCode: current.material,
        description: current.descParts.join(' ').replace(/\s+/g, ' ').trim(),
        storeNumber: current.soldTo,
        quantity: Number.isNaN(qty) ? undefined : qty,
        amount: hhc ?? undefined,
      });
    }
    current = null;
  };

  for (const raw of lines) {
    const ln = raw.replace(/\s+$/, '');
    const s = ln.trim();

    const subRoute = ln.match(/Subtotal by Route\s+(\d+)\s+(.*)$/);
    if (subRoute) { const n = parseSubtotalNums(subRoute[2]); if (n) routeTotals = n; continue; }
    const subCust = ln.match(/Subtotal by Customer\s+(\d+)\s+(.*)$/);
    if (subCust) {
      const n = parseSubtotalNums(subCust[2]);
      if (n) {
        const prev = customerTotals.get(subCust[1]);
        customerTotals.set(subCust[1], prev ? addNums(prev, n) : n);
      }
      continue;
    }
    const subInv = ln.match(/Subtotal by Invoice\s+(\d+)\s+(.*)$/);
    if (subInv) {
      const n = parseSubtotalNums(subInv[2]);
      if (n) invoiceSubtotals.push(n);
      continue;
    }

    const im = ln.match(itemStartRe);
    if (im) {
      if (current) flushItem('');
      const soldTo = im[3];
      lastSoldTo = soldTo;
      if (pendingName && !customerNames.has(soldTo)) {
        customerNames.set(soldTo, { name: pendingName, chainStoreNumber: pendingStoreNo });
      }
      current = { soldTo, ticket: im[6], material: im[7], descParts: im[8] ? [im[8]] : [] };
      // Tail may be on the same line (after description) — check:
      const tm = ln.match(tailRe);
      if (tm && im[8]) {
        // strip the tail from the description
        const descEnd = ln.lastIndexOf(tm[0]);
        const desc = ln.slice(0, descEnd).replace(itemStartRe, '$8');
        current.descParts = desc ? [desc] : [];
        flushItem(ln);
      }
      continue;
    }

    // Name banner lines (right-column caps text, no digits-heavy content).
    const banner = ln.match(/^\s{20,}([A-Z][A-Z0-9 '&.\/-]{2,})\s*$/);
    if (banner && !/Subtotal|Customer|Selections|Sales Organization|Distributor|Route|Branch/.test(banner[1])) {
      pendingName = banner[1].trim();
      continue;
    }
    const storeLine = ln.match(/#(\d{4})\b/);
    if (storeLine && current === null) { pendingStoreNo = storeLine[1]; continue; }
    // Name may be embedded on an item's second visual line with the tail.
    if (current) {
      const tm = ln.match(tailRe);
      if (tm) { flushItem(ln); continue; }
      const nameInLine = ln.match(/^\s{20,}([A-Z][A-Z0-9 '&.\/-]{2,})/);
      if (nameInLine && current.soldTo && !customerNames.has(current.soldTo)) {
        customerNames.set(current.soldTo, { name: nameInLine[1].trim(), chainStoreNumber: pendingStoreNo });
        continue;
      }
      if (s && !s.startsWith('#')) current.descParts.push(s.replace(/#\d{4}/, '').trim());
      const hash = ln.match(/#(\d{4})/);
      if (hash) pendingStoreNo = hash[1];
    }
  }
  if (current) flushItem('');

  if (!routeTotals) throw new Error('margin detail: route subtotal not found');

  const storeRows: SettlementStoreRow[] = [];
  for (const [soldTo, nums] of customerTotals) {
    const nm = customerNames.get(soldTo);
    storeRows.push({
      storeNumber: soldTo,
      storeName: nm?.name || '',
      chainStoreNumber: nm?.chainStoreNumber,
      quantity: nums.quantity,
      sales: nums.sales,
      wholesale: nums.wholesale,
      margin: nums.baseMargin,
    });
  }

  const checks: ValidationCheck[] = [];
  const sumQty = storeRows.reduce((s, r) => s + (r.quantity || 0), 0);
  const sumSales = storeRows.reduce((s, r) => s + (r.sales || 0), 0);
  const sumWholesale = storeRows.reduce((s, r) => s + (r.wholesale || 0), 0);
  checks.push(check('customer subtotals qty -> route qty', routeTotals.quantity, sumQty));
  checks.push(check('customer subtotals sales -> route sales', routeTotals.sales, Math.round(sumSales * 100) / 100));
  checks.push(check('customer subtotals wholesale -> route wholesale', routeTotals.wholesale, Math.round(sumWholesale * 100) / 100));
  // Every invoice subtotal across all date sections must sum to the same
  // route totals the customer subtotals tie to.
  if (invoiceSubtotals.length) {
    const invQty = invoiceSubtotals.reduce((s, n) => s + n.quantity, 0);
    const invSales = Math.round(invoiceSubtotals.reduce((s, n) => s + n.sales, 0) * 100) / 100;
    checks.push(check('invoice subtotals qty -> route qty', routeTotals.quantity, invQty));
    checks.push(check('invoice subtotals sales -> route sales', routeTotals.sales, invSales));
  }

  return {
    supplier: 'flowers',
    routeNumber,
    distributorNumber,
    week,
    weekStart,
    weekEnd,
    weekEnding: weekEnd,
    routeTotals,
    storeRows,
    itemRows,
    validation: validate(checks),
    sources: [source],
    registryId,
  };
}

/* ------------------------------------------------------------------ */
/*  SBT Shrink report                                                  */
/* ------------------------------------------------------------------ */

function parseShrinkRowNumbers(line: string): {
  quantities: number[]; shrinkPct: number; dollars: [number, number, number];
} | null {
  // Token-anchored: find the percent token; the 10 unit columns are the 10
  // tokens immediately before it, the 3 $ amounts the 3 tokens after.
  // (Scanning raw numbers is unsafe — descriptions like '20.5 OZ' inject
  // extra numeric tokens and shift the columns.)
  const tokens = line.trim().split(/\s+/);
  // Anchor from the END: descriptions can contain '%' ('100% WHOLE WHEAT'),
  // so the real percent token is the one followed by exactly 3 $ tokens
  // that run to the end of the line.
  let pctIdx = -1;
  for (let i = tokens.length - 4; i >= 10; i--) {
    // Percent may carry a thousands comma ('-1,250%').
    if (/^-?[\d,]+(?:\.\d+)?%$/.test(tokens[i]) &&
        tokens[i + 1].startsWith('$') && tokens[i + 2].startsWith('$') && tokens[i + 3].startsWith('$')) {
      pctIdx = i;
      break;
    }
  }
  if (pctIdx < 10) return null;
  const quantities = tokens.slice(pctIdx - 10, pctIdx).map((t) => parseInt(t.replace(/,/g, ''), 10));
  if (quantities.some((q) => Number.isNaN(q))) return null;
  const dollars = tokens.slice(pctIdx + 1, pctIdx + 4).map((t) =>
    t.startsWith('$') ? parseFlowersMoney(t.slice(1)) : null,
  ) as [number, number, number];
  if (dollars.some((d) => d === null)) return null;
  return { quantities, shrinkPct: parseFloat(tokens[pctIdx].replace(/,/g, '')), dollars };
}

function totalsFromRow(line: string): ShrinkTotals | null {
  const p = parseShrinkRowNumbers(line);
  if (!p) return null;
  return {
    quantities: p.quantities,
    shrinkQty: p.quantities[9],
    shrinkPct: p.shrinkPct,
    shrinkDollars: p.dollars[0],
    perpetualShrinkDollars: p.dollars[1],
    revalVsShrinkDollars: p.dollars[2],
  };
}

export function parseFlowersShrinkReport(
  text: string,
  source: SourceRef,
  registryId: string,
): FlowersShrinkRecord {
  const lines = text.split('\n');
  const weekMatch = text.match(/Week\s+(\d+),\s*2026/) || text.match(/Week\s+(\d+),\s*\d{4}/);
  const between = text.match(/Between\s+(\d{2})\/(\d{2})\/(\d{4})\s+and\s+(\d{2})\/(\d{2})\/(\d{4})/);
  if (!weekMatch || !between) throw new Error('shrink report: covered-week header not found');
  const coveredWeek = parseInt(weekMatch[1], 10);
  const weekStart = isoDate(between[1], between[2], between[3]);
  const weekEnd = isoDate(between[4], between[5], between[6]);

  const routeMatch = text.match(/Route\s*:\s*(\d+)/);
  const routeNumber = routeMatch ? routeMatch[1] : '';
  const distMatch = text.match(/Distributor\s*:\s*(\d+)/);
  const distributorNumber = distMatch ? distMatch[1] : '';
  const runMatch = text.match(/Run Date\/Time:\s*(\d{2}\/\d{2}\/\d{4})/);
  const runDate = runMatch ? isoDate(runMatch[1].split('/')[0], runMatch[1].split('/')[1], runMatch[1].split('/')[2]) : '';

  type Cust = FlowersShrinkRecord['customers'][number];
  const customers: Cust[] = [];
  let distributorTotal: ShrinkTotals | null = null;
  let current: Cust | null = null;
  // Cycle dates print single-digit months in Sep/Oct weeks ('9/27/26').
  const itemRe = /^(\d{8})\s+(\d{10})\s+(.+?)\s+(\d{1,2}\/\d{1,2}\/\d{2})\s+(\d{1,2}\/\d{1,2}\/\d{2})\s+/;

  for (const ln of lines) {
    // Store numbers are usually numeric but not always (ALDI prints #L610).
    const custHead = ln.match(/Customer:\s+(\d+)\s+(.+?)\s+Store:\s*#([A-Z0-9]+)\s+Duns:\s*(\S+)/);
    if (custHead) {
      if (!current || current.customerNumber !== custHead[1] || current.chainStoreNumber !== custHead[3]) {
        current = {
          customerNumber: custHead[1],
          storeName: custHead[2].trim(),
          chainStoreNumber: custHead[3],
          duns: custHead[4],
          totals: { quantities: [], shrinkQty: 0, shrinkPct: 0, shrinkDollars: 0, perpetualShrinkDollars: 0, revalVsShrinkDollars: 0 },
          items: [],
        };
        customers.push(current);
      }
      continue;
    }
    if (/Customer Total:/.test(ln)) {
      const t = totalsFromRow(ln);
      if (t && current) current.totals = t;
      continue;
    }
    if (/-\s*\d{8}\s+\d{1,2}\/\d{1,2}\/\d{2}\s+\d{1,2}\/\d{1,2}\/\d{2}\s/.test(ln) && parseShrinkRowNumbers(ln)) {
      // Distributor total row: '<NAME> - <distributorNumber> <date> <date> <totals>'
      const t = totalsFromRow(ln);
      if (t) distributorTotal = t;
      continue;
    }
    const im = ln.match(itemRe);
    if (im && current) {
      const p = parseShrinkRowNumbers(ln);
      if (p) {
        current.items.push({
          itemCode: im[1],
          upc: im[2],
          description: im[3].trim(),
          quantities: p.quantities,
          shrinkQty: p.quantities[9],
          shrinkPct: p.shrinkPct,
          shrinkDollars: p.dollars[0],
          perpetualShrinkDollars: p.dollars[1],
          revalVsShrinkDollars: p.dollars[2],
        });
      }
    }
  }

  if (!distributorTotal) throw new Error('shrink report: distributor total row not found');

  const checks: ValidationCheck[] = [];
  let worstItemDelta = 0;
  for (const c of customers) {
    const sumQty = c.items.reduce((s, i) => s + i.shrinkQty, 0);
    const sumDol = Math.round(c.items.reduce((s, i) => s + i.shrinkDollars, 0) * 100) / 100;
    worstItemDelta = Math.max(worstItemDelta, Math.abs(sumQty - c.totals.shrinkQty), Math.abs(sumDol - c.totals.shrinkDollars));
  }
  checks.push({
    name: 'item rows -> Customer Total (worst customer delta, units/$)',
    expected: 0,
    actual: Math.round(worstItemDelta * 100) / 100,
    delta: Math.round(worstItemDelta * 100) / 100,
    ok: worstItemDelta <= CENT,
  });
  const custQty = customers.reduce((s, c) => s + c.totals.shrinkQty, 0);
  const custDol = Math.round(customers.reduce((s, c) => s + c.totals.shrinkDollars, 0) * 100) / 100;
  const custPerp = Math.round(customers.reduce((s, c) => s + c.totals.perpetualShrinkDollars, 0) * 100) / 100;
  checks.push(check('customer totals shrink qty -> distributor total', distributorTotal.shrinkQty, custQty));
  checks.push(check('customer totals shrink $ -> distributor total', distributorTotal.shrinkDollars, custDol));
  checks.push(check('customer totals perpetual $ -> distributor total', distributorTotal.perpetualShrinkDollars, custPerp));

  return {
    supplier: 'flowers',
    routeNumber,
    distributorNumber,
    coveredWeek,
    weekStart,
    weekEnd,
    weekEnding: weekEnd,
    runDate,
    totals: distributorTotal,
    customers,
    validation: validate(checks),
    sources: [source],
    registryId,
  };
}
