import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { doc, getDoc, setDoc, collection, updateDoc, increment, arrayUnion } from 'firebase/firestore';
import { auth, db } from '../services/firebaseConfig';
import type { DriverMembership } from '../types';

interface UserProfile {
  email: string;
  displayName: string;
  role: 'business_owner' | 'business_manager' | 'team_member';
  businessId: string;
  employeeId?: string;
  routeIds?: string[];
  // Driver bindings held WITHOUT changing the primary role (dual-role
  // accounts: an owner who also drives a route). See completeDriverJoin.
  driverMemberships?: DriverMembership[];
  // Welcome onboarding state (set by the onboarding wizard).
  onboardingCompleted?: boolean;
  onboardingSkippedAt?: unknown;
}

interface AuthContextType {
  currentUser: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  needsRoleSelection: boolean;
  pendingName: string;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  completeOwnerSignup: (businessName: string) => Promise<void>;
  completeDriverJoin: (inviteCode: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsRoleSelection, setNeedsRoleSelection] = useState(false);
  const [pendingName, setPendingName] = useState('');

  const fetchUserProfile = async (uid: string): Promise<boolean> => {
    const userDoc = await getDoc(doc(db, 'users', uid));
    if (userDoc.exists()) {
      setUserProfile(userDoc.data() as UserProfile);
      return true;
    }
    return false;
  };

