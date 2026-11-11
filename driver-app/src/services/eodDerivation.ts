import type { DriverCapture, Stop, StopVisit } from '../types';

/**
 * End-of-Day derivation (capture-first spec, 2026-11-10) — PURE logic,
 * no Firebase imports, so it is unit-testable and shared verbatim by the
 * EOD screen.
 *
 * The five EOD values are DERIVED from the day's captures, never typed:
 *   piecesLeft     <- latest inventory (truck) capture's read pieces
 *                     (a voice report with read pieces counts too)
 *   stalesPulled   <- sum of the day's stales-ticket reads
 *   stopsCompleted <- the day's stop visits (done count / route stops)
 *   endLocation    <- the device's location at submit (supplied by the
 *                     screen; this module only grades its presence)
 *   outlook        <- the transcript of the day's voice note
 *
 * Honesty rules, binding:
 *  - A field is 'ready' ONLY with a value actually read from a capture
 *    whose status is 'extracted' or 'confirmed'. Nothing is estimated.
 *  - A capture still being read makes the field 'pending', never ready.
 *  - An unreadable capture ('needs_attention') makes the field
 *    'attention': the driver must retake it or report by voice. The
 *    value is NEVER silently guessed past an unreadable capture.
 *  - No capture at all = 'missing', with the prompt that creates it.
 */

export type EodFieldState = 'ready' | 'pending' | 'attention' | 'missing';

export interface DerivedField<T> {
  state: EodFieldState;
  value: T | null;
  /** Capture ids this value was read from — the provenance. */
  sourceCaptureIds: string[];
  /** Driver-facing explanation of where the value came from / what's next. */
  note: string;
}

export interface EodDraft {
  piecesLeft: DerivedField<number>;
  stalesPulled: DerivedField<number>;
  stopsCompleted: DerivedField<string>;
  endLocation: DerivedField<string>;
  outlook: DerivedField<string>;
  /** True only when every field is 'ready' — the submit gate. */
  complete: boolean;
}

const usable = (c: DriverCapture) => c.status === 'extracted' || c.status === 'confirmed';
const blocked = (c: DriverCapture) => c.status === 'needs_attention';
const waiting = (c: DriverCapture) => c.status === 'pending';

function grade<T>(
  candidates: DriverCapture[],
  read: (c: DriverCapture) => T | null | undefined,
  missingNote: string,
  pendingNote: string,
): DerivedField<T> {
  const bad = candidates.filter(blocked);
  if (bad.length > 0) {
    return {
      state: 'attention',
      value: null,
      sourceCaptureIds: bad.map((c) => c.id ?? '').filter(Boolean),
      note: 'A photo could not be read — retake it or report by voice.',
    };
  }
  const sources: DriverCapture[] = [];
  let value: T | null = null;
  for (const c of candidates) {
    if (!usable(c)) continue;
    const v = read(c);
    if (v != null) {
      sources.push(c);
      value = v;
    }
  }
  if (value != null) {
    return {
      state: 'ready',
      value,
      sourceCaptureIds: sources.map((c) => c.id ?? '').filter(Boolean),
      note: 'Read from your captures — tap to confirm.',
    };
  }
  if (candidates.some(waiting)) {
    return { state: 'pending', value: null, sourceCaptureIds: [], note: pendingNote };
  }
  return { state: 'missing', value: null, sourceCaptureIds: [], note: missingNote };
}

