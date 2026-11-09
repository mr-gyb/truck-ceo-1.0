import React, { useEffect, useState } from 'react';
import { collection, doc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { db } from '../services/firebaseConfig';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/useToast';
import { InviteCode } from '../types';

interface JoinedDriver {
  id: string;
  name: string;
  email?: string | null;
  joinedAt?: any;
}

const fmtDate = (ts: any): string => {
  if (!ts) return '';
  const d = typeof ts.toDate === 'function' ? ts.toDate() : ts instanceof Date ? ts : null;
  return d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
};

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
  const [joined, setJoined] = useState<JoinedDriver[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);

  const businessId = userProfile?.businessId;

  // Source of truth for counts is the GLOBAL inviteCodes collection: both
  // join flows (owner app + driver app) increment usedCount and append a
  // redemption there, and any signed-in user may update that doc. The
  // business-level copy (businesses/{bid}/invites) is owner-write-only in
  // the rules, so a driver join can never bump it — reading counts from it
  // showed "used 0x" forever after real joins (2026-11-08 defect).
  const fetchCodes = async () => {
    if (!businessId) return;
    try {
      // Single equality filter (no composite index required); the route
      // filter is applied client-side — a business has a handful of codes.
      const snap = await getDocs(
        query(collection(db, 'inviteCodes'), where('businessId', '==', businessId))
      );
      setCodes(
        snap.docs
          .map((d) => d.data() as InviteCode)
          .filter((c) => c.routeId === routeId && c.kind !== 'link')
      );
    } catch (err) {
      console.error('Failed to load invite codes', err);
    }
    try {
      const empSnap = await getDocs(
        query(
          collection(db, `businesses/${businessId}/employees`),
          where('assignedRoutes', 'array-contains', routeId)
        )
      );
      setJoined(
        empSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          // Only people who actually joined with an account — manual roster
          // entries (FleetManager) carry no linked user or invite code.
          .filter((e) => !!e.userId || !!e.inviteCode)
          .map((e) => ({
            id: e.id,
            name: e.name || 'Driver',
            email: e.email ?? null,
            joinedAt: e.createdAt
          }))
      );
    } catch (err) {
      console.error('Failed to load joined drivers', err);
    }
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

  // Regenerate: revoke every live code for this route and issue one fresh
  // code. Old codes stop working immediately (both copies are deleted,
  // exactly like revokeCode).
  const regenerateCodes = async () => {
    if (!businessId || !currentUser) return;
    setLoading(true);
    try {
      const batch = writeBatch(db);
      codes.forEach((c) => {
        batch.delete(doc(db, 'inviteCodes', c.code));
        batch.delete(doc(db, `businesses/${businessId}/invites`, c.code));
      });
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
      batch.set(doc(db, 'inviteCodes', code), payload);
      batch.set(doc(db, `businesses/${businessId}/invites`, code), payload);
      await batch.commit();
      setLastCode(code);
      await fetchCodes();
      showToast(`New invite code ${code} for ${routeName} — old codes revoked`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Could not regenerate invite code', 'error');
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
            <div key={c.code} className="bg-white rounded-xl px-4 py-2.5 border border-gray-100">
              <div className="flex items-center justify-between">
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
              {(c.redemptions || []).length > 0 && (
                <div className="mt-2 space-y-1 border-t border-gray-50 pt-2">
                  {(c.redemptions || []).map((r, i) => (
                    <p key={i} className="text-[10px] font-bold text-gray-500">
                      <i className="fas fa-user-check mr-1.5 text-green-600"></i>
                      {r.email || r.displayName || 'Driver'}
                      {r.joinedAt ? <span className="text-gray-400"> · joined {fmtDate(r.joinedAt)}</span> : null}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
          <button
            onClick={regenerateCodes}
            disabled={loading}
            className="w-full py-2.5 bg-white border border-gray-200 rounded-xl text-[9px] font-black uppercase tracking-widest text-gray-500 active:scale-95 transition-all disabled:opacity-50"
          >
            <i className="fas fa-rotate mr-2"></i>
            Regenerate code (revokes the above)
          </button>
        </div>
      )}

      {joined.length > 0 && (
        <div>
          <h5 className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2">
            Joined drivers on this route
          </h5>
          <div className="space-y-1.5">
            {joined.map((j) => (
              <div key={j.id} className="flex items-center justify-between bg-white rounded-xl px-4 py-2 border border-gray-100">
                <span className="text-xs font-black">{j.name}</span>
                <span className="text-[10px] font-bold text-gray-400">
                  {j.email || ''}
                  {j.joinedAt ? <span> · {fmtDate(j.joinedAt)}</span> : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider text-center">
        One code per driver — text it to them, they join the right route automatically
      </p>
    </div>
  );
};
