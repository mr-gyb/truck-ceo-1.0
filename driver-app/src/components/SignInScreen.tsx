import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const inputCls =
  'w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-black';

/**
 * Firebase Auth errors arrive as raw "Firebase: Error (auth/...)" strings —
 * map the common ones to plain driver-readable copy. Join-flow errors are
 * already human-readable Errors, so they fall through to their message.
 */
function friendlyAuthError(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  switch (code) {
    case 'auth/email-already-in-use':
      return 'This email is already in use. Try signing in instead.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password. Check both and try again.';
    case 'auth/invalid-email':
      return 'That email address does not look valid.';
    case 'auth/weak-password':
      return 'Password is too weak — use at least 6 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute and try again.';
    case 'auth/network-request-failed':
      return 'Network problem — check your connection and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Talk to your owner.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google sign-in was cancelled. Try again when ready.';
    default:
      return e instanceof Error ? e.message : 'Something went wrong. Try again.';
  }
}

export const SignInScreen: React.FC = () => {
  const {
    configured,
    signIn,
    createAccount,
    signInWithGoogle,
    joinWithInviteCode,
    currentUser,
    profile,
    logout,
  } = useAuth();
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  // Signed in but NOT linked to a route yet: the account exists, there is
  // just no driver profile/binding for it. This is the state a driver lands
  // in right after Create account (or a standalone Sign in) — before the
  // 2026-11-09 fix this screen ignored the signed-in state entirely, so the
  // login form simply re-rendered and both buttons looked like silent
  // no-ops. Show the honest state and put the invite form right here.
  const needsInvite = !!currentUser && !profile;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-white">
      <header className="bg-black px-6 py-8 text-white">
        <p className="text-xs font-bold uppercase tracking-widest text-[#FFD700]">TruckCEO</p>
        <h1 className="mt-1 text-3xl font-black uppercase tracking-tight">Driver</h1>
        <p className="mt-2 text-sm text-slate-300">Your route. Your stops. Your day.</p>
      </header>

      <main className="flex-1 px-6 py-6">
        {!configured && (
          <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-bold">Not connected yet</p>
            <p className="mt-1">
              This build has no Firebase configuration, so sign-in is disabled. Add the
              VITE_FIREBASE_* values (see .env.example) to connect it to the TruckCEO project.
            </p>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        )}

        {needsInvite && (
          <div className="space-y-4">
            <div className="rounded-xl border-2 border-black bg-amber-50 px-4 py-4">
              <p className="text-sm font-bold text-black">
                You&rsquo;re signed in as {currentUser.email}
              </p>
              <p className="mt-1 text-sm text-slate-700">
                Your account is ready — it just isn&rsquo;t linked to a route yet.
                Enter your invite code to join your route.
              </p>
            </div>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => joinWithInviteCode(code, name));
              }}
            >
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
                disabled={busy || !configured}
                className="w-full rounded-xl bg-black py-3.5 text-base font-bold text-[#FFD700] disabled:opacity-40"
              >
                Join my route
              </button>
            </form>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(logout)}
              className="w-full py-1 text-center text-sm font-semibold text-slate-600"
            >
              Wrong account? Sign out
            </button>
          </div>
        )}

        {!needsInvite && (
          <>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() =>
              mode === 'signin'
                ? signIn(email.trim(), password)
                : createAccount(email.trim(), password),
            );
          }}
        >
          <input
            className={inputCls}
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className={inputCls}
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="submit"
            disabled={busy || !configured}
            className="w-full rounded-xl bg-black py-3.5 text-base font-bold text-[#FFD700] disabled:opacity-40"
          >
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === 'signin' ? 'create' : 'signin')}
            className="w-full py-1 text-center text-sm font-semibold text-slate-600"
          >
            {mode === 'signin'
              ? 'New here? Create an account'
              : 'Already have an account? Sign in'}
          </button>
        </form>

        <button
          type="button"
          disabled={busy || !configured}
          onClick={() => void run(signInWithGoogle)}
          className="mt-3 w-full rounded-xl border border-slate-300 py-3.5 text-base font-semibold disabled:opacity-40"
        >
          <i className="fa-brands fa-google mr-2" /> Continue with Google
        </button>

        <div className="my-6 flex items-center gap-3 text-xs font-bold uppercase tracking-wider text-slate-400">
          <span className="h-px flex-1 bg-slate-200" /> New driver? <span className="h-px flex-1 bg-slate-200" />
        </div>

        {!showCode ? (
          <button
            type="button"
            onClick={() => setShowCode(true)}
            className="w-full rounded-xl border-2 border-dashed border-slate-300 py-3.5 text-base font-semibold text-slate-700"
          >
            <i className="fa-solid fa-ticket mr-2" /> I have an invite code
          </button>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => joinWithInviteCode(code, name));
            }}
          >
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
              disabled={busy || !configured || !currentUser}
              className="w-full rounded-xl bg-black py-3.5 text-base font-bold text-[#FFD700] disabled:opacity-40"
            >
              Join my route
            </button>
            {!currentUser && (
              <p className="text-center text-xs text-slate-500">
                Sign in or create your account above first, then enter your code.
              </p>
            )}
          </form>
        )}
          </>
        )}
      </main>
    </div>
  );
};
