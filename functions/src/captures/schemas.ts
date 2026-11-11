/**
 * Capture-extraction schemas + validation gate (2026-11-10).
 *
 * Every provider output (RawExtraction) passes through here before it
 * can touch Firestore. The gate enforces the honesty rules:
 *   - Types are strict: a count must be a non-negative integer NUMBER
 *     (the string "148" is not a count), money a non-negative number,
 *     a date must parse to a real calendar date.
 *   - Confidence floor: a read below CONFIDENCE_MIN is treated as NOT
 *     read (value null; the confidence itself is preserved in the
 *     detail so the record shows what the reader thought it saw).
 *   - Key fields: each capture type has fields the rest of the app
 *     consumes (RECEIPT totalPieces, STALES totalStalePieces, DEPOT
 *     piecesLoaded, INVENTORY totalPieces, TRANSFER totalPieces,
 *     VOICE transcript, SHELF productsPresent, OTHER summary). If a
 *     key field cannot be read, the whole capture is needs_attention —
 *     a partial read must never pose as a value downstream.
 *   - Totals: printed total wins; otherwise the sum of item quantities
 *     when EVERY item quantity was read (totalSource 'summed').
 */

import type {
  CaptureExtracted,
  CaptureExtraction,
  CaptureExtractionDetail,
  CaptureType,
  ExtractedLineItem,
  FieldRead,
  RawExtraction,
  RawField,
  ReaderInfo,
  ReaderWriteBack,
} from './types';

export const CONFIDENCE_MIN = 0.6;

/** Reader build that owns this gate (stamped into every extraction). */
export const READER_VERSION = 'capture-reader-1.0.0';

// ─── Field coercion ─────────────────────────────────────────────────────

const clampConf = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;

function rawField(raw: RawExtraction, key: string): RawField | null {
  const f = raw.fields?.[key];
  if (!f || typeof f !== 'object') return null;
  return { value: (f as RawField).value, confidence: clampConf((f as RawField).confidence) };
}

function readText(raw: RawExtraction, key: string): FieldRead<string> {
  const f = rawField(raw, key);
  if (!f) return { value: null, confidence: 0 };
  const v = typeof f.value === 'string' ? f.value.trim() : '';
  return { value: v && f.confidence >= CONFIDENCE_MIN ? v : null, confidence: f.confidence };
}

function readCount(raw: RawExtraction, key: string): FieldRead<number> {
  const f = rawField(raw, key);
  if (!f) return { value: null, confidence: 0 };
  const v = f.value;
  const ok =
    typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0 &&
    f.confidence >= CONFIDENCE_MIN;
  return { value: ok ? (v as number) : null, confidence: f.confidence };
}

function readMoney(raw: RawExtraction, key: string): FieldRead<number> {
  const f = rawField(raw, key);
  if (!f) return { value: null, confidence: 0 };
  const v = f.value;
  const ok =
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && f.confidence >= CONFIDENCE_MIN;
  return { value: ok ? Math.round((v as number) * 100) / 100 : null, confidence: f.confidence };
}

function readBool(raw: RawExtraction, key: string): FieldRead<boolean> {
  const f = rawField(raw, key);
  if (!f) return { value: null, confidence: 0 };
  const ok = typeof f.value === 'boolean' && f.confidence >= CONFIDENCE_MIN;
  return { value: ok ? (f.value as boolean) : null, confidence: f.confidence };
}

function readDirection(raw: RawExtraction, key: string): FieldRead<'in' | 'out'> {
  const f = rawField(raw, key);
  if (!f) return { value: null, confidence: 0 };
  const v = typeof f.value === 'string' ? f.value.trim().toLowerCase() : '';
  const ok = (v === 'in' || v === 'out') && f.confidence >= CONFIDENCE_MIN;
  return { value: ok ? (v as 'in' | 'out') : null, confidence: f.confidence };
}

function readTextList(raw: RawExtraction, key: string): FieldRead<string[]> {
  const f = rawField(raw, key);
  if (!f) return { value: null, confidence: 0 };
  if (!Array.isArray(f.value) || f.confidence < CONFIDENCE_MIN) {
    return { value: null, confidence: f.confidence };
  }
  const list = f.value
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim());
  return { value: list, confidence: f.confidence };
}

