import React, { useState } from 'react';
import { auth } from '../services/firebaseConfig';

/**
 * Secure bakery-portal credential capture.
 *
 * Usernames/passwords entered here are POSTed to /api/saveFeedCredentials,
 * which stores them in Google Secret Manager (backend-only). They are NEVER
 * written to Firestore, NEVER echoed in chat, and NEVER logged.
 */
interface SecureConnectModalProps {
  /** platform slug, e.g. 'flowers-iplan' */
  platform: string;
  /** display name, e.g. 'Flowers iPlan' */
  platformName: string;
  onClose: () => void;
  onSaved: () => void;
}

export const SecureConnectModal: React.FC<SecureConnectModalProps> = ({
  platform,
  platformName,
  onClose,
  onSaved,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = username.trim();
    if (!u || !password) {
      setError('Enter both the username and password.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not signed in');
      const token = await user.getIdToken();
      const res = await fetch('/api/saveFeedCredentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ platform, username: u, password }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || !data.ok) {
        throw new Error(
          typeof data?.error === 'string' ? data.error : 'Save failed. Try again.'
        );
      }
      // Scrub secrets from component state immediately after a successful save.
      setUsername('');
      setPassword('');
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Save failed. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/70 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-black p-6">
          <h3 className="text-white font-black text-sm uppercase tracking-[0.2em]">
            <i className="fas fa-shield-halved text-[#FFD700] mr-2"></i>
            Connect {platformName}
          </h3>
          <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mt-2">
            Saved to a secure vault — never in chat or the app database.
          </p>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Username / email
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="Portal username"
              className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Portal password"
              className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold"
            />
          </div>
          {error && (
            <p className="text-red-600 text-xs font-bold">{error}</p>
          )}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-6 py-4 bg-gray-100 text-black font-black uppercase tracking-widest text-xs rounded-2xl active:scale-95 transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !username.trim() || !password}
              className="flex-1 py-4 bg-[#FFD700] text-black font-black uppercase tracking-widest text-xs rounded-2xl shadow-xl active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? (
                <i className="fas fa-spinner fa-spin"></i>
              ) : (
                <>
                  <i className="fas fa-lock"></i> Save securely
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
