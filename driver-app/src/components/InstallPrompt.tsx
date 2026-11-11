import React, { useEffect, useState } from 'react';

// "Install app" affordance, shown once and dismissible forever:
//  - Android / Chrome: captures `beforeinstallprompt` and offers the
//    native install dialog.
//  - iOS Safari (no beforeinstallprompt): a one-line hint —
//    "Share → Add to Home Screen" — shown only when the app is NOT
//    already running standalone.
// Dismissal persists in localStorage; this is UI state only, no media
// or capture data ever touches local storage.

const DISMISS_KEY = 'rr-install-dismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

export const InstallPrompt: React.FC = () => {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (dismissed || isStandalone()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    if (isIos()) setShowIosHint(true);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, [dismissed]);

  if (dismissed || isStandalone() || (!deferred && !showIosHint)) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode — the banner simply returns next visit */
    }
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === 'accepted') dismiss();
    setDeferred(null);
  };

  return (
    <div className="fixed inset-x-3 bottom-24 z-50 flex items-center gap-3 rounded-2xl bg-black px-4 py-3 shadow-2xl ring-1 ring-[#FFD700]/60">
      <i className="fa-solid fa-download text-lg text-[#FFD700]" />
      <p className="flex-1 text-sm font-semibold text-white">
        {deferred ? (
          <>Install Route Runner for one-tap access.</>
        ) : (
          <>
            Install Route Runner: tap <i className="fa-solid fa-arrow-up-from-bracket mx-0.5" />
            Share, then “Add to Home Screen”.
          </>
        )}
      </p>
      {deferred && (
        <button
          type="button"
          onClick={() => void install()}
          className="rounded-xl bg-[#FFD700] px-3 py-2 text-sm font-black uppercase text-black"
        >
          Install
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss install prompt"
        onClick={dismiss}
        className="px-1 text-lg text-slate-400"
      >
        <i className="fa-solid fa-xmark" />
      </button>
    </div>
  );
};
