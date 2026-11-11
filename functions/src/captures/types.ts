/**
 * Capture-extraction reader — shared types (2026-11-10).
 *
 * The driver app writes a capture doc as 'pending' (see
 * driver-app/src/services/captureService.ts). The reader in this folder
 * turns a pending capture into either:
 *   - 'extracted' — structured values read from the photo/audio, each
 *     carrying a confidence, with the source file kept as provenance, or
 *   - 'needs_attention' — the source could not be read; NO value is
 *     guessed, and the driver is told to retake or report by voice.
 *
 * Two payloads land on the capture doc:
 *   - `extracted`  — the flat CaptureExtracted shape the client types
 *     already define (driver-app/src/types.ts) and the EOD derivation
 *     consumes. Only the fields that derivation/other readers use.
 *   - `extraction` — the full per-type read (CaptureExtraction): every
 *     field the reader saw, each as a FieldRead with its confidence,
 *     plus reader identity — the audit trail behind the flat values.
 *
 * Honesty rules, binding (same as the EOD derivation's):
 *   - A FieldRead's value is non-null ONLY when it was actually read at
 *     or above the confidence floor (schemas.ts). Unreadable = null.
 *   - Totals are the printed total when read; otherwise the sum of the
 *     item quantities that were ALL read (marked totalSource 'summed').
 *     A partial sum is never presented as a total.
 */

export type CaptureType =
  | 'depot'
  | 'stales'
  | 'shelf'
  | 'receipt'
  | 'inventory'
  | 'transfer'
  | 'voice'
  | 'other';

export type CaptureStatus = 'pending' | 'extracted' | 'confirmed' | 'needs_attention';

/** Mirror of the client-side capture doc (driver-app/src/types.ts). */
export interface CaptureDoc {
  id?: string;
  type: CaptureType;
  date: string; // yyyy-mm-dd the capture belongs to
  storagePath: string;
  downloadUrl?: string | null;
  storeId?: string | null;
  storeName?: string | null;
  status: CaptureStatus;
  extracted?: CaptureExtracted | null;
  attentionNote?: string | null;
  driverId: string;
  driverName: string;
}

/**
 * Mirror of the client's flat CaptureExtracted — the ONLY shape the EOD
 * derivation reads. A field is present only when actually read.
 */
export interface CaptureExtracted {
  storeId?: string | null;
  storeName?: string | null;
  pieces?: number | null;
  stalesPulled?: number | null;
  transferPieces?: number | null;
  transferDirection?: 'in' | 'out' | null;
  receiptPieces?: number | null;
  transcript?: string | null;
}

/** One read value: the value (null = not read) + the reader's confidence 0..1. */
export interface FieldRead<T> {
  value: T | null;
  confidence: number;
}

export interface ExtractedLineItem {
  product: FieldRead<string>;
  qty: FieldRead<number>;
  /** Line amount where the document prints one (receipts may). */
  amount?: FieldRead<number>;
}

export interface DepotExtraction {
  kind: 'depot';
  depotName: FieldRead<string>;
  date: FieldRead<string>;
  items: ExtractedLineItem[];
  /** Pieces loaded at the depot, read from the load photo/paperwork. */
  piecesLoaded: FieldRead<number>;
  totalSource: 'printed' | 'summed';
}

export interface ReceiptExtraction {
  kind: 'receipt';
  storeName: FieldRead<string>;
  storeNumber: FieldRead<string>;
  date: FieldRead<string>;
  items: ExtractedLineItem[];
  totalPieces: FieldRead<number>;
  totalSource: 'printed' | 'summed';
  totalAmount: FieldRead<number>;
}

export interface StalesExtraction {
  kind: 'stales';
  storeName: FieldRead<string>;
  storeNumber: FieldRead<string>;
  date: FieldRead<string>;
  items: ExtractedLineItem[];
  totalStalePieces: FieldRead<number>;
  totalSource: 'printed' | 'summed';
}

export interface ShelfExtraction {
  kind: 'shelf';
  /** Qualitative only — products visibly present on the shelf. */
  productsPresent: FieldRead<string[]>;
  /** Visible gaps / empty slots, described as read ("top shelf, right side"). */
  emptySlots: FieldRead<string[]>;
  /** Products the reader could identify as out of stock. */
  outOfStock: FieldRead<string[]>;
  notes: FieldRead<string>;
}

export interface InventoryExtraction {
  kind: 'inventory';
  date: FieldRead<string>;
  counts: ExtractedLineItem[];
  totalPieces: FieldRead<number>;
  totalSource: 'printed' | 'summed';
}

export interface TransferExtraction {
  kind: 'transfer';
  /** Route or store the product came FROM, as written on the paperwork. */
  fromLabel: FieldRead<string>;
  /** Route or store the product went TO, as written on the paperwork. */
  toLabel: FieldRead<string>;
  items: ExtractedLineItem[];
  totalPieces: FieldRead<number>;
  totalSource: 'printed' | 'summed';
  /** Direction relative to THIS route when the paperwork states it. */
  direction: FieldRead<'in' | 'out'>;
}

export interface VoiceExtraction {
  kind: 'voice';
  transcript: FieldRead<string>;
  /** True when the note is about tomorrow / flags (the EOD outlook). */
  isOutlookNote: FieldRead<boolean>;
}

export interface OtherExtraction {
  kind: 'other';
  summary: FieldRead<string>;
  numbers: Array<{ label: FieldRead<string>; value: FieldRead<number> }>;
}

export type CaptureExtractionDetail =
  | DepotExtraction
  | ReceiptExtraction
  | StalesExtraction
  | ShelfExtraction
  | InventoryExtraction
  | TransferExtraction
  | VoiceExtraction
  | OtherExtraction;

export interface ReaderInfo {
  name: string;
  version: string;
  model?: string;
}

/** The full read, stored on the capture doc as `extraction`. */
export interface CaptureExtraction {
  detail: CaptureExtractionDetail;
  reader: ReaderInfo;
  /** ISO timestamp of the read. */
  readAt: string;
  /** Conservative overall confidence: the minimum across the key fields. */
  overallConfidence: number;
}

/**
 * What a provider (vision model / reference reader) returns: UNTRUSTED.
 * schemas.ts validates and coerces this into the typed payloads above;
 * nothing here reaches Firestore without passing through that gate.
 * `fields` maps a schema field name to a read (value + confidence) or
 * null when the provider could not read it at all.
 */
export interface RawField {
  value: unknown;
  confidence: number;
}

export interface RawExtraction {
  /** False when the source cannot be read at all (blur, glare, wrong doc). */
  legible: boolean;
  fields: Record<string, RawField | null>;
  /** Provider's own words on why it could not read (kept for logs only). */
  note?: string | null;
}

/**
 * The pipeline result (reader.ts). `toDocUpdate()` in reader.ts turns an
 * 'extracted' / 'needs_attention' result into the Firestore field map the
 * wrapper writes. An 'error' outcome writes NOTHING to the value fields —
 * the capture stays 'pending' and the wrapper stamps the attempt so the
 * read can be retried (a reader outage must never mark a good photo
 * 'needs_attention').
 */
export interface ReaderWriteBack {
  outcome: 'extracted' | 'needs_attention' | 'error' | 'skipped';
  extracted?: CaptureExtracted | null;
  extraction?: CaptureExtraction | null;
  attentionNote?: string | null;
  error?: string;
}