export function deriveEodDraft(input: {
  captures: DriverCapture[];
  visits: Record<string, StopVisit>;
  stops: Stop[];
  date: string;
  /** Device location string captured at confirm time, if the driver allowed it. */
  deviceLocation?: string | null;
}): EodDraft {
  const { captures, visits, stops, date, deviceLocation } = input;
  const byType = (t: DriverCapture['type']) => captures.filter((c) => c.type === t);

  // Pieces left: the LATEST usable read wins (captures arrive in
  // created order from the service; take the last match).
  const pieceSources = [...byType('inventory'), ...byType('voice')];
  const piecesLeft = grade<number>(
    pieceSources,
    (c) => c.extracted?.pieces ?? null,
    'Take the end-of-day truck photo so the count can be read.',
    'Your truck photo is being read…',
  );
  // grade() returns the FIRST usable value; for pieces the latest read
  // is the truth, so rescan from the end when several sources exist.
  if (piecesLeft.state === 'ready' && pieceSources.length > 1) {
    for (let i = pieceSources.length - 1; i >= 0; i--) {
      const c = pieceSources[i];
      if (usable(c) && c.extracted?.pieces != null) {
        piecesLeft.value = c.extracted.pieces;
        piecesLeft.sourceCaptureIds = [c.id ?? ''].filter(Boolean);
        break;
      }
    }
  }

  // Stales pulled: the SUM of every usable stales-ticket read.
  const stalesCaps = byType('stales');
  let stalesPulled: DerivedField<number>;
  if (stalesCaps.some(blocked)) {
    stalesPulled = {
      state: 'attention',
      value: null,
      sourceCaptureIds: stalesCaps.filter(blocked).map((c) => c.id ?? '').filter(Boolean),
      note: 'A stales ticket could not be read — retake it or report by voice.',
    };
  } else {
    const readCaps = stalesCaps.filter((c) => usable(c) && c.extracted?.stalesPulled != null);
    if (readCaps.length > 0) {
      stalesPulled = {
        state: 'ready',
        value: readCaps.reduce((sum, c) => sum + (c.extracted?.stalesPulled ?? 0), 0),
        sourceCaptureIds: readCaps.map((c) => c.id ?? '').filter(Boolean),
        note: `Added up from ${readCaps.length} stales ticket${readCaps.length === 1 ? '' : 's'} — tap to confirm.`,
      };
    } else if (stalesCaps.some(waiting)) {
      stalesPulled = {
        state: 'pending',
        value: null,
        sourceCaptureIds: [],
        note: 'Your stales tickets are being read…',
      };
    } else {
      stalesPulled = {
        state: 'missing',
        value: null,
        sourceCaptureIds: [],
        note: 'Photograph the stales ticket at each stop.',
      };
    }
  }

  // Stops completed: derived from the day's visits against the route's
  // stop list. No stops on the route = nothing to derive (missing).
  let stopsCompleted: DerivedField<string>;
  if (stops.length === 0) {
    stopsCompleted = {
      state: 'missing',
      value: null,
      sourceCaptureIds: [],
      note: 'This route has no stops listed yet.',
    };
  } else {
    const done = stops.filter((s) => visits[`${date}:${s.id}`]?.status === 'done').length;
    const missed = stops
      .filter((s) => visits[`${date}:${s.id}`]?.status !== 'done')
      .map((s) => s.name);
    stopsCompleted = {
      state: 'ready',
      value:
        done === stops.length
          ? `All ${stops.length}`
          : `${done} of ${stops.length} — missed: ${missed.join(', ')}`,
      sourceCaptureIds: [],
      note: 'Counted from today’s stop check-ins — tap to confirm.',
    };
  }

  // End location: automatic from the device at submit — graded here,
  // captured by the screen (geolocation needs a user gesture + browser).
  const endLocation: DerivedField<string> = deviceLocation
    ? {
        state: 'ready',
        value: deviceLocation,
        sourceCaptureIds: [],
        note: 'From your device location — tap to confirm.',
      }
    : {
        state: 'missing',
        value: null,
        sourceCaptureIds: [],
        note: 'Tap “Use my location” so the truck’s end point is recorded automatically.',
      };

  // Outlook: the transcript of the latest voice note.
  const voiceCaps = byType('voice');
  const outlook = grade<string>(
    voiceCaps,
    (c) => c.extracted?.transcript ?? null,
    'Record a voice note: promos, big orders, anything to flag.',
    'Your voice note is being transcribed…',
  );

  const fields = [piecesLeft, stalesPulled, stopsCompleted, endLocation, outlook];
  return {
    piecesLeft,
    stalesPulled,
    stopsCompleted,
    endLocation,
    outlook,
    complete: fields.every((f) => f.state === 'ready'),
  };
}
