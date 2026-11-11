import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useDriverDay } from '../contexts/DriverDayContext';
import { getLatestDriverScore } from '../services/driverService';
import { SCORE_WEIGHTS, type DriverScore } from '../types';

const ROWS: Array<{ key: keyof typeof SCORE_WEIGHTS; label: string }> = [
  { key: 'sales', label: 'Sales' },
  { key: 'stale', label: 'Stale control' },
  { key: 'planogram', label: 'Planogram' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'dataDiscipline', label: 'Data discipline' },
];

const tier = (total: number) =>
  total >= 90 ? { label: 'Gold', cls: 'text-yellow-600' } : total >= 80 ? { label: 'Silver', cls: 'text-slate-500' } : null;

export const ScoreScreen: React.FC = () => {
  const { profile } = useAuth();
  const { route } = useDriverDay();
  const [score, setScore] = useState<DriverScore | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The loading state MUST clear on every path — a rejected read used
      // to leave this tab on the skeleton forever (2026-11-08 defect).
      try {
        if (!profile || !route) return;
        const latest = await getLatestDriverScore(route.businessId ?? profile.businessId, route.id);
        if (!cancelled) setScore(latest);
      } catch {
        if (!cancelled) setScore(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.businessId, route?.businessId, route?.id]);

  if (loading) return <div className="h-40 animate-pulse rounded-2xl bg-slate-200" />;

  if (!score) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center shadow-sm">
        <i className="fa-solid fa-star text-3xl text-slate-300" />
        <h2 className="mt-3 text-lg font-black uppercase tracking-tight">No score yet</h2>
        <p className="mt-2 text-sm text-slate-600">
          No score yet — your first score posts after your first full week. Driver Scores post
          weekly out of 100 — Sales 30, Stale control 25, Planogram 15, Fuel 15, Data discipline
          15. Finish your days and submit your end-of-day reports, and it will land here.
        </p>
      </div>
    );
  }

  const t = tier(score.total);

  return (
    <div>
      <div className="rounded-2xl bg-black px-5 py-6 text-center text-white">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
          Week of {score.weekOf}
        </p>
        <p className="mt-1 text-6xl font-black text-[#FFD700]">{score.total}</p>
        <p className="mt-1 text-sm font-semibold text-slate-300">
          out of 100{t && <span className={`ml-2 font-black ${t.cls}`}>{t.label}</span>}
        </p>
      </div>
      <div className="mt-4 space-y-3">
        {ROWS.map(({ key, label }) => {
          const value = score[key];
          const max = SCORE_WEIGHTS[key];
          return (
            <div key={key} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-baseline justify-between">
                <span className="font-bold text-slate-800">{label}</span>
                <span className="text-sm font-bold text-slate-500">
                  {value} / {max}
                </span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-[#FFD700]"
                  style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