/** Dates normalize to ISO yyyy-mm-dd; MM/DD/YYYY is the printed US form. */
function readDate(raw: RawExtraction, key: string): FieldRead<string> {
  const f = rawField(raw, key);
  if (!f || typeof f.value !== 'string' || f.confidence < CONFIDENCE_MIN) {
    return { value: null, confidence: f?.confidence ?? 0 };
  }
  const s = f.value.trim();
  let y = 0, m = 0, d = 0;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
  else if (us) { m = +us[1]; d = +us[2]; y = +us[3]; }
  else return { value: null, confidence: f.confidence };
  const dt = new Date(Date.UTC(y, m - 1, d));
  const real = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  if (!real) return { value: null, confidence: f.confidence };
  const pad = (n: number) => String(n).padStart(2, '0');
  return { value: `${y}-${pad(m)}-${pad(d)}`, confidence: f.confidence };
}

/**
 * Line items arrive as ONE raw field whose value is an array of
 * { product, qty, amount?, confidence } — one reader confidence per line.
 */
function readItems(raw: RawExtraction, key: string): ExtractedLineItem[] {
  const f = rawField(raw, key);
  if (!f || !Array.isArray(f.value)) return [];
  const items: ExtractedLineItem[] = [];
  for (const line of f.value as Array<Record<string, unknown>>) {
    if (!line || typeof line !== 'object') continue;
    const conf = clampConf(line.confidence);
    const product = typeof line.product === 'string' ? line.product.trim() : '';
    const qty = line.qty;
    const item: ExtractedLineItem = {
      product: { value: product && conf >= CONFIDENCE_MIN ? product : null, confidence: conf },
      qty: {
        value:
          typeof qty === 'number' && Number.isFinite(qty) && Number.isInteger(qty) && qty >= 0 &&
          conf >= CONFIDENCE_MIN
            ? qty
            : null,
        confidence: conf,
      },
    };
    if ('amount' in line) {
      const amt = line.amount;
      item.amount = {
        value:
          typeof amt === 'number' && Number.isFinite(amt) && amt >= 0 && conf >= CONFIDENCE_MIN
            ? Math.round(amt * 100) / 100
            : null,
        confidence: conf,
      };
    }
    items.push(item);
  }
  return items;
}

/** Sum of item quantities ONLY when every item's qty was read. */
function summedTotal(items: ExtractedLineItem[]): FieldRead<number> | null {
  if (items.length === 0) return null;
  if (items.some((i) => i.qty.value == null)) return null;
  return {
    value: items.reduce((s, i) => s + (i.qty.value ?? 0), 0),
    confidence: Math.min(...items.map((i) => i.qty.confidence)),
  };
}

function resolveTotal(
  printed: FieldRead<number>,
  items: ExtractedLineItem[],
): { total: FieldRead<number>; source: 'printed' | 'summed' } {
  if (printed.value != null) return { total: printed, source: 'printed' };
  const summed = summedTotal(items);
  if (summed) return { total: summed, source: 'summed' };
  return { total: printed, source: 'printed' };
}

// ─── Detail builders (one per capture type) ─────────────────────────────

