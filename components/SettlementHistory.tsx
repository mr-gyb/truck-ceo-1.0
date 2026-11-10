import React, { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../services/firebaseConfig';
import { useAuth } from '../contexts/AuthContext';

/**
 * Read-only mirror of the fields this view displays from the settlement
 * record the backend parser writes at
 *   businesses/{bid}/routes/{rid}/settlements/{weekEnding}
 * Source of truth: SettlementRecord in functions/src/settlements/types.ts.
 * Only the displayed fields are mirrored (same pattern as
 * SettlementUploader's local mirror of IngestResult). Every field is
 * optional here because Firestore reads are untyped and the ingest
 * sanitizer stores missing values as null — the render guards each one.
 */
interface SettlementRecordView {
  kind?: 'route' | 'master' | null;
  routeNumber?: string | null;
  week?: number | null;
  weekEnding?: string | null;
  accountability?: {
    totalProductCharged?: number | null;
  } | null;
  computed?: {
    productCharged?: number | null;
    stalesAmount?: number | null;
    /** Percentage points (13.71 means 13.71%) — flowersIdp.ts computes
     *  stalesAmount / charged * 100, rounded to 2 decimals. */
    stalesPct?: number | null;
    margin?: number | null;
  } | null;
  validation?: {
    status?: string | null;
  } | null;
  storeRows?: unknown[] | null;
  sources?: Array<{ ingestedAt?: string | null }> | null;
}

interface SettlementRow extends SettlementRecordView {
  id: string; // the doc id == weekEnding (ISO yyyy-mm-dd)
}

// Same money format as SettlementUploader.tsx.
const formatMoney = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** weekEnding is an ISO date (yyyy-mm-dd); anchor at noon so the local
 *  timezone can never shift the displayed day. */
const fmtWeekEnding = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

const fmtIngested = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

const statusChip = (status?: string | null): { label: string; classes: string } => {
  switch (status) {
    case 'validated':
      return { label: 'Validated', classes: 'bg-green-100 text-green-700' };
    case 'needs_review':
      return { label: 'Needs review', classes: 'bg-amber-100 text-amber-700' };
    case 'parsed':
      return { label: 'Parsed', classes: 'bg-gray-200 text-gray-600' };
    default:
      return { label: status || 'Received', classes: 'bg-gray-200 text-gray-600' };
  }
};

/**
 * Settlement history for one route (Routes & Stores expanded view).
 * Read-only: records are written by the backend ingest pipeline
 * (Data Hub > Data Import uploads); firestore.rules already allow any
 * member of the business to read routes/{rid}/settlements.
 */
export const SettlementHistory: React.FC<{ routeId: string }> = ({ routeId }) => {
  const { userProfile } = useAuth();
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const businessId = userProfile?.businessId;

  const fetchSettlements = async () => {
    if (!businessId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const snap = await getDocs(
        collection(db, `businesses/${businessId}/routes/${routeId}/settlements`)
      );
      // Doc ids are ISO week-ending dates, so a descending string sort is
      // newest-first — no composite index needed for a per-route list.
      setRows(
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as SettlementRecordView) }))
          .sort((a, b) => (a.weekEnding || a.id).localeCompare(b.weekEnding || b.id))
          .reverse()
      );
    } catch (err) {
      console.error('Failed to load settlement history', err);
      setLoadError(true);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettlements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, routeId]);

  return (
    <div className="bg-gray-50 rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
          <i className="fas fa-file-invoice-dollar mr-2 text-[#FFD700]"></i>
          Settlement History
        </h4>
        <button
          onClick={fetchSettlements}
          disabled={loading}
          className="px-4 py-2 bg-white border border-gray-200 text-gray-500 rounded-xl text-[9px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2"
        >
          <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-rotate'}`}></i>
          Refresh
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center py-2">
          Loading settlements…
        </p>
      ) : loadError ? (
        <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider text-center py-2">
          Couldn't load settlement history — tap Refresh to try again
        </p>
      ) : rows.length === 0 ? (
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center py-2">
          No settlements yet — upload statements in Data Import
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const charged = row.computed?.productCharged ?? row.accountability?.totalProductCharged;
            const stales = row.computed?.stalesAmount;
            const stalesPct = row.computed?.stalesPct;
            const margin = row.computed?.margin;
            const chip = statusChip(row.validation?.status);
            const ingested = fmtIngested(row.sources?.[0]?.ingestedAt);
            const storeCount = Array.isArray(row.storeRows) ? row.storeRows.length : 0;
            return (
              <div key={row.id} className="bg-white rounded-xl px-4 py-3 border border-gray-100">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-black uppercase">
                    Week ending {fmtWeekEnding(row.weekEnding || row.id)}
                    {row.week != null && (
                      <span className="ml-2 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                        Week {row.week}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {row.kind === 'master' && (
                      <span className="px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest bg-black text-[#FFD700]">
                        Master
                      </span>
                    )}
                    <span className={`px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest ${chip.classes}`}>
                      {chip.label}
                    </span>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-gray-600">
                  {charged != null && <span>Charged {formatMoney(charged)}</span>}
                  {stales != null && (
                    <span>
                      Stales {formatMoney(stales)}
                      {stalesPct != null ? ` (${stalesPct.toFixed(2)}%)` : ''}
                    </span>
                  )}
                  {margin != null && <span>Margin {formatMoney(margin)}</span>}
                </div>
                {(storeCount > 0 || ingested) && (
                  <div className="mt-1 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                    {storeCount > 0 ? `${storeCount} store rows` : ''}
                    {storeCount > 0 && ingested ? ' · ' : ''}
                    {ingested ? `Ingested ${ingested}` : ''}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider text-center">
        From Flowers IDP statements uploaded in Data Import
      </p>
    </div>
  );
};
