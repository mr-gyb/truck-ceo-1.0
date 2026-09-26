import React, { useEffect, useState } from 'react';
import { collection, doc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { db } from '../services/firebaseConfig';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/useToast';
import { InviteCode } from '../types';

const randomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
};

/**
 * Owner-side: generate per-route driver invite codes. The driver enters the
 * code at signup and is automatically linked to this business + route + owner.
 */
export const DriverInvite: React.FC<{ routeId: string; routeName: string }> = ({ routeId, routeName }) => {
  const { userProfile, currentUser } = useAuth();
  const { showToast } = useToast();
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);

  const businessId = userProfile?.businessId;

  const fetchCodes = async () => {
    if (!businessId) return;
    const snap = await getDocs(
      query(collection(db, `businesses/${businessId}/invites`), where('routeId', '==', routeId))
    );
    setCodes(snap.docs.map((d) => d.data() as InviteCode));
  };

  useEffect(() => {
    fetchCodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, routeId]);

  const generateCode = async () => {
    if (!businessId || !currentUser) return;
    setLoading(true);
    try {
      const code = randomCode();
      const payload = {
        code,
        businessId,
        routeId,
        routeName,
        createdBy: currentUser.uid,
        createdAt: new Date(),
        usedCount: 0
      };
      const batch = writeBatch(db);
      batch.set(doc(db, 'inviteCodes', code), payload);
      batch.set(doc(db, `businesses/${businessId}/invites`, code), payload);
      await batch.commit();
      setLastCode(code);
      await fetchCodes();
      showToast(`Invite code ${code} created for ${routeName}`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Could not create invite code', 'error');
    } finally {
      setLoading(false);
    }
  };

  const revokeCode = async (code: string) => {
    if (!businessId) return;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'inviteCodes', code));
      batch.delete(doc(db, `businesses/${businessId}/invites`, code));
      await batch.commit();
      if (lastCode === code) setLastCode(null);
      await fetchCodes();
      showToast(`Invite code ${code} revoked`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Could not revoke code', 'error');
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      showToast('Code copied — send it to your driver', 'success');
    } catch {
      showToast(code, 'success');
    }
  };

  return (
    <div className="bg-gray-50 rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
          <i className="fas fa-key mr-2 text-[#FFD700]"></i>
          Driver Invite Codes
        </h4>
        <button
          onClick={generateCode}
          disabled={loading}
          className="px-4 py-2 bg-black text-[#FFD700] rounded-xl text-[9px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2"
        >
          <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-plus'}`}></i>
          New Code
        </button>
      </div>

      {lastCode && (
        <button
          onClick={() => copyCode(lastCode)}
          className="w-full p-4 bg-black rounded-2xl flex items-center justify-between active:scale-95 transition-all"
        >
          <span className="text-[#FFD700] font-black tracking-[0.35em] text-lg">{lastCode}</span>
          <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
            <i className="fas fa-copy mr-1"></i> Tap to copy
          </span>
        </button>
      )}

      {codes.length > 0 && (
        <div className="space-y-2">
          {codes.map((c) => (
            <div key={c.code} className="flex items-center justify-between bg-white rounded-xl px-4 py-2.5 border border-gray-100">
              <div>
                <span className="font-black tracking-[0.2em] text-sm">{c.code}</span>
                <span className="ml-3 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                  used {c.usedCount || 0}x
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => copyCode(c.code)}
                  className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center hover:bg-gray-200 active:scale-95"
                >
                  <i className="fas fa-copy text-xs"></i>
                </button>
                <button
                  onClick={() => revokeCode(c.code)}
                  className="w-8 h-8 bg-red-50 text-red-600 rounded-lg flex items-center justify-center hover:bg-red-100 active:scale-95"
                >
                  <i className="fas fa-ban text-xs"></i>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider text-center">
        One code per driver — text it to them, they join the right route automatically
      </p>
    </div>
  );
};