function buildDetail(type: CaptureType, raw: RawExtraction): CaptureExtractionDetail {
  switch (type) {
    case 'depot': {
      const items = readItems(raw, 'items');
      const { total, source } = resolveTotal(readCount(raw, 'piecesLoaded'), items);
      return {
        kind: 'depot',
        depotName: readText(raw, 'depotName'),
        date: readDate(raw, 'date'),
        items,
        piecesLoaded: total,
        totalSource: source,
      };
    }
    case 'receipt': {
      const items = readItems(raw, 'items');
      const { total, source } = resolveTotal(readCount(raw, 'totalPieces'), items);
      return {
        kind: 'receipt',
        storeName: readText(raw, 'storeName'),
        storeNumber: readText(raw, 'storeNumber'),
        date: readDate(raw, 'date'),
        items,
        totalPieces: total,
        totalSource: source,
        totalAmount: readMoney(raw, 'totalAmount'),
      };
    }
    case 'stales': {
      const items = readItems(raw, 'items');
      const { total, source } = resolveTotal(readCount(raw, 'totalStalePieces'), items);
      return {
        kind: 'stales',
        storeName: readText(raw, 'storeName'),
        storeNumber: readText(raw, 'storeNumber'),
        date: readDate(raw, 'date'),
        items,
        totalStalePieces: total,
        totalSource: source,
      };
    }
    case 'shelf':
      return {
        kind: 'shelf',
        productsPresent: readTextList(raw, 'productsPresent'),
        emptySlots: readTextList(raw, 'emptySlots'),
        outOfStock: readTextList(raw, 'outOfStock'),
        notes: readText(raw, 'notes'),
      };
    case 'inventory': {
      const counts = readItems(raw, 'counts');
      const { total, source } = resolveTotal(readCount(raw, 'totalPieces'), counts);
      return {
        kind: 'inventory',
        date: readDate(raw, 'date'),
        counts,
        totalPieces: total,
        totalSource: source,
      };
    }
    case 'transfer': {
      const items = readItems(raw, 'items');
      const { total, source } = resolveTotal(readCount(raw, 'totalPieces'), items);
      return {
        kind: 'transfer',
        fromLabel: readText(raw, 'fromLabel'),
        toLabel: readText(raw, 'toLabel'),
        items,
        totalPieces: total,
        totalSource: source,
        direction: readDirection(raw, 'direction'),
      };
    }
    case 'voice':
      return {
        kind: 'voice',
        transcript: readText(raw, 'transcript'),
        isOutlookNote: readBool(raw, 'isOutlookNote'),
      };
    case 'other': {
      const nums = rawField(raw, 'numbers');
      const numbers: Array<{ label: FieldRead<string>; value: FieldRead<number> }> = [];
      if (nums && Array.isArray(nums.value)) {
        for (const n of nums.value as Array<Record<string, unknown>>) {
          if (!n || typeof n !== 'object') continue;
          const conf = clampConf(n.confidence);
          const label = typeof n.label === 'string' ? n.label.trim() : '';
          numbers.push({
            label: { value: label && conf >= CONFIDENCE_MIN ? label : null, confidence: conf },
            value: {
              value:
                typeof n.value === 'number' && Number.isFinite(n.value) && conf >= CONFIDENCE_MIN
                  ? (n.value as number)
                  : null,
              confidence: conf,
            },
          });
        }
      }
      return { kind: 'other', summary: readText(raw, 'summary'), numbers };
    }
  }
}

/** The key read(s) per type: [driver-facing label, was it read?, confidence]. */
function keyReads(detail: CaptureExtractionDetail): Array<{ label: string; read: boolean; confidence: number }> {
  switch (detail.kind) {
    case 'depot':
      return [{ label: 'the pieces loaded', read: detail.piecesLoaded.value != null, confidence: detail.piecesLoaded.confidence }];
    case 'receipt':
      return [{ label: 'the total pieces', read: detail.totalPieces.value != null, confidence: detail.totalPieces.confidence }];
    case 'stales':
      return [{ label: 'the total stales', read: detail.totalStalePieces.value != null, confidence: detail.totalStalePieces.confidence }];
    case 'shelf':
      return [{ label: 'the shelf contents', read: detail.productsPresent.value != null, confidence: detail.productsPresent.confidence }];
    case 'inventory':
      return [{ label: 'the pieces left', read: detail.totalPieces.value != null, confidence: detail.totalPieces.confidence }];
    case 'transfer':
      return [{ label: 'the transfer pieces', read: detail.totalPieces.value != null, confidence: detail.totalPieces.confidence }];
    case 'voice':
      return [{ label: 'the voice note', read: !!detail.transcript.value, confidence: detail.transcript.confidence }];
    case 'other':
      return [{ label: 'what the photo shows', read: detail.summary.value != null, confidence: detail.summary.confidence }];
  }
}

