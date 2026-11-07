import React, { useState } from 'react';
import { ref, uploadBytes } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../contexts/AuthContext';
import { storage } from '../services/firebaseConfig';

/**
 * Flowers IDP settlement upload (owner-only).
 *
 * Flow (Plan B, 2026-11-07): each selected PDF is uploaded to
 *   businesses/{bid}/settlement-uploads/{fileName}
 * and this component then immediately invokes the owner-only
 * `reprocessSettlement` callable, which downloads the file server-side
 * and runs extract -> parse -> reconcile -> settlement/shrink/margin
 * record + ingestion registry entry. The per-file result below is the
 * callable's actual return — validated, queued for review, or failed —
 * never just "upload received". (The hands-free Storage trigger variant
 * exists in the backend but is not deployed: its deploy fails on a
 * bucket-region lookup — see functions/src/settlements/ingest.ts.)
 * Anything that doesn't reconcile is queued for review server-side; it
 * never silently disappears.
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

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = event.target.files ? Array.from(event.target.files) : [];
    if (!files.length || !userProfile?.businessId) return;

    const businessId = userProfile.businessId;
    setBusy(true);
    setMessage('');
    setOutcomes([]);

    const processSettlement = httpsCallable<{ storagePath: string }, ProcessResult>(
      getFunctions(),
      'reprocessSettlement'
    );

    const results: FileOutcome[] = [];
    for (const file of files) {
      if (!/\.pdf$/i.test(file.name)) {
        results.push({ fileName: file.name, state: 'skipped', detail: 'Not a PDF — skipped.' });
        continue;
      }
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `businesses/${businessId}/settlement-uploads/${safeName}`;
      try {
        await uploadBytes(ref(storage, storagePath), file);
      } catch (error) {
        console.error('Settlement upload error:', error);
        results.push({ fileName: file.name, state: 'failed', detail: 'Upload failed — check your connection and try again.' });
        continue;
      }
      try {
        const { data } = await processSettlement({ storagePath });
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
        results.push({
          fileName: file.name,
          state: 'failed',
          detail:
            `Uploaded, but processing couldn't run: ${error?.message || 'unknown error'} ` +
            'The file is stored and can be reprocessed later.',
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
