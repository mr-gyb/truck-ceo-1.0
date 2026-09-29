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
import { doc, getDoc, setDoc, collection, updateDoc, increment } from 'firebase/firestore';
import { auth, db } from '../services/firebaseConfig';
import { migrateInitialData } from '../scripts/migrateData';

interface UserProfile {
  email: string;
  displayName: string;
  role: 'business_owner' | 'team_member';
  businessId: string;
  employeeId?: string;
  routeIds?: string[];
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
    await setDoc(doc(db, 'businesses', businessId), {
      name: businessName.trim(),
      ownerId: user.uid,
      createdAt: new Date(),
      subscription: 'free'
    });

    await setDoc(doc(db, 'users', user.uid), {
      email: user.email,
      displayName: pendingName || user.displayName || 'Business Owner',
      role: 'business_owner',
      businessId,
      createdAt: new Date()
    });

    console.log('Migrating initial demo data...');
    await migrateInitialData(businessId);

    setNeedsRoleSelection(false);
    await fetchUserProfile(user.uid);
  };

  // Driver path: redeem an invite code -> link driver to business + route + owner.
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

    // Create the employee record under the owner's business so the joiner
    // shows up in the team list.
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

    // Link the auth user to the business (and route, when the invite is route-scoped).
    await setDoc(doc(db, 'users', user.uid), {
      email: user.email,
      displayName,
      role: accountRole,
      businessId: invite.businessId,
      employeeId: empRef.id,
      routeIds,
      createdAt: new Date()
    });

    await updateDoc(doc(db, 'inviteCodes', code), { usedCount: increment(1) });
    // Dual-written business-level links also track usage under the business.
    try {
      await updateDoc(doc(db, `businesses/${invite.businessId}/invites`, code), { usedCount: increment(1) });
    } catch {
      // Legacy per-route codes have no business-level copy — not an error.
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