const RETAKE = 'Retake it in better light, or report by voice.';
const ILLEGIBLE_NOTE: Record<CaptureType, string> = {
  depot: `This depot photo could not be read. ${RETAKE}`,
  stales: `This stales ticket could not be read. ${RETAKE}`,
  shelf: `This shelf photo could not be read. ${RETAKE}`,
  receipt: `This sales ticket could not be read. ${RETAKE}`,
  inventory: `This truck photo could not be read. ${RETAKE}`,
  transfer: `This transfer note could not be read. ${RETAKE}`,
  voice: 'This voice note could not be heard clearly. Record it again somewhere quieter.',
  other: `This photo could not be read. ${RETAKE}`,
};

/** The flat CaptureExtracted the EOD derivation consumes. */
function toFlat(detail: CaptureExtractionDetail): CaptureExtracted {
  switch (detail.kind) {
    case 'receipt':
      return { storeName: detail.storeName.value, receiptPieces: detail.totalPieces.value };
    case 'stales':
      return { storeName: detail.storeName.value, stalesPulled: detail.totalStalePieces.value };
    case 'inventory':
      return { pieces: detail.totalPieces.value };
    case 'transfer':
      return { transferPieces: detail.totalPieces.value, transferDirection: detail.direction.value };
    case 'voice':
      return { transcript: detail.transcript.value };
    case 'depot':
    case 'shelf':
    case 'other':
      // No flat field exists for these kinds in the client shape: the
      // depot read lives in the detail (piecesLoaded), shelf is
      // qualitative, and 'other' is a free-form record. Nothing is
      // forced into a field it does not belong in.
      return {};
  }
}

/**
 * The gate: RawExtraction -> ReaderWriteBack (without the Firestore
 * outcome wrapper — reader.ts adds outcome/error handling).
 */
export function buildExtraction(
  type: CaptureType,
  raw: RawExtraction,
  reader: ReaderInfo,
  readAt: string,
): Pick<ReaderWriteBack, 'extracted' | 'extraction' | 'attentionNote'> & { ok: boolean } {
  if (!raw || raw.legible !== true) {
    return { ok: false, extracted: null, extraction: null, attentionNote: ILLEGIBLE_NOTE[type] };
  }
  const detail = buildDetail(type, raw);
  const keys = keyReads(detail);
  const missing = keys.filter((k) => !k.read);
  if (missing.length > 0) {
    return {
      ok: false,
      extracted: null,
      extraction: null,
      attentionNote: `Could not read ${missing.map((k) => k.label).join(' and ')} on this one. ${RETAKE}`,
    };
  }
  const overallConfidence = Math.min(...keys.map((k) => k.confidence));
  const extraction: CaptureExtraction = { detail, reader, readAt, overallConfidence };
  return { ok: true, extracted: toFlat(detail), extraction, attentionNote: null };
}

/**
 * Field guide the vision prompt is built from (providers.ts). One entry
 * per capture type: the fields the model must return, each as
 * {"value": ..., "confidence": 0..1} or null when not readable.
 */
export const READER_FIELD_GUIDE: Record<CaptureType, string> = {
  depot:
    'depotName (depot name/location as written), date (as written), items (line items: product, qty), piecesLoaded (TOTAL pieces loaded).',
  receipt:
    'storeName, storeNumber, date (as written), items (line items: product, qty, amount when printed), totalPieces (TOTAL pieces), totalAmount (TOTAL dollar amount when printed).',
  stales:
    'storeName, storeNumber, date (as written), items (line items: product, qty), totalStalePieces (TOTAL stales).',
  shelf:
    'productsPresent (array of product names visibly on the shelf), emptySlots (array describing visible gaps/empty slots), outOfStock (array of products identifiable as out of stock), notes (anything else notable). NO counts — shelf photos are qualitative.',
  inventory:
    'date (as written), counts (line items: product, qty counted), totalPieces (TOTAL pieces when written).',
  transfer:
    'fromLabel (route/store the product came from, as written), toLabel (route/store it went to, as written), items (line items: product, qty), totalPieces (TOTAL pieces), direction ("in" or "out" relative to this route, only when the paperwork states it).',
  voice:
    'transcript (the exact words spoken), isOutlookNote (true when the note is about tomorrow, promos, or flags for the next day).',
  other:
    'summary (one sentence: what this photo shows), numbers (array of {label, value} for any numbers clearly written).',
};
