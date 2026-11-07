import React, { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../contexts/AuthContext';

/**
 * Flowers IDP settlement upload (owner-only).
 *
 * Flow (Plan C, 2026-11-07): each selected PDF is read in the browser
 * and sent as base64 to the owner-only `ingestSettlementPdf` callable,
 * which persists the raw file server-side (Admin SDK) and runs
 * extract -> parse -> reconcile -> settlement/shrink/margin record +
 * ingestion registry entry. There is NO client Storage write: the
 * bucket's client rules deny it (storage/unauthorized, verified live)
 * and the deploy credential cannot publish replacement rules — Plan B's
 * uploadBytes + reprocessSettlement path died on exactly that. The
 * per-file result below is the callable's actual return — validated,
 * queued for review, or failed — never just "upload received".
 * Anything that doesn't reconcile is queued for review server-side; it
 * never silently disappears. EVERY loop path (success, callable error,
 * read error, oversize, non-PDF) publishes its outcome before moving
 * on — a counted file with no rendered row is the bug this component
 * already shipped once (audit 2026-11-07); do not reintroduce it.
 */

/** Mirrors IngestResult in functions/src/settlements/ingest.ts. */
interface ProcessResult {
  ok: boolean;
  docType?: string;
  routeNumber?: string;
  weekEnding?: string;
  status?: string;
  totalCharged?: number;
  exception?: string;
  /** Set when the function persisted the raw PDF to Storage. */
  storedPath?: string;
}

/** Mirrors MAX_SETTLEMENT_PDF_BYTES in functions/src/settlements/ingest.ts. */
const MAX_PDF_BYTES = 7 * 1024 * 1024;

/** Base64-encode an ArrayBuffer in chunks (avoids call-stack limits
 *  from spreading a whole file into String.fromCharCode at once). */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

type OutcomeState = 'validated' | 'review' | 'failed' | 'skipped';

interface FileOutcome {
  fileName: string;
  state: OutcomeState;
  detail: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  flowers_master_statement: 'Master statement',
  flowers_distributor_statement: 'Route statement',
  flowers_margin_detail: 'Margin detail',
  flowers_sbt_shrink: 'SBT shrink report',
};

const formatMoney = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const SettlementUploader: React.FC = () => {
  const { userProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'warning' | 'error'>('success');
  const [outcomes, setOutcomes] = useState<FileOutcome[]>([]);
  // Temporary diagnostics (2026-11-07): the "Connection test" button
  // calls diagPing from the ISOLATED diag codebase (functions2/ — no
  // settlements imports, no providers, no shared module scope with the
  // main functions codebase) and renders its result verbatim. Every
  // main-codebase callable, even featherweight ones sharing only
  // functions/src/index.ts, fails with a bare functions/internal:
  // diag OK points at that shared module scope; diag ALSO failing
  // points at the platform. Remove once the pipeline is verified live.
  const [pingBusy, setPingBusy] = useState(false);
  const [pingResult, setPingResult] = useState('');

  const handleConnectionTest = async () => {
    setPingBusy(true);
    setPingResult('');
    try {
      const ping = httpsCallable<Record<string, unknown>, { ok: boolean; ts: string; codebase?: string }>(
        getFunctions(),
        'diagPing'
      );
      const { data } = await ping({});
      setPingResult(`Connection test OK — diag backend answered: diagPing returned ok=${data.ok} (codebase=${data.codebase ?? 'diag'}) at ${data.ts}`);
    } catch (error: any) {
      console.error('Connection test error:', error);
      // Exact code + message, verbatim under the button — the code is
      // what separates "function ran and refused" from "never ran".
      const code = error?.code ? `${error.code}: ` : '';
      setPingResult(`Connection test failed: ${code}${error?.message || 'unknown error'}`);
    }
    setPingBusy(false);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = event.target.files ? Array.from(event.target.files) : [];
    if (!files.length || !userProfile?.businessId) return;

    // No businessId is sent: the function derives it from the caller's
    // users/{uid} record server-side.
    setBusy(true);
    setMessage('');
    setOutcomes([]);

    const ingestPdf = httpsCallable<
      { filename: string; contentBase64: string },
      ProcessResult
    >(getFunctions(), 'ingestSettlementPdf');

    const results: FileOutcome[] = [];
    for (const file of files) {
      if (!/\.pdf$/i.test(file.name)) {
        results.push({ fileName: file.name, state: 'skipped', detail: 'Not a PDF — skipped.' });
        // Publish before continuing: the setOutcomes at the bottom of
        // the loop is the only other one, and `continue` skips it —
        // without this the summary counts the file but no row renders
        // (audit 2026-11-07: the "counts a failure, lists nothing" bug).
        setOutcomes([...results]);
        continue;
      }
      if (file.size > MAX_PDF_BYTES) {
        results.push({
          fileName: file.name,
          state: 'failed',
          detail: `File too large: ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit is 7 MB.`,
        });
        setOutcomes([...results]);
        continue;
      }
      let contentBase64: string;
      try {
        contentBase64 = arrayBufferToBase64(await file.arrayBuffer());
      } catch (error: any) {
        console.error('Settlement file read error:', error);
        results.push({
          fileName: file.name,
          state: 'failed',
          detail: `Couldn't read the file: ${error?.message || 'unknown error'}`,
        });
        setOutcomes([...results]);
        continue;
      }
      try {
        const { data } = await ingestPdf({ filename: file.name, contentBase64 });
        const label = (data.docType && DOC_TYPE_LABELS[data.docType]) || 'Settlement document';
        const where = [
          data.routeNumber ? `Route ${data.routeNumber}` : null,
          data.weekEnding ? `week ending ${data.weekEnding}` : null,
          data.totalCharged != null ? `${formatMoney(data.totalCharged)} charged` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        if (data.status === 'validated') {
          results.push({
            fileName: file.name,
            state: 'validated',
            detail: `${label} validated${where ? ` — ${where}` : ''}.`,
          });
        } else if (data.status === 'needs_review') {
          results.push({
            fileName: file.name,
            state: 'review',
            detail:
              `${label} saved but flagged for review${where ? ` — ${where}` : ''}.` +
              (data.exception ? ` ${data.exception}` : ''),
          });
        } else if (data.ok === false || data.exception) {
          results.push({
            fileName: file.name,
            state: 'failed',
            detail: `Processing failed${data.exception ? `: ${data.exception}` : '.'}`,
          });
        } else {
          // Parsed but neither validated nor flagged (defensive: the
          // backend's terminal states are validated / needs_review).
          results.push({
            fileName: file.name,
            state: 'review',
            detail: `${label} processed (status: ${data.status || 'unknown'})${where ? ` — ${where}` : ''}.`,
          });
        }
      } catch (error: any) {
        console.error('Settlement processing error:', error);
        // Show the callable's ACTUAL error: the Firebase error code
        // (e.g. functions/internal, functions/permission-denied,
        // functions/unauthenticated) plus its message. The code is what
        // separates "the function ran and failed" from "the call never
        // reached the function" — message alone collapses both to a
        // bare word like 'internal' (diagnosis 2026-11-07).
        const code = error?.code ? `${error.code}: ` : '';
        results.push({
          fileName: file.name,
          state: 'failed',
          detail: `Processing couldn't run: ${code}${error?.message || 'unknown error'}`,
        });
      }
      // Show results as they land, not only at the end of the batch.
      setOutcomes([...results]);
    }

    const validated = results.filter((r) => r.state === 'validated').length;
    const review = results.filter((r) => r.state === 'review').length;
    const failed = results.filter((r) => r.state === 'failed').length;
    const processed = validated + review;
    if (processed === 0 && failed === 0) {
      setMessage('No PDF files were selected — settlement uploads must be PDFs.');
      setMessageType('error');
    } else if (failed === 0 && review === 0) {
      setMessage(
        `${validated} PDF${validated === 1 ? '' : 's'} uploaded, parsed, and validated — ` +
          'the records are in each route\u2019s settlement history.'
      );
      setMessageType('success');
    } else if (failed === 0) {
      setMessage(
        `${validated} validated, ${review} queued for review. ` +
          'Review items are saved and flagged — they never disappear.'
      );
      setMessageType('warning');
    } else {
      setMessage(
        `${validated} validated, ${review} for review, ${failed} failed. ` +
          'Failed files are listed below with the reason.'
      );
      setMessageType(processed > 0 ? 'warning' : 'error');
    }

    setBusy(false);
    // Clear the input so the same files can be uploaded again
    event.target.value = '';
  };

  if (userProfile?.role !== 'business_owner') {
    return null; // Only business owners can upload settlements
  }

  const outcomeStyle = (state: OutcomeState) =>
    state === 'validated'
      ? { icon: 'fa-check-circle', text: 'text-green-600' }
      : state === 'review'
        ? { icon: 'fa-exclamation-triangle', text: 'text-amber-500' }
        : state === 'failed'
          ? { icon: 'fa-times-circle', text: 'text-red-500' }
          : { icon: 'fa-minus-circle', text: 'text-gray-400' };

  return (
    <div className="bg-white p-6 rounded-3xl border-2 border-gray-100 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-black rounded-2xl flex items-center justify-center text-[#FFD700]">
          <i className="fas fa-file-invoice-dollar text-lg"></i>
        </div>
        <div>
          <h3 className="font-black text-sm uppercase tracking-tight">Flowers Settlements</h3>
          <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mt-0.5">
            Upload IDP statement PDFs — parsed &amp; reconciled on upload
          </p>
        </div>
      </div>

      <label className="block w-full cursor-pointer group">
        <div className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all ${
          busy
            ? 'border-gray-200 bg-gray-50'
            : 'border-gray-300 hover:border-[#FFD700] hover:bg-gray-50'
        }`}>
          <input
            type="file"
            accept=".pdf"
            multiple
            onChange={handleFileUpload}
            disabled={busy}
            className="hidden"
          />
          <div className="flex flex-col items-center gap-2">
            <i className={`fas fa-cloud-upload-alt text-2xl ${
              busy ? 'text-gray-300' : 'text-gray-400 group-hover:text-[#FFD700]'
            } transition-colors`}></i>
            <div>
              <p className="text-xs font-black text-gray-700 uppercase tracking-tight">
                {busy ? 'Processing...' : 'Click to Upload PDFs'}
              </p>
              <p className="text-[9px] text-gray-400 font-bold mt-1">
                Master &amp; route statements, margin detail, shrink reports
              </p>
            </div>
          </div>
        </div>
      </label>

      <div className="mt-4 pt-3 border-t border-gray-100">
        <button
          type="button"
          onClick={handleConnectionTest}
          disabled={pingBusy}
          className="text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:text-gray-600 disabled:opacity-50 underline underline-offset-2"
        >
          {pingBusy ? 'Testing connection…' : 'Connection test'}
        </button>
        {pingResult && (
          <p className="text-[11px] font-bold text-gray-500 mt-2 break-words">{pingResult}</p>
        )}
      </div>

      {busy && (
        <div className="mt-4 flex items-center gap-3 p-3 bg-gray-50 rounded-2xl">
          <i className="fas fa-spinner fa-spin text-[#FFD700]"></i>
          <div>
            <p className="text-xs font-black uppercase tracking-tight text-gray-700">Uploading &amp; processing...</p>
            <p className="text-[9px] text-gray-400 font-bold">Each PDF is parsed and reconciled as soon as it uploads</p>
          </div>
        </div>
      )}

      {outcomes.length > 0 && (
        <div className="mt-4 space-y-2">
          {outcomes.map((o, i) => {
            const s = outcomeStyle(o.state);
            return (
              <div key={`${o.fileName}-${i}`} className="flex items-start gap-2 p-3 bg-gray-50 rounded-2xl">
                <i className={`fas ${s.icon} ${s.text} text-sm mt-0.5`}></i>
                <div className="min-w-0">
                  <p className="text-xs font-black text-gray-700 truncate">{o.fileName}</p>
                  <p className="text-[11px] font-bold text-gray-500">{o.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {message && !busy && (
        <div className={`mt-4 p-4 rounded-2xl ${
          messageType === 'success'
            ? 'bg-green-50 border-2 border-green-200'
            : messageType === 'warning'
              ? 'bg-amber-50 border-2 border-amber-200'
              : 'bg-red-50 border-2 border-red-200'
        }`}>
          <div className="flex items-start gap-2">
            <i className={`fas ${
              messageType === 'success'
                ? 'fa-check-circle text-green-600'
                : messageType === 'warning'
                  ? 'fa-exclamation-triangle text-amber-500'
                  : 'fa-exclamation-circle text-red-600'
            } text-sm mt-0.5`}></i>
            <p className={`text-xs font-bold ${
              messageType === 'success'
                ? 'text-green-700'
                : messageType === 'warning'
                  ? 'text-amber-700'
                  : 'text-red-700'
            }`}>
              {message}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
