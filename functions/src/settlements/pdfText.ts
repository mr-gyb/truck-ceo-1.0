/**
 * In-function PDF text extraction for Flowers IDP documents.
 *
 * The parsers in ./flowersIdp.ts consume LAYOUT-PRESERVING text — the
 * shape `pdftotext -layout` produces: one string per visual row, tokens
 * separated by space runs that reflect their printed columns, pages
 * separated by form feeds. This module reproduces that shape from a PDF
 * buffer with pdfjs-dist, so no external binary is needed at runtime.
 *
 * Reconstruction rules (calibrated against `pdftotext -layout` output on
 * the 33 verified IDP fixtures — see functions/test/run-acceptance-adapter.ts,
 * which must report the same totals as the pdftotext harness):
 *  - Rows: items cluster onto one visual row when their baselines differ
 *    by <= 0.6 x the smaller font height (pdftotext merged a 2.6pt gap at
 *    4.5pt type, split a 2.8pt gap), and never when their x-ranges would
 *    overlap on the row.
 *  - Columns: character column = round((x - pageMinX) / charWidth), where
 *    charWidth is the page's median per-character width of real text runs.
 *    The banner rows the margin-detail parser anchors on (>= 20 leading
 *    spaces) land at ~40 columns under this model.
 *  - Whitespace-only text runs the report generator emits are spacing,
 *    not content: columns regenerate the gaps, so the runs are dropped.
 */

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

interface RawItem {
  str: string;
  x: number;
  y: number; // baseline, PDF points (origin bottom-left)
  w: number;
  h: number; // font size
  endX: number;
}

const ROW_TOLERANCE_RATIO = 0.6;
const ROW_TOLERANCE_MIN = 2.0;
const OVERLAP_SLACK = 1.0; // pt of x-overlap tolerated on one row
const JOIN_GAP = 1.2; // pt: at/below this, runs are one token (no space)

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Rebuild one page's layout text from pdfjs text items. */
export function layoutPageText(items: Array<{
  str: string;
  transform: number[];
  width: number;
  height: number;
}>): string {
  const raw: RawItem[] = [];
  for (const it of items) {
    if (typeof it.str !== 'string' || it.str === '') continue;
    if (it.str.trim() === '') continue; // generator spacing runs
    const x = it.transform[4];
    raw.push({ str: it.str, x, y: it.transform[5], w: it.width, h: it.height || 0, endX: x + it.width });
  }
  if (!raw.length) return '';

  const minX = Math.min(...raw.map((r) => r.x));
  const charSamples: number[] = [];
  for (const r of raw) {
    // Letters only: tabular digits in this report font run ~30% wider
    // per char than letters, and digit runs dominate these documents —
    // including them inflates the grid and compresses every column.
    if (r.str.length >= 3 && r.w > 0 && /[A-Za-z]/.test(r.str) && !/^\d+$/.test(r.str.replace(/[.,-]/g, ''))) {
      const per = r.w / r.str.length;
      if (per >= 0.8 && per <= 10) charSamples.push(per);
    }
  }
  const charW = median(charSamples) || 2.3;

  // Cluster into visual rows: sort by baseline (top first), then greedily
  // attach each item to the open row when the baseline gap is within
  // tolerance and the item does not overlap anything already on the row.
  const byY = [...raw].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  interface Row { y: number; h: number; items: RawItem[] }
  const rows: Row[] = [];
  for (const it of byY) {
    const row = rows[rows.length - 1];
    if (row) {
      const tol = Math.max(ROW_TOLERANCE_MIN, ROW_TOLERANCE_RATIO * Math.min(row.h || it.h, it.h || row.h));
      const overlaps = row.items.some((o) => it.x < o.endX - OVERLAP_SLACK && o.x < it.endX - OVERLAP_SLACK);
      if (Math.abs(it.y - row.y) <= tol && !overlaps) {
        row.items.push(it);
        continue;
      }
    }
    rows.push({ y: it.y, h: it.h, items: [it] });
  }

  const lines: string[] = [];
  for (const row of rows) {
    const sorted = row.items.sort((a, b) => a.x - b.x);
    let out = '';
    let prevEndX = Number.NEGATIVE_INFINITY;
    for (const it of sorted) {
      const col = Math.max(0, Math.round((it.x - minX) / charW));
      // Word-boundary rule: two distinct text runs that both end/start
      // with a word character are two tokens, never one — the generator's
      // own space runs were dropped, and a run's measured width can
      // overshoot into the gap ('Route : 13445' + 'ADDL HHC...' must not
      // become '13445ADDL'). Punctuation-led continuations ('.02-') still
      // join with no space.
      const boundary = out.length > 0
        && /[A-Za-z0-9]$/.test(out)
        && /^[A-Za-z0-9]/.test(it.str);
      if (col < out.length) {
        if (boundary || it.x - prevEndX > JOIN_GAP) out += ' ';
        out += it.str;
      } else {
        let pad = col - out.length;
        if (boundary && pad === 0) pad = 1;
        out += ' '.repeat(pad) + it.str;
      }
      prevEndX = Math.max(prevEndX, it.endX);
    }
    lines.push(out.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}

/**
 * Extract layout-preserving text from a PDF buffer (or file bytes).
 * Pages are separated by '\f\n', mirroring pdftotext's form feeds.
 */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  const task = pdfjsLib.getDocument({
    data,
    verbosity: 0,
    isEvalSupported: false,
    useSystemFonts: false,
  });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      pages.push(layoutPageText(tc.items as Array<{ str: string; transform: number[]; width: number; height: number }>));
      page.cleanup();
    }
    return pages.join('\f\n');
  } finally {
    await doc.destroy();
  }
}
