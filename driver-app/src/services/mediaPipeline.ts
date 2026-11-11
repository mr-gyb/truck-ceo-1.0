// Media pipeline for capture-first intake: compress before upload,
// pick lean recorder settings, and decide what local media may live
// and for how long. The pure helpers at the top are unit-tested by
// functions/test/run-media-pipeline.ts; the DOM functions below them
// are the browser implementations that use those decisions.

// ---------------------------------------------------------------------------
// Pure decisions (no DOM — testable)
// ---------------------------------------------------------------------------

/** Long-edge cap for uploaded photos. 1600px keeps receipt text legible
 * for the extraction reader; nothing ships larger. */
export const PHOTO_MAX_EDGE = 1600;
/** JPEG quality for compressed photos. */
export const PHOTO_JPEG_QUALITY = 0.82;
/** Voice/video recorder hard cap, seconds. */
export const RECORDER_MAX_SECONDS = 60;
/** Voice notes are speech: 32 kbps Opus is plenty and ~240 KB/minute. */
export const RECORDER_AUDIO_BITS_PER_SECOND = 32_000;
/** Local copies of FAILED uploads are auto-deleted after this long. */
export const LOCAL_MEDIA_TTL_MS = 24 * 60 * 60 * 1000;

/** Target dimensions for a photo: long edge capped at PHOTO_MAX_EDGE,
 * aspect preserved, never upscaled. */
export function planCompression(
  width: number,
  height: number,
): { width: number; height: number; scaled: boolean } {
  const longEdge = Math.max(width, height);
  if (!width || !height || longEdge <= PHOTO_MAX_EDGE) {
    return { width, height, scaled: false };
  }
  const scale = PHOTO_MAX_EDGE / longEdge;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    scaled: true,
  };
}

/** Recorder mime preference, leanest speech-friendly first. The caller
 * passes MediaRecorder.isTypeSupported; returns null = browser default. */
export const RECORDER_MIME_PREFERENCE = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/webm',
] as const;

export function selectRecorderMime(isSupported: (mime: string) => boolean): string | null {
  for (const mime of RECORDER_MIME_PREFERENCE) {
    try {
      if (isSupported(mime)) return mime;
    } catch {
      /* a throwing isTypeSupported just skips that candidate */
    }
  }
  return null;
}

/** A queued (failed-upload) local copy is swept once it is this old. */
export function isStaleLocalMedia(createdAtMs: number, nowMs: number): boolean {
  return nowMs - createdAtMs >= LOCAL_MEDIA_TTL_MS;
}

// ---------------------------------------------------------------------------
// Browser implementations
// ---------------------------------------------------------------------------

/**
 * Compress a camera photo for upload: decode with EXIF orientation
 * applied (createImageBitmap's 'from-image'), draw to canvas at the
 * planned size, re-encode as JPEG q0.82. Returns the original blob if
 * anything in the pipeline is unavailable — an upload must never fail
 * because compression did.
 */
export async function compressPhoto(file: Blob): Promise<Blob> {
  try {
    if (typeof createImageBitmap !== 'function') return file;
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      const plan = planCompression(bitmap.width, bitmap.height);
      if (!plan.scaled && file.type === 'image/jpeg') return file;
      const canvas = document.createElement('canvas');
      canvas.width = plan.width;
      canvas.height = plan.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', PHOTO_JPEG_QUALITY),
      );
      return blob ?? file;
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}
