import React, { useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { todayId, useDriverDay } from '../contexts/DriverDayContext';
import { submitEodReport } from '../services/driverService';
import { submitCapture } from '../services/captureService';
import {
  RECORDER_AUDIO_BITS_PER_SECOND,
  RECORDER_MAX_SECONDS,
  selectRecorderMime,
} from '../services/mediaPipeline';
import { deriveEodDraft, type DerivedField } from '../services/eodDerivation';
import type { EodReport } from '../types';

// End-of-Day, capture-first (Chris's spec, 2026-11-10): NO typed fields.
// The five values are derived from today's captures (see
// services/eodDerivation.ts), shown with where each came from, and the
// driver TAP-CONFIRMS each one. A value that could not be read is never
// guessed: the field says what to do (retake the photo, or report by
// voice) and submit stays locked until all five are ready AND confirmed.
// The submitted doc keeps the owner app's exact DriverEod shape, plus
// provenance capture ids.

type FieldKey = 'piecesLeft' | 'stalesPulled' | 'stopsCompleted' | 'endLocation' | 'outlook';

const FIELD_LABELS: Record<FieldKey, string> = {
  piecesLeft: 'Pieces left on the truck',
  stalesPulled: 'Stales pulled',
  stopsCompleted: 'Stops completed',
  endLocation: 'End location',
  outlook: "Tomorrow's outlook",
};

const FieldRow: React.FC<{
  label: string;
  field: DerivedField<number> | DerivedField<string>;
  confirmed: boolean;
  onToggle: () => void;
  disabled: boolean;
}> = ({ label, field, confirmed, onToggle, disabled }) => (
  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-700">{label}</p>
        {field.state === 'ready' ? (
          <p className="mt-1 break-words text-2xl font-black tracking-tight">
            {typeof field.value === 'number' ? field.value.toLocaleString() : field.value}
          </p>
        ) : (
          <p className="mt-1 text-base font-bold text-slate-400">
            {field.state === 'pending'
              ? 'Being read…'
              : field.state === 'attention'
                ? 'Could not be read'
                : 'Not captured yet'}
          </p>
        )}
        <p className="mt-1 text-xs text-slate-500">{field.note}</p>
      </div>
      {field.state === 'ready' && (
        <button
          type="button"
          disabled={disabled}
          onClick={onToggle}
          className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-40 ${
            confirmed ? 'bg-green-600 text-white' : 'bg-black text-[#FFD700]'
          }`}
        >
          {confirmed ? (
            <>
              <i className="fa-solid fa-check mr-1" /> Confirmed
            </>
          ) : (
            'Tap to confirm'
          )}
        </button>
      )}
    </div>
  </div>
);

/** Voice-note recorder for the outlook (and voice fallback reports).
 * Lean by design: the leanest speech mime the platform offers at
 * 32 kbps (≈240 KB for a full note), hard-capped at 60 seconds with a
 * countdown and auto-stop. The recording lives only in memory; the
 * chunks are dropped the moment the note is built, and a failed send
 * is staged on-phone for automatic retry like any capture. */
const VoiceNoteButton: React.FC<{ onSaved: () => Promise<void> }> = ({ onSaved }) => {
  const { profile, currentUser } = useAuth();
  const { route } = useDriverDay();
  const [recording, setRecording] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RECORDER_MAX_SECONDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const toggle = async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice recording is not available in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = selectRecorderMime((m) => MediaRecorder.isTypeSupported(m));
      const recorder = new MediaRecorder(
        stream,
        mime
          ? { mimeType: mime, audioBitsPerSecond: RECORDER_AUDIO_BITS_PER_SECOND }
          : { audioBitsPerSecond: RECORDER_AUDIO_BITS_PER_SECOND },
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        clearTimer();
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (!profile || !route || !currentUser) {
          chunksRef.current = [];
          return;
        }
        setBusy(true);
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          // In-memory copy ends here: the blob is handed to the upload
          // (and, only on failure, to the on-phone retry outbox).
          chunksRef.current = [];
          await submitCapture({
            businessId: route.businessId ?? profile.businessId,
            routeId: route.id,
            date: todayId(),
            type: 'voice',
            file: blob,
            contentType: blob.type,
            driverId: currentUser.uid,
            driverName: profile.displayName,
          });
          await onSaved();
        } catch {
          setError('No signal — that voice note is saved on this phone and will send itself when signal returns.');
        } finally {
          setBusy(false);
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setSecondsLeft(RECORDER_MAX_SECONDS);
      timerRef.current = window.setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            recorderRef.current?.stop();
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } catch {
      setError('Microphone access was blocked. Allow the microphone to record a voice note.');
    }
  };

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle()}
        className={`flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-black uppercase tracking-tight disabled:opacity-50 ${
          recording ? 'bg-red-600 text-white' : 'bg-black text-[#FFD700]'
        }`}
      >
        <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : recording ? 'fa-stop' : 'fa-microphone'}`} />
        {busy
          ? 'Sending…'
          : recording
            ? `Stop and send voice note · 0:${String(secondsLeft).padStart(2, '0')} left`
            : 'Record tomorrow’s outlook'}
      </button>
      {error && <p className="mt-2 text-sm font-medium text-red-700">{error}</p>}
    </div>
  );
};

export const EodScreen: React.FC = () => {
  const { profile, currentUser } = useAuth();
  const { route, eod, setEod, captures, visits, refreshCaptures, guideDay, todayStops } =
    useDriverDay();
  const [confirmed, setConfirmed] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [deviceLocation, setDeviceLocation] = useState<string | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = useMemo(
    () =>
      route
        ? deriveEodDraft({
            captures,
            visits,
            // With a baseline guide loaded, the day's run is the guide
            // day's stops — stops-completed is measured against the
            // run the driver was actually given, not the full registry
            // (a Tuesday EOD must not report Burger King/C-Town missed).
            stops: guideDay ? todayStops : route.stops,
            date: todayId(),
            deviceLocation,
          })
        : null,
    [captures, visits, route, deviceLocation, guideDay, todayStops],
  );

  const submitted = eod != null;
  const keys: FieldKey[] = ['piecesLeft', 'stalesPulled', 'stopsCompleted', 'endLocation', 'outlook'];
  const readyCount = draft ? keys.filter((k) => draft[k].state === 'ready').length : 0;
  const confirmedCount = draft
    ? keys.filter((k) => draft[k].state === 'ready' && confirmed[k]).length
    : 0;
  const canSubmit = !!draft && draft.complete && confirmedCount === 5 && !submitted;

  const grabLocation = () => {
    setLocError(null);
    if (!navigator.geolocation) {
      setLocError('Location is not available in this browser.');
      return;
    }
    setLocBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocBusy(false);
        setDeviceLocation(`${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`);
      },
      () => {
        setLocBusy(false);
        setLocError('Location was blocked. Allow location so the end point records automatically.');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const submit = async () => {
    if (!profile || !route || !currentUser || !draft || !canSubmit) return;
    setBusy(true);
    setError(null);
    const captureIds = [...new Set(keys.flatMap((k) => draft[k].sourceCaptureIds).filter(Boolean))];
    const report: EodReport = {
      date: todayId(),
      piecesLeft: draft.piecesLeft.value as number,
      stalesPulled: draft.stalesPulled.value as number,
      stopsCompleted: draft.stopsCompleted.value as string,
      endLocation: draft.endLocation.value as string,
      outlook: draft.outlook.value as string,
      provenance: { captureIds, derivedAt: new Date().toISOString() },
    };
    try {
      await submitEodReport(
        route.businessId ?? profile.businessId,
        route.id,
        report,
        currentUser.uid,
        profile.displayName,
      );
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
        <span className={`text-sm font-bold ${canSubmit ? 'text-green-700' : 'text-slate-500'}`}>
          {confirmedCount} of 5 confirmed
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Built from today's photos and voice notes — nothing to type. Check each number and tap
        to confirm it.
      </p>

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

      {draft && (
        <div className="mt-4 space-y-3">
          {keys.map((k) => (
            <FieldRow
              key={k}
              label={FIELD_LABELS[k]}
              field={draft[k]}
              confirmed={!!confirmed[k]}
              disabled={submitted}
              onToggle={() => setConfirmed((prev) => ({ ...prev, [k]: !prev[k] }))}
            />
          ))}
        </div>
      )}

      {!submitted && draft && draft.endLocation.state === 'missing' && (
        <div className="mt-4">
          <button
            type="button"
            disabled={locBusy}
            onClick={grabLocation}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-black py-4 text-base font-black uppercase tracking-tight disabled:opacity-50"
          >
            <i className={`fa-solid ${locBusy ? 'fa-spinner fa-spin' : 'fa-location-dot'}`} />
            {locBusy ? 'Getting location…' : 'Use my location'}
          </button>
          {locError && <p className="mt-2 text-sm font-medium text-red-700">{locError}</p>}
        </div>
      )}

      {!submitted && draft && draft.outlook.state === 'missing' && (
        <div className="mt-3">
          <VoiceNoteButton onSaved={refreshCaptures} />
        </div>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!canSubmit || busy}
        className="mt-6 w-full rounded-2xl bg-black py-4 text-lg font-black uppercase tracking-tight text-[#FFD700] disabled:opacity-40"
      >
        {submitted
          ? 'Submitted'
          : busy
            ? 'Submitting…'
            : canSubmit
              ? 'Submit end of day'
              : `Confirm all 5 to submit (${confirmedCount}/5 · ${readyCount}/5 ready)`}
      </button>
    </div>
  );
};
