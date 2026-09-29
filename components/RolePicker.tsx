import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { BUSINESS_NAME } from '../constants';

type Step = 'choose' | 'owner' | 'driver';

export const RolePicker: React.FC<{ initialInviteCode?: string | null }> = ({ initialInviteCode }) => {
  const { pendingName, completeOwnerSignup, completeDriverJoin, logout } = useAuth();
  const [step, setStep] = useState<Step>(initialInviteCode ? 'driver' : 'choose');
  const [businessName, setBusinessName] = useState('');
  const [inviteCode, setInviteCode] = useState(initialInviteCode ?? '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleOwnerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessName.trim()) {
      setError('Please enter your business name');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await completeOwnerSignup(businessName);
    } catch (err: any) {
      setError(err.message || 'Could not create your business. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDriverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) {
      setError('Please enter the invite code from your owner');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await completeDriverJoin(inviteCode);
    } catch (err: any) {
      setError(err.message || 'Could not join with that code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-black via-gray-900 to-gray-800 p-6">
      <div className="max-w-md w-full bg-white rounded-[3rem] p-10 shadow-2xl">
        <div className="text-center mb-8">
          <i className="fas fa-truck-fast text-[#FFD700] text-5xl mb-4"></i>
          <h1 className="text-3xl font-black uppercase tracking-tighter">{BUSINESS_NAME}</h1>
          <p className="text-gray-400 text-xs font-black uppercase tracking-widest mt-2">
            {pendingName ? `Hi ${pendingName} — ` : ''}How will you use the app?
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border-2 border-red-200 text-red-600 p-4 rounded-2xl mb-6 text-sm font-bold">
            <i className="fas fa-exclamation-circle mr-2"></i>
            {error}
          </div>
        )}

        {step === 'choose' && (
          <div className="space-y-4">
            <button
              onClick={() => { setStep('owner'); setError(''); }}
              className="w-full p-6 bg-black text-white rounded-[2rem] text-left hover:bg-gray-900 transition-all active:scale-95 group"
            >
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-[#FFD700] rounded-2xl flex items-center justify-center text-black text-xl">
                  <i className="fas fa-building"></i>
                </div>
                <div>
                  <div className="font-black uppercase tracking-widest text-sm">I'm an Owner</div>
                  <div className="text-gray-400 text-xs font-bold mt-1">Run my business, routes & team</div>
                </div>
              </div>
            </button>
            <button
              onClick={() => { setStep('driver'); setError(''); }}
              className="w-full p-6 bg-gray-100 text-black rounded-[2rem] text-left hover:bg-gray-200 transition-all active:scale-95"
            >
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-black rounded-2xl flex items-center justify-center text-[#FFD700] text-xl">
                  <i className="fas fa-id-card"></i>
                </div>
                <div>
                  <div className="font-black uppercase tracking-widest text-sm">I'm a Driver</div>
                  <div className="text-gray-500 text-xs font-bold mt-1">Post my day with an invite code</div>
                </div>
              </div>
            </button>
          </div>
        )}

        {step === 'owner' && (
          <form onSubmit={handleOwnerSubmit} className="space-y-4">
            <div>
              <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-3">
                Business Name
              </label>
              <input
                type="text"
                placeholder="e.g. CNR Distributors"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold transition-all"
                disabled={loading}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-black text-[#FFD700] font-black uppercase tracking-widest text-sm rounded-2xl hover:bg-gray-900 transition-all shadow-xl active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <><i className="fas fa-spinner fa-spin"></i> Creating...</> : 'Create My Business'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('choose'); setError(''); }}
              className="w-full text-sm text-gray-500 hover:text-black font-bold transition-colors"
            >
              ← Back
            </button>
          </form>
        )}

        {step === 'driver' && (
          <form onSubmit={handleDriverSubmit} className="space-y-4">
            <div className="p-4 bg-gray-50 rounded-2xl">
              <p className="text-[10px] text-gray-500 font-bold leading-relaxed text-center uppercase tracking-wider">
                Ask your owner for your route invite code. It links you to the right business & route automatically.
              </p>
            </div>
            <div>
              <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-3">
                Invite Code
              </label>
              <input
                type="text"
                placeholder="e.g. K7X2P9"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-black tracking-[0.3em] text-center uppercase transition-all"
                disabled={loading}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-black text-[#FFD700] font-black uppercase tracking-widest text-sm rounded-2xl hover:bg-gray-900 transition-all shadow-xl active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <><i className="fas fa-spinner fa-spin"></i> Joining...</> : 'Join My Route'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('choose'); setError(''); }}
              className="w-full text-sm text-gray-500 hover:text-black font-bold transition-colors"
            >
              ← Back
            </button>
          </form>
        )}

        <button
          onClick={logout}
          className="mt-6 w-full text-xs text-gray-400 hover:text-black font-bold transition-colors"
        >
          Use a different account
        </button>
      </div>
    </div>
  );
};
