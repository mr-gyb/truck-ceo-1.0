import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { arrayUnion, collection, doc, getDoc, increment, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, firebaseConfigured } from '../services/firebaseConfig';
import { lookupInviteCode } from '../services/driverService';
import type { DriverMembership, DriverProfile } from '../types';

/**
 * Resolve the driver profile for a users/{uid} doc. A team_member doc is
 * itself the driver profile. An owner/manager doc resolves through its
 * first driverMembership — redeeming an invite must never overwrite an
 * owner profile (that overwrite was the 2026-11-08 "role trap": the owner
 * app then routed the account to the driver feed with no way back).
 */
function resolveDriverProfile(data: Record<string, unknown>): DriverProfile | null {
  const memberships = (data.driverMemberships as DriverMembership[] | undefined) ?? [];
  if (data.role === 'team_member') {
    return {
      email: (data.email as string) ?? '',
      displayName: (data.displayName as string) ?? 'Driver',
      role: 'team_member',
      businessId: data.businessId as string,
      routeIds: (data.routeIds as string[]) ?? [],
      driverMemberships: memberships,
    };
  }
  const m = memberships[0];
  if (m) {
    return {
      email: (data.email as string) ?? '',
      displayName: (data.displayName as string) ?? 'Driver',
      role: 'team_member',
      businessId: m.businessId,
      routeIds: [m.routeId],
      driverMemberships: memberships,
    };
  }
  return null;
}

// Lean version of the owner app's AuthContext: drivers are team_members
// with a businessId and routeIds on users/{uid}. Same join semantics —
// redeeming an invite code binds the driver to that code's route.

