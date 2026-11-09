import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { todayId, useDriverDay } from '../contexts/DriverDayContext';
import { submitEodReport } from '../services/driverService';
import type { EodReport } from '../types';

const inputCls =
  'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-black disabled:bg-slate-100';

// The EOD checklist: the same 5 required fields as the owner app's
// DriverHome, with the same locked submit — the button stays disabled
// until all 5 are filled, and a submitted report locks the form.

export const EodScreen: React.FC = () => {
  const { profile, currentUser } = useAuth();
  const { route, eod, setEod } = useDriverDay();
  const [f, setF] = useState({ piecesLeft: '', stalesPulled: '', stopsCompleted: '', endLocation: '', outlook: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (eod) {
      setF({
        piecesLeft: String(eod.piecesLeft),
        stalesPulled: String(eod.stalesPulled),
        stopsCompleted: eod.stopsCompleted,
        endLocation: eod.endLocation,
        outlook: eod.outlook,
      });
    }
  }, [eod]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const filled = [f.piecesLeft, f.stalesPulled, f.stopsCompleted, f.endLocation, f.outlook].filter(
    (v) => v.trim() !== '',
  ).length;
  const complete = filled === 5;
  const submitted = eod != null;

  const submit = async () => {
    if (!profile || !route || !currentUser || !complete) return;
    setBusy(true);
    setError(null);
    const report: EodReport = {
      date: todayId(),
      piecesLeft: Number(f.piecesLeft),
      stalesPulled: Number(f.stalesPulled),
      stopsCompleted: f.stopsCompleted.trim(),
      endLocation: f.endLocation.trim(),
      outlook: f.outlook.trim(),
    };
    try {
      await submitEodReport(profile.businessId, route.id, report, currentUser.uid, profile.displayName);
      setEod(report);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!route) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center shadow-sm">
        <h2 className="text-lg font-black uppercase tracking-tight">No route assigned</h2>
        <p className="mt-2 text-sm text-slate-600">
          End-of-day opens once your account is linked to a route.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-black uppercase tracking-tight">End-of-day checklist</h2>
        <span className={`text-sm font-bold ${complete ? 'text-green-700' : 'text-slate-500'}`}>
          {filled} of 5
        </span>
      </div>

      {submitted && (
        <div className="mt-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-900">
          <i className="fa-solid fa-lock mr-1" /> Submitted — today's report is locked in
          TruckCEO.
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          {error}
        </div>
      )}

      <div className="mt-4 space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-slate-700">Pieces left on the truck</span>
          <input className={inputCls} type="number" inputMode="numeric" min="0" placeholder="0"
            value={f.piecesLeft} onChange={set('piecesLeft')} disabled={submitted} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-slate-700">Stales pulled</span>
          <input className={inputCls} type="number" inputMode="numeric" min="0" placeholder="0"
            value={f.stalesPulled} onChange={set('stalesPulled')} disabled={submitted} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-slate-700">Stops completed</span>
          <input className={inputCls} type="text" placeholder="e.g. All 12, or which were missed"
            value={f.stopsCompleted} onChange={set('stopsCompleted')} disabled={submitted} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-slate-700">End location</span>
          <input className={inputCls} type="text" placeholder="Where the truck ends the day"
            value={f.endLocation} onChange={set('endLocation')} disabled={submitted} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-slate-700">Tomorrow's outlook</span>
          <textarea className={inputCls} rows={3} placeholder="Promos, big orders, anything to flag"
            value={f.outlook} onChange={set('outlook')} disabled={submitted} />
        </label>
      </div>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!complete || submitted || busy}
        className="mt-6 w-full rounded-2xl bg-black py-4 text-lg font-black uppercase tracking-tight text-[#FFD700] disabled:opacity-40"
      >
        {submitted ? 'Submitted' : busy ? 'Submitting…' : complete ? 'Submit end of day' : `Fill all 5 to submit (${filled}/5)`}
      </button>
    </div>
  );
};
