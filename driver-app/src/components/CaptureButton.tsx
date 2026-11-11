import React, { useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { todayId, useDriverDay } from '../contexts/DriverDayContext';
import { createCapture } from '../services/captureService';
import type { CaptureType } from '../types';

/**
 * The one-tap camera action of the capture-first spec: tap → camera →
 * the photo is uploaded as a capture and the backend reads it. No forms,
 * no typing. Shows an honest busy/error state; a failed upload says so
 * and offers the same tap again — it never pretends the photo landed.
 */
export const CaptureButton: React.FC<{
  type: CaptureType;
  label: string;
  icon: string;
  storeId?: string | null;
  storeName?: string | null;
  done?: boolean;
  big?: boolean;
  onCaptured?: () => void;
}> = ({ type, label, icon, storeId, storeName, done, big, onCaptured }) => {
  const { profile, currentUser } = useAuth();
  const { route, refreshCaptures, startDay } = useDriverDay();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !profile || !route || !currentUser) return;
    setBusy(true);
    setError(null);
    try {
      await createCapture({
        businessId: route.businessId ?? profile.businessId,
        routeId: route.id,
        date: todayId(),
        type,
        file,
        contentType: file.type || 'image/jpeg',
        storeId: storeId ?? null,
        storeName: storeName ?? null,
        driverId: currentUser.uid,
        driverName: profile.displayName,
      });
      if (type === 'depot') startDay();
      await refreshCaptures();
      onCaptured?.();
    } catch {
      setError('That photo did not upload. Check your connection and tap to try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void onFile(e)}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className={`flex w-full items-center justify-center gap-2 rounded-2xl font-black uppercase tracking-tight disabled:opacity-50 ${
          big ? 'py-5 text-lg' : 'py-3.5 text-sm'
        } ${
          done
            ? 'bg-green-600 text-white'
            : 'bg-black text-[#FFD700]'
        }`}
      >
        <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : done ? 'fa-check' : icon}`} />
        {busy ? 'Sending…' : done ? `${label} — add another` : label}
      </button>
      {error && <p className="mt-2 text-sm font-medium text-red-700">{error}</p>}
    </div>
  );
};