interface AuthContextType {
  currentUser: User | null;
  profile: DriverProfile | null;
  loading: boolean;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  createAccount: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  joinWithInviteCode: (code: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const authI = auth;
    const dbI = db;
    if (!authI || !dbI) {
      setLoading(false);
      return;
    }
    // Complete the redirect fallback path if we just returned from one
    // (see signInWithGoogle). The signed-in user surfaces through
    // onAuthStateChanged below; this call only consumes the pending
    // redirect result. Errors are swallowed on purpose — a failed
    // redirect completion must not take the app down.
    getRedirectResult(authI).catch(() => undefined);
    const unsub = onAuthStateChanged(authI, async (user) => {
      setCurrentUser(user);
      if (user) {
        try {
          const snap = await getDoc(doc(dbI, 'users', user.uid));
          setProfile(snap.exists() ? resolveDriverProfile(snap.data() as Record<string, unknown>) : null);
        } catch {
          setProfile(null);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const signIn = async (email: string, password: string) => {
    if (!auth) throw new Error('App is not connected to Firebase yet.');
    await signInWithEmailAndPassword(auth, email, password);
  };

  /** New drivers create their account here, then redeem their invite code
   *  (joinWithInviteCode requires a signed-in user, same as the owner app). */
  const createAccount = async (email: string, password: string) => {
    if (!auth) throw new Error('App is not connected to Firebase yet.');
    await createUserWithEmailAndPassword(auth, email, password);
  };

  // Popup-first: popups keep the whole flow on this page, which is what
  // works in storage-partitioned webviews (iOS in-app browsers), where a
  // full-page redirect to the auth handler loses its sessionStorage state
  // and fails with "missing initial state". Only when the popup itself
  // cannot run do we fall back to signInWithRedirect (completed on the
  // next load by the getRedirectResult call in the effect above). The
  // same-domain authDomain in firebaseConfig keeps that fallback same-site
  // on the production hosting domains.
  const signInWithGoogle = async () => {
    if (!auth) throw new Error('App is not connected to Firebase yet.');
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment' ||
        code === 'auth/cancelled-popup-request'
      ) {
        await signInWithRedirect(auth, provider);
        return;
      }
      throw err;
    }
  };

  /**
   * Invite-code join, mirroring the owner app's completeDriverJoin (shared
   * join semantics, 2026-11-08 fix pass):
   *  1. users/{uid} is written FIRST, merged — an owner/manager account
   *     keeps its role and businessId; the binding lands in
   *     driverMemberships. (The old version overwrote the whole doc, which
   *     destroyed owner profiles and trapped the account in driver view.)
   *  2. usedCount + a redemption record land on the GLOBAL inviteCodes doc
   *     — the count the owner UI reads. (The old version never touched the
   *     records the owner actually sees beyond this one increment, and
   *     created no employee record, so joins registered nowhere.)
   *  3. The employee record is created under the business so the driver
   *     appears in the owner's team list and Driver Invites screen.
   * Requires the driver to have created an account first (same as owner app).
   */
  const joinWithInviteCode = async (code: string, displayName: string) => {
    if (!auth || !db || !currentUser) {
      throw new Error('Create an account or sign in first, then enter your invite code.');
    }
    const invite = await lookupInviteCode(code);
    if (!invite) throw new Error('That invite code was not found. Check it and try again.');
    const name = displayName.trim() || currentUser.displayName || currentUser.email || 'Driver';
    const redemption = {
      uid: currentUser.uid,
      email: currentUser.email || null,
      displayName: name,
      routeId: invite.routeId,
      joinedAt: new Date(),
    };

    // (1) Profile first, merged, owner roles preserved.
    const userRef = doc(db, 'users', currentUser.uid);
    const existingSnap = await getDoc(userRef);
    const existing = (existingSnap.exists() ? (existingSnap.data() as Record<string, unknown>) : null);
    const isOwnerRole = existing?.role === 'business_owner' || existing?.role === 'business_manager';
    const membership: DriverMembership = {
      businessId: invite.businessId,
      routeId: invite.routeId,
      routeName: invite.routeName,
      joinedAt: new Date(),
    };
    const priorMemberships = ((existing?.driverMemberships as DriverMembership[] | undefined) ?? []).filter(
      (m) => !(m.businessId === invite.businessId && m.routeId === invite.routeId),
    );
    const memberships = [...priorMemberships, membership];
    if (isOwnerRole) {
      await setDoc(userRef, { driverMemberships: memberships }, { merge: true });
    } else {
      await setDoc(userRef, {
        email: currentUser.email ?? '',
        displayName: name,
        role: 'team_member',
        businessId: invite.businessId,
        routeIds: [invite.routeId],
        driverMemberships: memberships,
      });
    }

    // (2) Count + redemption on the global invite doc (owner UI reads here).
    await updateDoc(doc(db, 'inviteCodes', invite.code), {
      usedCount: increment(1),
      redemptions: arrayUnion(redemption),
    });
    // Business-level copy is owner-write-only in the rules — best effort.
    try {
      await updateDoc(doc(db, 'businesses', invite.businessId, 'invites', invite.code), {
        usedCount: increment(1),
        redemptions: arrayUnion(redemption),
      });
    } catch {
      // Not an error: the global doc above is the source of truth.
    }

    // (3) Employee record so the owner sees this driver on the team list.
    try {
      const empRef = doc(collection(db, 'businesses', invite.businessId, 'employees'));
      await setDoc(empRef, {
        name,
        role: 'driver',
        userId: currentUser.uid,
        email: currentUser.email || null,
        assignedRoutes: [invite.routeId],
        status: 'active',
        hoursThisWeek: 0,
        engagementScore: 0,
        salesHistory: [],
        attendance: [],
        vacationDaysUsed: 0,
        sickDaysUsed: 0,
        inviteCode: invite.code,
        createdAt: new Date(),
      });
      if (!isOwnerRole) {
        await updateDoc(userRef, { employeeId: empRef.id });
      }
    } catch (err) {
      // A rules denial here must not fail the join itself — the profile and
      // the invite redemption above already landed.
      console.warn('Employee record create failed on join', err);
    }

    setProfile({
      email: currentUser.email ?? '',
      displayName: name,
      role: 'team_member',
      businessId: invite.businessId,
      routeIds: [invite.routeId],
      driverMemberships: memberships,
    });
  };

  const logout = async () => {
    if (auth) await signOut(auth);
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        profile,
        loading,
        configured: firebaseConfigured,
        signIn,
        createAccount,
        signInWithGoogle,
        joinWithInviteCode,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
