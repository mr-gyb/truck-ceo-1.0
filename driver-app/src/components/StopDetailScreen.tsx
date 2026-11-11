import React, { useEffect, useRef } from 'react';
import { todayId, useDriverDay } from '../contexts/DriverDayContext';
import { GuideLine } from './TodayScreen';
import type { PhotoKind, Stop } from '../types';

// Photo prompts (finalized 2026-11-08): delivery + stales at EVERY stop;
// planogram only where the store record flags it (planogramPhotoRequired,
// default off) — filtered in StopDetailScreen below.
const PHOTO_PROMPTS: Array<{ kind: PhotoKind; label: string; icon: string }> = [
  { kind: 'delivery', label: 'Delivery photo', icon: 'fa-box-open' },
  { kind: 'planogram', label: 'Planogram photo', icon: 'fa-table-cells-large' },
  { kind: 'stales', label: 'Stales photo', icon: 'fa-bread-slice' },
];

const PhotoPrompt: React.FC<{
  stop: Stop;
  kind: PhotoKind;
  label: string;
  icon: string;
}> = ({ stop, kind, label, icon }) => {
  const { visits, updateVisit } = useDriverDay();
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = visits[`${todayId()}:${stop.id}`]?.photos[kind];

  // Release local preview URLs when they change / on unmount.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const visit = visits[`${todayId()}:${stop.id}`];
          const photos = { ...(visit?.photos ?? {}), [kind]: URL.createObjectURL(file) };
          updateVisit(stop.id, { photos });
          e.target.value = '';
        }}
      />
      {preview ? (
        <button type="button" onClick={() => inputRef.current?.click()} className="block w-full">
          <img src={preview} alt={label} className="h-36 w-full rounded-xl object-cover" />
          <span className="mt-2 block text-center text-sm font-bold text-green-700">
            <i className="fa-solid fa-check mr-1" /> {label} — tap to retake
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex h-36 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 text-slate-600"
        >
          <i className={`fa-solid ${icon} text-2xl`} />
          <span className="text-sm font-bold">{label}</span>
          <span className="text-xs text-slate-400">Tap to take a photo</span>
        </button>
      )}
    </div>
  );
};

export const StopDetailScreen: React.FC<{ stop: Stop; onBack: () => void }> = ({ stop, onBack }) => {
  const { visits, updateVisit } = useDriverDay();
  const visit = visits[`${todayId()}:${stop.id}`];
  const status = visit?.status ?? 'pending';
  const photoCount = Object.keys(visit?.photos ?? {}).length;

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 text-sm font-bold text-slate-600">
        <i className="fa-solid fa-arrow-left mr-1" /> Back to today
      </button>

      <div className="rounded-2xl bg-black px-5 py-4 text-white">
        <h2 className="text-xl font-black leading-tight">{stop.name}</h2>
        <p className="mt-1 text-sm text-slate-300">{stop.address}</p>
        <p className="mt-2 text-xs font-semibold text-slate-400">
          {stop.targetArrivalTime
            ? `Target arrival: ${stop.targetArrivalTime}`
            : 'Target time not set yet'}
          {stop.storeNumber ? ` · Store #${stop.storeNumber}` : ''}
        </p>
      </div>

      {(stop.guidePieces !== undefined || stop.guideSelfOrders || stop.guideInventory) && (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <GuideLine stop={stop} large />
        </div>
      )}

      {status === 'pending' && (
        <button
          type="button"
          onClick={() =>
            updateVisit(stop.id, { status: 'arrived', arrivedAt: new Date().toISOString() })
          }
          className="mt-4 w-full rounded-2xl bg-black py-4 text-lg font-black uppercase tracking-tight text-[#FFD700]"
        >
          <i className="fa-solid fa-location-dot mr-2" /> I'm here
        </button>
      )}
      {status !== 'pending' && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-2.5 text-center text-sm font-semibold text-amber-800">
          {status === 'arrived'
            ? `Arrived ${visit?.arrivedAt ? new Date(visit.arrivedAt).toLocaleTimeString() : ''} — take your photos, then mark delivered.`
            : `Delivered ${visit?.completedAt ? new Date(visit.completedAt).toLocaleTimeString() : ''}`}
        </p>
      )}

      <h3 className="mb-2 mt-6 text-xs font-black uppercase tracking-widest text-slate-500">
        Photos {photoCount > 0 && `· ${photoCount} taken`}
      </h3>
      <div className="space-y-2.5">
        {PHOTO_PROMPTS.filter(
          (p) => p.kind !== 'planogram' || stop.planogramPhotoRequired === true,
        ).map((p) => (
          <PhotoPrompt key={p.kind} stop={stop} kind={p.kind} label={p.label} icon={p.icon} />
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Photos are held on this device in this draft and upload with the day's work once sync is
        connected.
      </p>

      <h3 className="mb-2 mt-6 text-xs font-black uppercase tracking-widest text-slate-500">Notes</h3>
      <textarea
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-black"
        rows={3}
        placeholder="Anything the office should know about this stop…"
        value={visit?.notes ?? ''}
        onChange={(e) => updateVisit(stop.id, { notes: e.target.value })}
      />

      {status !== 'done' ? (
        <button
          type="button"
          disabled={status === 'pending'}
          onClick={() =>
            updateVisit(stop.id, { status: 'done', completedAt: new Date().toISOString() })
          }
          className="mt-5 w-full rounded-2xl bg-green-600 py-4 text-lg font-black uppercase tracking-tight text-white disabled:opacity-40"
        >
          <i className="fa-solid fa-check mr-2" /> Mark delivered
        </button>
      ) : (
        <button
          type="button"
          onClick={onBack}
          className="mt-5 w-full rounded-2xl bg-black py-4 text-lg font-black uppercase tracking-tight text-[#FFD700]"
        >
          Done — back to route
        </button>
      )}
    </div>
  );
};