  // Email/password signup: create the auth user, then ask owner vs driver.
  const signUp = async (email: string, password: string, displayName: string) => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    setPendingName(displayName.trim() || email);
    setUserProfile(null);
    setNeedsRoleSelection(true);
    void userCredential;
  };

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged handles profile fetch / role selection
  };

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);

    // If this Google user has no profile yet, route them to role selection
    // instead of auto-creating a business.
    const hasProfile = await fetchUserProfile(result.user.uid);
    if (!hasProfile) {
      setPendingName(result.user.displayName || result.user.email || 'Driver');
      setNeedsRoleSelection(true);
    }
  };

  // Owner path: create the business + owner profile.
  const completeOwnerSignup = async (businessName: string) => {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');

    const businessId = `biz_${user.uid}`;
    // Profile FIRST (2026-11-09 fix): the businesses rule reads
    // users/{uid}.businessId to authorize the business write, so the
    // business doc can only be created after the profile exists.
    await setDoc(doc(db, 'users', user.uid), {
      email: user.email,
      displayName: pendingName || user.displayName || 'Business Owner',
      role: 'business_owner',
      businessId,
      createdAt: new Date()
    });

    await setDoc(doc(db, 'businesses', businessId), {
      name: businessName.trim(),
      ownerId: user.uid,
      createdAt: new Date(),
      subscription: 'free'
    });

    console.log('New owner signup — leaving the business empty so the setup wizard guides real data entry.');

    setNeedsRoleSelection(false);
    await fetchUserProfile(user.uid);
  };

  // Driver path: redeem an invite code -> link driver to business + route + owner.
  //
  // Join semantics (2026-11-08 fix pass — owner and driver apps share them):
  //  1. The users/{uid} profile is written FIRST (the rules evaluate
  //     membership from it), with merge so an existing profile is never
  //     clobbered: an owner/manager who drives a route keeps their role and
  //     businessId and the binding lands in driverMemberships instead.
  //  2. The employee record is created under the owner's business so the
  //     joiner shows up in the team list (and in Driver Invites).
  //  3. usedCount + a redemption record land on the GLOBAL inviteCodes doc
  //     (any signed-in user may update it — this is the count the owner UI
  //     reads). The business-level copy is updated best-effort: rules only
  //     let owners write it, so a driver join skips it silently.
  const completeDriverJoin = async (inviteCode: string) => {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');

    const code = inviteCode.trim().toUpperCase();
    if (!code) throw new Error('Please enter your invite code');

    const inviteSnap = await getDoc(doc(db, 'inviteCodes', code));
    if (!inviteSnap.exists()) {
      throw new Error('That invite code was not found. Check it with your owner and try again.');
    }
    const invite = inviteSnap.data() as {
      businessId: string;
      routeId: string;
      routeName: string;
      role?: string;
    };

    // Invite links carry their own role: 'team_member' (driver view) or
    // 'business_manager' (business view). Legacy per-route codes have no role
    // field and default to the driver view.
    const accountRole = invite.role === 'business_manager' ? 'business_manager' : 'team_member';
    const routeIds = invite.routeId ? [invite.routeId] : [];
    const displayName = pendingName || user.displayName || user.email || (accountRole === 'business_manager' ? 'Partner' : 'Driver');

    // (1) Profile first, merged. Owners/managers keep their role: the
    // driver binding is appended to driverMemberships (deduped by route).
    const existingSnap = await getDoc(doc(db, 'users', user.uid));
    const existing = (existingSnap.exists() ? (existingSnap.data() as UserProfile) : null);
    const isOwnerRole = existing?.role === 'business_owner' || existing?.role === 'business_manager';
    const membership: DriverMembership = {
      businessId: invite.businessId,
      routeId: invite.routeId,
      routeName: invite.routeName,
      joinedAt: new Date()
    };
    const priorMemberships = (existing?.driverMemberships || []).filter(
      (m) => !(m.businessId === invite.businessId && m.routeId === invite.routeId)
    );
    if (isOwnerRole) {
      await setDoc(doc(db, 'users', user.uid), {
        driverMemberships: [...priorMemberships, membership]
      }, { merge: true });
    } else {
      await setDoc(doc(db, 'users', user.uid), {
        email: user.email,
        displayName,
        role: accountRole,
        businessId: invite.businessId,
        routeIds,
        driverMemberships: [...priorMemberships, membership],
        createdAt: new Date()
      });
    }

    // (2) Employee record under the owner's business so the joiner shows
    // up in the team list and in Driver Invites.
    const empRef = doc(collection(db, `businesses/${invite.businessId}/employees`));
    await setDoc(empRef, {
      name: displayName,
      role: accountRole === 'business_manager' ? 'manager' : 'driver',
      userId: user.uid,
      email: user.email || null,
      assignedRoutes: routeIds,
      status: 'active',
      hoursThisWeek: 0,
      engagementScore: 0,
      salesHistory: [],
      attendance: [],
      vacationDaysUsed: 0,
      sickDaysUsed: 0,
      inviteCode: code,
      createdAt: new Date()
    });
    if (isOwnerRole) {
      membership.employeeId = empRef.id;
      await setDoc(doc(db, 'users', user.uid), {
        driverMemberships: [...priorMemberships, membership]
      }, { merge: true });
    } else {
      await updateDoc(doc(db, 'users', user.uid), { employeeId: empRef.id });
    }

    // (3) Count + redemption on the global invite doc (owner UI reads here).
    await updateDoc(doc(db, 'inviteCodes', code), {
      usedCount: increment(1),
      redemptions: arrayUnion({
        uid: user.uid,
        email: user.email || null,
        displayName,
        routeId: invite.routeId,
        joinedAt: new Date()
      })
    });
    // Business-level copy: owner-writable only per rules — best effort.
    try {
      await updateDoc(doc(db, `businesses/${invite.businessId}/invites`, code), {
        usedCount: increment(1),
        redemptions: arrayUnion({
          uid: user.uid,
          email: user.email || null,
          displayName,
          routeId: invite.routeId,
          joinedAt: new Date()
        })
      });
    } catch {
      // A driver join cannot write the business-level copy under current
      // rules — the global doc above is the source of truth, so not an error.
    }

    // Clean an invite deep link (/join/{code}) back to the app root.
    if (window.location.pathname.toLowerCase().startsWith('/join/')) {
      window.history.replaceState(null, '', '/');
    }

    setNeedsRoleSelection(false);
    await fetchUserProfile(user.uid);
  };

  const logout = async () => {
    await signOut(auth);
    setUserProfile(null);
    setNeedsRoleSelection(false);
    setPendingName('');
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        const hasProfile = await fetchUserProfile(user.uid);
        if (!hasProfile) {
          // Authed but no profile and not already in the role flow
          // (e.g. abandoned signup): send them to role selection.
          setPendingName((prev) => prev || user.displayName || user.email || '');
          setNeedsRoleSelection(true);
        }
      } else {
        setUserProfile(null);
        setNeedsRoleSelection(false);
        setPendingName('');
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const value = {
    currentUser,
    userProfile,
    loading,
    needsRoleSelection,
    pendingName,
    signIn,
    signUp,
    signInWithGoogle,
    completeOwnerSignup,
    completeDriverJoin,
    logout
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
