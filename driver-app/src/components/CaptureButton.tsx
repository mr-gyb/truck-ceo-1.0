import React, { useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { todayId, useDriverDay } from '../contexts/DriverDayContext';
import { submitCapture } from '../services/captureService';
import { compressPhoto } from '../services/mediaPipeline';
import type { CaptureType } from '../types';

/**
 * The one-tap camera action of the capture-first spec: tap → camera →
 * the photo is compressed on the phone (long edge 1600px, JPEG q0.82),
 * uploaded with a resumable upload + live progress, and the backend
 * reads it. No forms, no typing, and the photo never passes through
 * the device gallery — the camera hands it straight to the app.
 *
 * Local copies: the photo exists only in memory while uploading and
 * is gone the moment the upload confirms. If the upload fails, the
 * copy is staged on the phone for automatic retry (the button says
 * so) and deleted as soon as a retry lands, or after 24h.
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
  const [stage, setStage] = useState<'idle' | 'preparing' | 'sending'>('idle');
  const [progress, setProgress] = useState(0);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !profile || !route || !currentUser) return;
    setStage('preparing');
    setProgress(0);
    setError(null);
    setQueued(false);
    try {
      const blob = await compressPhoto(file);
      setStage('sending');
      await submitCapture({
        businessId: route.businessId ?? profile.businessId,
        routeId: route.id,
        date: todayId(),
        type,
        file: blob,
        contentType: 'image/jpeg',
        storeId: storeId ?? null,
        storeName: storeName ?? null,
        driverId: currentUser.uid,
        driverName: profile.displayName,
        onProgress: (fraction) => setProgress(fraction),
      });
      if (type === 'depot') startDay();
      await refreshCaptures();
      onCaptured?.();
    } catch {
      // submitCapture staged the photo in the on-phone outbox: it will
      // send itself when signal returns, and the copy deletes then.
      setQueued(true);
      setError('No signal — that photo is saved on this phone and will send itself when signal returns.');
    } finally {
      setStage('idle');
    }
  };

  const busy = stage !== 'idle';
  const busyLabel =
    stage === 'preparing'
      ? 'Preparing…'
      : `Sending… ${Math.round(progress * 100)}%`;

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
        {busy ? busyLabel : done ? `${label} — add another` : label}
      </button>
      {queued ? (
        <p className="mt-2 text-sm font-medium text-amber-700">{error}</p>
      ) : (
        error && <p className="mt-2 text-sm font-medium text-red-700">{error}</p>
      )}
    </div>
  );
};
