import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useDriverDay } from '../contexts/DriverDayContext';

const inputCls =
  'w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-black';

/**
 * Join another route from INSIDE the app (Chris's directive, 2026-11-10).
 * Before this, the invite form existed only on the sign-in screen —
 * which a signed-in driver never sees again — so a driver holding one
 * route had NO way to redeem a second code. Redeeming ADDS the route to
 * the driver's memberships (joinWithInviteCode); the switcher then shows
 * every route they hold.
 */
export const JoinRoutePanel: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const { joinWithInviteCode, profile } = useAuth();
  const { refresh } = useDriverDay();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await joinWithInviteCode(code, name || profile?.displayName || '');
      await refresh();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code did not work. Check it and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-black uppercase tracking-tight">Join another route</h2>
      <p className="mt-1 text-sm text-slate-600">
        Enter the invite code your owner gave you. The route is ADDED to your account — you keep
        every route you already have and can switch between them.
      </p>
      {error && (
        <div className="mt-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          {error}
        </div>
      )}
      <form className="mt-4 space-y-3" onSubmit={(e) => void submit(e)}>
        <input
          className={inputCls}
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={`${inputCls} uppercase`}
          placeholder="Invite code (e.g. GXHK2Z)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-black py-3.5 text-base font-bold text-[#FFD700] disabled:opacity-40"
        >
          {busy ? 'Joining…' : 'Join this route too'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="w-full py-1 text-center text-sm font-semibold text-slate-600"
        >
          Back
        </button>
      </form>
    </div>
  );
};
