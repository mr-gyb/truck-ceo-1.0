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
import { doc, getDoc, increment, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, firebaseConfigured } from '../services/firebaseConfig';
import { lookupInviteCode } from '../services/driverService';
import type { DriverProfile } from '../types';

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
        const snap = await getDoc(doc(dbI, 'users', user.uid));
        if (snap.exists()) {
          const data = snap.data() as DriverProfile;
          // Only driver (team_member) profiles belong in this app.
          setProfile(data.role === 'team_member' ? data : null);
        } else {
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
   * Invite-code join, mirroring the owner app's completeDriverJoin: the
   * signed-in user redeems a code, which writes their team_member profile
   * bound to the code's business + route and bumps the code's usedCount.
   * Requires the driver to have created an account first (same as owner app).
   */
  const joinWithInviteCode = async (code: string, displayName: string) => {
    if (!auth || !db || !currentUser) {
      throw new Error('Create an account or sign in first, then enter your invite code.');
    }
    const invite = await lookupInviteCode(code);
    if (!invite) throw new Error('That invite code was not found. Check it and try again.');
    const nextProfile: DriverProfile = {
      email: currentUser.email ?? '',
      displayName: displayName.trim() || currentUser.email || 'Driver',
      role: 'team_member',
      businessId: invite.businessId,
      routeIds: [invite.routeId],
    };
    await setDoc(doc(db, 'users', currentUser.uid), nextProfile);
    await updateDoc(doc(db, 'inviteCodes', invite.code), { usedCount: increment(1) });
    setProfile(nextProfile);
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
